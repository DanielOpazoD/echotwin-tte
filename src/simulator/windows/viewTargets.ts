import type { Vec3 } from '@/core/vec3';
import { add, cross, dot, normalize, scale, sub, v3 } from '@/core/vec3';
import type { HeartModel } from '@/simulator/anatomy/heartModel';
import { lvProfileG } from '@/simulator/anatomy/lvShape';
import { AV_COAPTATION_HEIGHT } from '@/simulator/anatomy/aorticValve';
import { anchorsCached, heartDirToTorso, heartToTorso } from '@/simulator/anatomy/heartModel';
import {
  clampToIntercostal,
  isAnteriorLung,
  skinNormal,
  skinZ,
  snapToIntercostal,
  type ThoraxModel,
} from '@/simulator/anatomy/thoraxModel';
import {
  beamFrameFromPose,
  controlAimingAt,
  poseFromControl,
  probeCompressionCm,
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
import { getViewTarget, type ViewTarget } from './viewDefinitions';

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

/**
 * Heart-frame point the apical probe looks from, through the LV apex (decision 139). In clinical four-chamber images the
 * cavity apex lies on the sector centre line (CAMUS Good: 0 mm, interquartile range −3.9 to 3.2) with the ventricle
 * tilted 6° (2–9°) toward the lateral wall, and in two-chamber images it lies 7 mm (4–10) toward the inferior wall with
 * the ventricle tilted 7° (4–11°) the other way. One probe position serves both when the centre line runs from the apex
 * to a point 1.2 cm septal and 1.5 cm inferior of the mitral centre, at the level the apical planes aim at: measured on
 * the rendered images as CAMUS is, the four-chamber apex comes out 3.2 mm from the centre line at 26.9 mm with a 5.7°
 * tilt (CAMUS medians 0, 27.4 and 5.7) and the two-chamber apex −4.4 mm. With 0.8 and 2.0 cm the four-chamber plane
 * passed 4 mm beside the apex and its cavity apex showed 6.2 mm lateral; with 1.0 cm inferior the two-chamber tilt fell
 * to 0.7°.
 */
export const APICAL_PROBE_AIM: Vec3 = v3(-1.2, -1.5, 1.5);
/** Half-height of the probe face across the ribs: the probe stays this far from the rib surfaces (cm). */
const APICAL_FACE_MARGIN_CM = 0.6;
const APICAL_PRESSURE = 0.6;

const apicalSkinCache = new WeakMap<HeartModel, Map<string, { u: number; v: number }>>();

/**
 * The skin point of every apical view (decision 139). A sonographer finds the apex beat and aims down the ventricle, then
 * rotates the probe in place for the two-, three- and five-chamber views: the probe sits where the line from
 * `APICAL_PROBE_AIM` through the LV cavity apex leaves the chest — with its beam origin, pushed under the skin by the
 * probe pressure, on that line — inside the rib-free band of its intercostal space. Until decision 139 each view slid
 * from the anterior projection of the apex toward its own plane; that point lay 2.6 cm septal of the long axis, and the
 * four-chamber apex showed 19 mm lateral of the centre line, 47° off it from the probe. If lung hides more than a tenth of
 * the ventricular wall in the four- or two-chamber view, the probe slides medially along the space (decision 83).
 */
export function apicalSkinPoint(heart: HeartModel, thorax: ThoraxModel): { u: number; v: number } {
  let cache = apicalSkinCache.get(heart);
  if (!cache) {
    cache = new Map();
    apicalSkinCache.set(heart, cache);
  }
  const key = `${thorax.lungShiftCm}|${thorax.chestWall}|${thorax.aw}|${thorax.bDepth}|${thorax.ribSpacing}|${thorax.ribRadius}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const apex = heartToTorso(heart.frame, v3(0, 0, heart.lv.lengthCm));
  const out = normalize(sub(apex, heartToTorso(heart.frame, APICAL_PROBE_AIM)));
  const compress = probeCompressionCm(APICAL_PRESSURE);
  // signed height of the skin point above the beam origin at s cm along the line (positive once outside)
  const above = (s: number): { h: number; u: number; v: number } => {
    const p = add(apex, scale(out, s));
    const q = add(p, scale(skinNormal(thorax, p.x, p.y), compress));
    return { h: q.z - skinZ(thorax, q.x, q.y), u: q.x, v: q.y };
  };
  let lo = 0,
    hi = 0.25;
  while (above(hi).h < 0 && hi < 25) {
    lo = hi;
    hi += 0.25;
  }
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (above(mid).h < 0) lo = mid;
    else hi = mid;
  }
  const exit = above(hi);
  let skin = clampToIntercostal(thorax, exit.u, exit.v, APICAL_FACE_MARGIN_CM);
  const views = [getViewTarget('a4c'), getViewTarget('a2c')].map((v) => canonicalPlane(v, heart));
  const hiddenAt = (p: { u: number; v: number }): number =>
    Math.max(
      ...views.map((pl) =>
        ventricleHiddenShare(
          heart,
          thorax,
          controlAimingAt(thorax, p.u, p.v, pl.target, pl.right, APICAL_PRESSURE),
        ),
      ),
    );
  if (hiddenAt(skin) > 0.1) {
    const stops = [skin];
    for (let d = 0.5; d <= 4; d += 0.5)
      stops.push(clampToIntercostal(thorax, skin.u - d, skin.v, APICAL_FACE_MARGIN_CM));
    const hid = stops.map(hiddenAt);
    const tolerated = Math.max(0.1, Math.min(...hid) + 0.05);
    skin = stops[hid.findIndex((h) => h <= tolerated + 1e-9)]!;
  }
  cache.set(key, skin);
  return skin;
}

/** Canonical probe control for a view target, computed from the case anatomy (for scoring/ghost only). */
export function canonicalControl(
  view: ViewTarget,
  heart: HeartModel,
  thorax: ThoraxModel,
): ProbeControl {
  const plane = canonicalPlane(view, heart);
  const preferred = view.skin;
  let skin = preferred;
  if (view.window === 'apical') {
    skin = apicalSkinPoint(heart, thorax);
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
  // a sonographer always sits in an intercostal space, never on a rib (the subcostal window has none; the apical point
  // is already inside the rib-free band of its space)
  if (view.window !== 'subcostal' && view.window !== 'apical')
    skin = snapToIntercostal(thorax, skin.u, skin.v);
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
    // the plane. The target sits 0.47 cm above the annulus, just above the bottom of the coaptation zone: the root
    // descends ~1 cm with the base (ROOT_EXCURSION), so a fixed plane cuts the closed valve at the bottom of its
    // coaptation zone at end-diastole (t ≈ 0.47), near its top in early diastole (≈ 0.8) and the open cusps at
    // ≈ 1.4 cm in systole; 0.2 cm higher, early diastole showed only the Y's centre (10 samples in the low-resolution
    // frame) and systole only the commissures. Until decision 139 the target was written 0.35 cm above the annulus and
    // the beam, aimed from the skin point instead of its compressed origin, passed 0.1 cm above it: the same cut,
    // reached by two errors; aimed exactly, the 0.2 mm above the zone's bottom keep the end-diastolic cut inside it.
    const A = anchorsCached(heart);
    const axis = A.avAxis;
    const declaredN = normalize(cross(view.planeRight, view.planeDown));
    const n = dot(axis, declaredN) < 0 ? scale(axis, -1) : axis;
    targetH = add(A.avCenter, scale(axis, AV_COAPTATION_HEIGHT + 0.02));
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
