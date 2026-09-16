import type { Vec3 } from '@/core/vec3';
import { add, cross, dot, normalize, scale, sub, v3 } from '@/core/vec3';
import type { HeartModel } from '@/simulator/anatomy/heartModel';
import { lvProfileG } from '@/simulator/anatomy/lvShape';
import { AV_COAPTATION_HEIGHT } from '@/simulator/anatomy/aorticValve';
import { anchorsCached, heartDirToTorso, heartToTorso } from '@/simulator/anatomy/heartModel';
import {
  isAnteriorLung,
  ribSpacingAt,
  skinZ,
  snapToIntercostal,
  type ThoraxModel,
} from '@/simulator/anatomy/thoraxModel';
import {
  beamFrameFromPose,
  controlAimingAt,
  poseFromControl,
  type BeamFrame,
  type ProbeControl,
} from '@/simulator/probe/pose';

export {
  VIEW_TARGETS,
  buildViewTargets,
  getViewTarget,
  type LandmarkRequirement,
  type ViewTarget,
  type WindowId,
} from './viewDefinitions';
import type { ViewTarget } from './viewDefinitions';

export function skinPointOnPlane(
  thorax: ThoraxModel,
  plane: { target: Vec3; normal: Vec3 },
  preferred: { u: number; v: number },
  maxShiftCm = 2.5,
): { u: number; v: number } {
  const n = plane.normal;
  const inSkin = Math.hypot(n.x, n.y);
  if (inSkin < 1e-3) return preferred;
  const dx = n.x / inSkin,
    dy = n.y / inSkin;
  let u = preferred.u,
    v = preferred.v;
  for (let iter = 0; iter < 4; iter++) {
    const p = v3(u, v, skinZ(thorax, u, v));
    const err = dot(n, sub(p, plane.target));
    const t = -err / (n.x * dx + n.y * dy);
    u += dx * t;
    v += dy * t;
  }
  const shift = Math.hypot(u - preferred.u, v - preferred.v);
  if (shift > maxShiftCm) {
    const k = maxShiftCm / shift;
    u = preferred.u + (u - preferred.u) * k;
    v = preferred.v + (v - preferred.v) * k;
  }
  return { u, v };
}

/**
 * Share of the sector's rays (80°, 17 rays) that meet lung before the depth of the view target: what a sonographer
 * sees when choosing between two intercostal spaces. The renderer draws only reverberation behind the pleura.
 */
export function lungOcclusion(thorax: ThoraxModel, control: ProbeControl, target: Vec3): number {
  const beam = beamFrameFromPose(poseFromControl(thorax, control), 1);
  const reach = dot(sub(target, beam.origin), beam.forward);
  const RAYS = 17;
  let blocked = 0;
  for (let i = 0; i < RAYS; i++) {
    const a = (i / (RAYS - 1) - 0.5) * ((80 * Math.PI) / 180);
    const dir = add(scale(beam.forward, Math.cos(a)), scale(beam.lateral, Math.sin(a)));
    for (let r = 0.25; r < reach; r += 0.25) {
      const p = add(beam.origin, scale(dir, r));
      if (isAnteriorLung(thorax, p.x, p.y, p.z)) {
        blocked++;
        break;
      }
    }
  }
  return blocked / RAYS;
}

/**
 * Share of the left ventricular wall drawn by a probe control that lies behind lung: the mid-wall surface of the resting
 * ventricle, sampled within 0.5 cm of the image plane and inside the 80° sector, with lung anywhere between the probe
 * and the sample. The renderer shows only reverberation behind the pleura, so this is the wall the image loses.
 */
export function ventricleHiddenShare(
  heart: HeartModel,
  thorax: ThoraxModel,
  control: ProbeControl,
): number {
  const beam = beamFrameFromPose(poseFromControl(thorax, control), 1);
  const { lengthCm: L, rMax, shape } = heart.lv;
  const halfSector = (40 * Math.PI) / 180;
  let seen = 0,
    hidden = 0;
  for (let zi = 1; zi <= 12; zi++) {
    const zeta = zi / 13;
    const r = rMax * lvProfileG(shape, zeta) + 0.45;
    for (let k = 0; k < 48; k++) {
      const phi = (k / 48) * 2 * Math.PI;
      const pT = heartToTorso(
        heart.frame,
        v3(r * Math.cos(phi), r * shape.ratio * Math.sin(phi), zeta * L),
      );
      const d = sub(pT, beam.origin);
      if (Math.abs(dot(d, beam.normal)) > 0.5) continue;
      const dep = dot(d, beam.forward);
      if (dep <= 0 || Math.abs(Math.atan2(dot(d, beam.lateral), dep)) > halfSector) continue;
      seen++;
      const len = Math.hypot(d.x, d.y, d.z);
      for (let t = 0.25; t < len; t += 0.25) {
        const q = add(beam.origin, scale(d, t / len));
        if (isAnteriorLung(thorax, q.x, q.y, q.z)) {
          hidden++;
          break;
        }
      }
    }
  }
  return seen ? hidden / seen : 0;
}

