import { Structure, Tissue } from '../tissue';
import { sdCapsule, sdSegmentChain, sdTorusZ, type ChainHit } from '../sdf';
import { fastAtan2 } from '@/core/noise';
import { aorticContactBand, aorticCuspDistance, aorticHit, AV_COAPT_HALF } from '../aorticValve';
import { mitralAnnulusDistance, mitralDistance, mitralHit } from '../mitralValve';
import { TWO_PI, saddleOffset, skirtDistance, skirtHit } from '../valveSkirt';
import { setSample, type ClassifyCtx } from './context';

const chainHit: ChainHit = { d: 0, frac: 0 };

/** Valves, annuli and chordae (thin, highest priority). True when the point is one of them. */
export function classifyValves(c: ClassifyCtx): boolean {
  const { m, hp, A, x, y, z, out, rootT, rootRr, rootR, rootQx, rootQy, rootQz, rootPhi } = c;
  const V = hp.valves;
  const hit = chainHit;
  // mitral leaflets: anterior leaflet on the aortomitral curtain, posterior around the rest of the D-shaped annulus
  {
    const t = mitralDistance(x, y, z, V.mitral);
    if (mitralHit.d < t) {
      setSample(
        out,
        Tissue.Valve,
        mitralHit.d - t,
        mitralHit.nx,
        mitralHit.ny,
        mitralHit.nz,
        x,
        y,
        z,
        m.anatomy.mitral.calcification,
        mitralHit.leaflet === 0 ? Structure.MitralAnterior : Structure.MitralPosterior,
      );
      return true;
    }
  }
  // aortic cusps: pockets hung from the crown-shaped attachment on the sinus wall
  if (rootT > -0.5 && rootRr < rootR + 0.02) {
    const half = aorticCuspDistance(V.aortic, V.root, rootT, rootRr, rootPhi);
    if (aorticHit.d < half) {
      const ur = 1 / (rootRr || 1);
      const ax = A.avAxis;
      setSample(
        out,
        Tissue.Valve,
        aorticHit.d - half,
        aorticHit.nr * rootQx * ur + aorticHit.nt * ax.x,
        aorticHit.nr * rootQy * ur + aorticHit.nt * ax.y,
        aorticHit.nr * rootQz * ur + aorticHit.nt * ax.z,
        x,
        y,
        z,
        m.anatomy.aorticValve.calcification,
        Structure.AorticValve,
      );
      return true;
    }
  }
  // aortic coaptation surfaces: when the valve is closed adjacent cusps press together along the lines from the
  // centre to each commissure (Y sign in PSAX-AV), in a band below the free margin that is 4.5 mm tall at the centre
  // and rises with the margin toward the commissures. Until 2026-09-13 these fins sat 28.6° away from the commissures
  // of the cusps — 3.7° from the parasternal long-axis plane — reached 0.65 cm down into the ventricular side of the
  // valve and were 0.8 mm thick: a long bright line through the middle of the closed valve in PLAX.
  if (V.aortic.open < 1 && rootT > 0 && rootT < V.aortic.hComm && rootRr < rootR * 0.97) {
    const band = aorticContactBand(V.aortic, V.root, rootT, rootRr, rootPhi);
    const axialDistance = band ? Math.max(band[0] - rootT, rootT - band[1], 0) : Infinity;
    if (axialDistance < AV_COAPT_HALF) {
      const n = V.cuspCount;
      let dphi = (((rootPhi - 0.5 - Math.PI / n) % (TWO_PI / n)) + TWO_PI / n) % (TWO_PI / n);
      if (dphi > Math.PI / n) dphi = TWO_PI / n - dphi;
      const dist = Math.hypot(rootRr * Math.sin(dphi), axialDistance);
      if (dist < AV_COAPT_HALF) {
        // the surface normal is tangential (the band contains the axis and the radial direction)
        const ux = rootQx / (rootRr || 1),
          uy = rootQy / (rootRr || 1),
          uz = rootQz / (rootRr || 1);
        const ax = A.avAxis;
        setSample(
          out,
          Tissue.Valve,
          dist - AV_COAPT_HALF,
          ax.y * uz - ax.z * uy,
          ax.z * ux - ax.x * uz,
          ax.x * uy - ax.y * ux,
          x,
          y,
          z,
          m.anatomy.aorticValve.calcification,
          Structure.AorticValve,
        );
        return true;
      }
    }
  }
  // pulmonary cusps (three, hinged at the outflow–trunk junction; clipped to the trunk lumen). They must not enter
  // the aortic root or its wall: at the level of the sinuses they used to replace 0.3 cm of the anterior aortic wall
  // (decision 75)
  const outsideAorticRoot = rootT <= -1.6 || rootRr > rootR + 0.22;
  if (
    outsideAorticRoot &&
    sdCapsule(
      x,
      y,
      z,
      A.rvotM.x,
      A.rvotM.y,
      A.rvotM.z + hp.pvZ,
      A.paEnd.x,
      A.paEnd.y,
      A.paEnd.z,
      A.paR + 0.02,
    ) < 0
  ) {
    for (let i = 0; i < 3; i++) {
      const wx = V.pvWidths[i * 3]!,
        wy = V.pvWidths[i * 3 + 1]!,
        wz = V.pvWidths[i * 3 + 2]!;
      sdSegmentChain(x, y, z, V.pvSegs, i * 12, 2, V.pvSegLen, wx, wy, wz, V.pvHalf, hit, 0.75);
      const t = V.pvThickness * (1 - 0.3 * hit.frac) * 0.5 + 0.03;
      if (hit.d < t) {
        const o = i * 12 + Math.min(1, Math.floor(hit.frac * 2)) * 6;
        const dx = V.pvSegs[o + 3]!,
          dy = V.pvSegs[o + 4]!,
          dz = V.pvSegs[o + 5]!;
        setSample(
          out,
          Tissue.Valve,
          hit.d - t,
          dy * wz - dz * wy,
          dz * wx - dx * wz,
          dx * wy - dy * wx,
          x,
          y,
          z,
          0,
          Structure.PulmonaryValve,
        );
        return true;
      }
    }
  }
  // tricuspid leaflets (anterior, septal, posterior)
  {
    const t = skirtDistance(x, y, z, V.tv);
    if (skirtHit.d < t) {
      setSample(
        out,
        Tissue.Valve,
        skirtHit.d - t,
        skirtHit.nx,
        skirtHit.ny,
        skirtHit.nz,
        x,
        y,
        z,
        0,
        V.tv.zones[skirtHit.zone]!.structure,
      );
      return true;
    }
  }
  // fibrous annuli (bright hinge points in long-axis views)
  {
    const dR = mitralAnnulusDistance(x, y, z, V.mitral, 0.11);
    if (dR < 0) {
      setSample(
        out,
        Tissue.Fibrous,
        dR,
        x - V.mitral.cx,
        y - V.mitral.cy,
        0,
        x,
        y,
        z,
        0.15 * m.anatomy.mitral.calcification,
        Structure.MitralAnnulus,
      );
      return true;
    }
    const q = V.tvRing;
    const dT = sdTorusZ(
      x,
      y,
      z - saddleOffset(fastAtan2(y - q[1], x - q[0]), V.tv.zones[0]!.phi, V.tv.saddle),
      q[0],
      q[1],
      q[2],
      q[3],
      0.09,
    );
    if (dT < 0) {
      setSample(
        out,
        Tissue.Fibrous,
        dT,
        x - q[0],
        y - q[1],
        0,
        x,
        y,
        z,
        0,
        Structure.TricuspidAnnulus,
      );
      return true;
    }
  }
  // chordae tendineae (thin, only visible when in plane)
  for (let i = 0; i < V.chordaeCount; i++) {
    const o = i * 6;
    const ch = V.chordae;
    const d = sdCapsule(
      x,
      y,
      z,
      ch[o]!,
      ch[o + 1]!,
      ch[o + 2]!,
      ch[o + 3]!,
      ch[o + 4]!,
      ch[o + 5]!,
      0.045,
    );
    if (d < 0) {
      setSample(out, Tissue.Chordae, d, 0, 0, 1, x, y, z, 0, Structure.Chordae);
      return true;
    }
  }
  return false;
}