/** Canonical probe control for a view target, computed from the case anatomy (for scoring/ghost only). */
export function canonicalControl(
  view: ViewTarget,
  heart: HeartModel,
  thorax: ThoraxModel,
): ProbeControl {
  const plane = canonicalPlane(view, heart);
  let preferred = view.skin;
  let skin = preferred;
  if (view.window === 'apical') {
    const apex = heartToTorso(heart.frame, v3(0, 0, heart.lv.lengthCm));
    preferred = { u: apex.x, v: apex.y };
    // rotate at the apex and slide at most 2 cm: the exact 60° planes through the long axis would need a 3.4 cm
    // lateral slide for A2C (among the lateral ribs); a real A2C accepts a few degrees of obliquity instead
    const slid = skinPointOnPlane(thorax, plane, preferred, 2.0);
    // A sonographer takes the intercostal space from which the heart is seen. The slid point can fall almost halfway
    // between two spaces: the A3C one did (v −3.1, centres at −1.6 and −4.8), the nearest was the upper space, and
    // there the lingula lies between chest wall and heart — the A3C preset showed 66–83% lung and no LV in eight of
    // the twelve cases (decision 72). The adjacent space wins only when it clearly hides less of the sector: in the
    // eight broken presets it hid 0% of the rays against 65–88%, and elsewhere the difference never exceeded 6%
    // (always choosing the apex's own space instead foreshortened A4C from 9° to 31–41° in three cases).
    const near = snapToIntercostal(thorax, slid.u, slid.v);
    const spacing = ribSpacingAt(thorax, slid.u);
    const other = snapToIntercostal(
      thorax,
      slid.u,
      near.v + (slid.v > near.v ? spacing : -spacing),
    );
    const hidden = (p: { u: number; v: number }): number =>
      lungOcclusion(
        thorax,
        controlAimingAt(thorax, p.u, p.v, plane.target, plane.right, 0.6),
        plane.target,
      );
    skin = hidden(other) < hidden(near) - 0.1 ? other : near;
    // Within that space the slide toward the plane stops before the lung covers the ventricle. Sliding the full 2 cm put
    // the A2C probe over the lung border: the lingula hid 35% of the LV wall in the normal case — the anterior wall — and
    // 23-50% in all twelve, while 1-1.5 cm back toward the apex the wall lay clear (decision 83). The probe keeps the
    // longest slide, the least obliquity, that leaves at most a tenth of the wall behind lung, or failing that no more
    // than 5 points above the clearest position this window allows.
    const back = Math.sign(preferred.u - skin.u);
    const stops = [skin];
    for (let d = 0.5; d < Math.abs(preferred.u - skin.u); d += 0.5)
      stops.push(snapToIntercostal(thorax, skin.u + back * d, skin.v));
    if (Math.abs(preferred.u - skin.u) > 0.25)
      stops.push(snapToIntercostal(thorax, preferred.u, skin.v));
    const hiddenAt = (p: { u: number; v: number }): number =>
      ventricleHiddenShare(
        heart,
        thorax,
        controlAimingAt(thorax, p.u, p.v, plane.target, plane.right, 0.6),
      );
    // a clear first position needs no search: it is the longest slide and within any tolerance
    if (stops.length > 1 && hiddenAt(skin) > 0.1) {
      const hid = stops.map(hiddenAt);
      const tolerated = Math.max(0.1, Math.min(...hid) + 0.05);
      skin = stops[hid.findIndex((h) => h <= tolerated + 1e-9)]!;
    }
  } else if (view.id === 'plax') {
    skin = skinPointOnPlane(thorax, plane, preferred, 1.5);
  } else if (view.window === 'parasternal') {
    // short-axis planes: a sonographer stays close to the PLAX window (3rd–4th space) and tilts the probe,
    // accepting some obliquity, rather than climbing toward the 2nd space; never over the sternum
    const p = skinPointOnPlane(thorax, plane, preferred, 1.0);
    skin = { u: Math.max(2.2, p.u), v: p.v };
    if (view.id === 'psax-av') {
      // The great-vessel level is the exception: its plane is perpendicular to the root, which from the PLAX space cuts
      // the outflow tract 1.4 cm below the annulus (the section through the valve stands 12-14° off the axis there) and
      // from the space above cuts the coaptation (0.7-0.8 cm, 0.4-3° off). A sonographer climbs when the window allows:
      // above the cardiac notch the left lung covers more of the sector (24% of its rays in the normal cases, 47-65%
      // with lung over the outflow tract in the difficult-window, HFrEF and artifact cases), so the upper space is taken
      // only when it hides at most 30% of the rays to the target (decision 133).
      const up = skinPointOnPlane(thorax, plane, preferred, 3.0);
      const high = snapToIntercostal(thorax, Math.max(2.2, up.u), up.v);
      const aim = (q: { u: number; v: number }): ProbeControl =>
        controlAimingAt(thorax, q.u, q.v, plane.target, plane.right, 0.6);
      if (lungOcclusion(thorax, aim(high), plane.target) <= 0.3) skin = high;
    }
  } else if (view.window === 'subcostal') {
    // slide along the costal margin (never above it) until the plane passes through the window
    const p = skinPointOnPlane(thorax, plane, preferred, 2.0);
    skin = { u: p.u, v: Math.min(-8.5, p.v) };
  }
  // a sonographer always sits in an intercostal space, never on a rib (the subcostal window has none)
  if (view.window !== 'subcostal') skin = snapToIntercostal(thorax, skin.u, skin.v);
  return controlAimingAt(thorax, skin.u, skin.v, plane.target, plane.right, 0.6);
}

/** Canonical beam frame per (heart, view), cached: the pose a sonographer would reach for this anatomy. */
const canonicalBeamCache = new WeakMap<HeartModel, Map<string, BeamFrame>>();
export function canonicalBeam(view: ViewTarget, heart: HeartModel, thorax: ThoraxModel): BeamFrame {
  let m = canonicalBeamCache.get(heart);
  if (!m) {
    m = new Map();
    canonicalBeamCache.set(heart, m);
  }
  const key = `${view.id}|${thorax.lungShiftCm}|${thorax.heartOffset.x},${thorax.heartOffset.y},${thorax.heartOffset.z}`;
  let b = m.get(key);
  if (!b) {
    b = beamFrameFromPose(poseFromControl(thorax, canonicalControl(view, heart, thorax)));
    m.set(key, b);
  }
  return b;
}

/** Torso-frame plane basis for a view target (used by tests and the ghost overlay). */
export function canonicalPlane(
  view: ViewTarget,
  heart: HeartModel,
): { target: Vec3; right: Vec3; down: Vec3; normal: Vec3 } {
  let targetH = view.target;
  let rightH = view.planeRight;
  let downH = view.planeDown;
  if (view.id === 'psax-av') {
    // The short axis of the great vessels is the section perpendicular to the aortic root, cut at the coaptation of the
    // closed cusps: that is what makes the valve a circle with the Y of its commissures. The declared plane stood 32.9°
    // off the root axis, so the section rose from 0.2 to 1.0 cm above the annulus across the root and one side cut the
    // cusp bellies against the sinus wall (decision 133). Normal = root axis; the declared beam direction is kept in
    // the plane. The target sits 0.35 cm above the annulus: the root descends ~1 cm with the base (ROOT_EXCURSION), so a
    // fixed plane cuts the closed valve at the bottom of its coaptation zone at end-diastole (t ≈ 0.46), near its top
    // in early diastole (≈ 0.75) and the open cusps at ≈ 1.4 cm in systole; 0.2 cm higher, early diastole showed only
    // the Y's centre (10 samples in the low-resolution frame) and systole only the commissures.
    const A = anchorsCached(heart);
    const axis = A.avAxis;
    const declaredN = normalize(cross(view.planeRight, view.planeDown));
    const n = dot(axis, declaredN) < 0 ? scale(axis, -1) : axis;
    targetH = add(A.avCenter, scale(axis, AV_COAPTATION_HEIGHT - 0.1));
    downH = normalize(sub(view.planeDown, scale(n, dot(view.planeDown, n))));
    const r = cross(downH, n);
    rightH = dot(r, view.planeRight) < 0 ? scale(r, -1) : r;
  }
  if (view.id === 'subcostal-ivc') {
    // The long axis of the cava is the anatomy this view is defined by, and where the cava runs depends on the case
    // (the right atrium's size and position place its floor): a fixed plane sat 0.5 cm beside the cava and the hepatic
    // vein in the pulmonary hypertension case. The plane contains the cava axis, through a point a third of the way
    // from the junction, and keeps the declared beam direction otherwise (decision 131).
    const A = anchorsCached(heart);
    const along = sub(A.ivcB, A.ivcA);
    targetH = add(A.ivcA, scale(along, 0.3));
    const axis = normalize(along);
    rightH = dot(axis, view.planeRight) < 0 ? scale(axis, -1) : axis;
    downH = normalize(sub(view.planeDown, scale(rightH, dot(view.planeDown, rightH))));
  }
  const target = heartToTorso(heart.frame, targetH);
  const right = heartDirToTorso(heart.frame, rightH);
  const down = heartDirToTorso(heart.frame, downH);
  const n = normalize(
    v3(
      right.y * down.z - right.z * down.y,
      right.z * down.x - right.x * down.z,
      right.x * down.y - right.y * down.x,
    ),
  );
  return { target, right, down, normal: n };
}
