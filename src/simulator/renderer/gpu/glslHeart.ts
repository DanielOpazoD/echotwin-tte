/**
 * GLSL port of `classifyHeart` (heartModel.ts). Mirrors the CPU classifier block by block; the
 * equivalence test (e2e/gpu-equivalence.spec.ts) compares both on the canonical views.
 */
import { LV_PROF_BINS } from '@/simulator/anatomy/lvShape';
import {
  PV_INF_DZ,
  PV_INF_Z,
  PV_LEFT_DX,
  PV_LEFT_DY,
  PV_LEFT_INF_T,
  PV_LEFT_SUP_T,
  PV_RADIUS,
  PV_RIGHT_DX,
  PV_RIGHT_DY,
  PV_RIGHT_T,
  PV_SUP_DZ,
  PV_SUP_Z,
} from '@/simulator/anatomy/pulmonaryVeins';
import {
  AV_COAPT_HALF,
  ROOT_ASC_T,
  ROOT_EXCURSION,
  ROOT_SINUS_T,
  ROOT_STJ_T,
} from '@/simulator/anatomy/heartModel';
import {
  AV_PHI0,
  AV_LATERAL_COAPTATION_HEIGHT,
  AV_LATERAL_PROFILE_RADIUS,
  AV_CROWN_EXPONENT,
  AV_OPEN_EDGE_FRACTION,
  AV_OPEN_WALL_GAP,
} from '@/simulator/anatomy/aorticValve';
import {
  AML_ARC_EXTENSION,
  CLOSED_DEPTH,
  CLOSED_REACH,
  MV_BINS,
} from '@/simulator/anatomy/mitralValve';
import {
  SKIRT_ABOVE_CM,
  SKIRT_BELOW_CM,
  SKIRT_FIBRE_CLIP,
  SKIRT_LOBE_PERIOD,
  SKIRT_RADIAL_MARGIN_CM,
  SKIRT_TAPER_START,
  SKIRT_TAPER_WIDTH,
  SKIRT_THICK_BASE,
  SKIRT_THICK_BODY,
  SKIRT_THICK_COMMISSURE,
  SKIRT_THICK_EDGE,
  SKIRT_THICK_FLOOR_CM,
  TV_INFLOW_BULGE_CM,
} from '@/simulator/anatomy/valveSkirt';

import { FAR_FROM_HEART_CM } from '@/simulator/anatomy/classify';

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const GLSL_HEART = /* glsl */ `
const int LV_PROF_BINS = ${LV_PROF_BINS};
const float ROOT_SINUS_T = ${f(ROOT_SINUS_T)};
const float ROOT_STJ_T = ${f(ROOT_STJ_T)};
const float ROOT_ASC_T = ${f(ROOT_ASC_T)};
const float AV_COAPT_HALF = ${f(AV_COAPT_HALF)};
const float ROOT_EXCURSION = ${f(ROOT_EXCURSION)};
const float AV_PHI0 = ${f(AV_PHI0)};
const float AV_LATERAL_COAPTATION_HEIGHT = ${f(AV_LATERAL_COAPTATION_HEIGHT)};
const float AV_LATERAL_PROFILE_RADIUS = ${f(AV_LATERAL_PROFILE_RADIUS)};
const float AV_CROWN_EXPONENT = ${f(AV_CROWN_EXPONENT)};
const float AV_OPEN_EDGE_FRACTION = ${f(AV_OPEN_EDGE_FRACTION)};
const float AV_OPEN_WALL_GAP = ${f(AV_OPEN_WALL_GAP)};
const int MV_BINS = ${MV_BINS};
const float AML_ARC_EXTENSION = ${f(AML_ARC_EXTENSION)};
const float MV_CLOSED_REACH[3] = float[3](${CLOSED_REACH.map(f).join(', ')});
const float MV_CLOSED_DEPTH[3] = float[3](${CLOSED_DEPTH.map(f).join(', ')});
const float PV_LEFT_SUP_T = ${f(PV_LEFT_SUP_T)};
const float PV_LEFT_INF_T = ${f(PV_LEFT_INF_T)};
const float PV_RIGHT_T = ${f(PV_RIGHT_T)};
const float PV_SUP_Z = ${f(PV_SUP_Z)};
const float PV_INF_Z = ${f(PV_INF_Z)};
const float PV_LEFT_DX = ${f(PV_LEFT_DX)};
const float PV_LEFT_DY = ${f(PV_LEFT_DY)};
const float PV_RIGHT_DX = ${f(PV_RIGHT_DX)};
const float PV_RIGHT_DY = ${f(PV_RIGHT_DY)};
const float PV_SUP_DZ = ${f(PV_SUP_DZ)};
const float PV_INF_DZ = ${f(PV_INF_DZ)};
const float PV_RADIUS = ${f(PV_RADIUS)};
const float SKIRT_ABOVE_CM = ${f(SKIRT_ABOVE_CM)};
const float TV_INFLOW_BULGE_CM = ${f(TV_INFLOW_BULGE_CM)};
const float FAR_FROM_HEART_CM = ${f(FAR_FROM_HEART_CM)};
const float SKIRT_BELOW_CM = ${f(SKIRT_BELOW_CM)};
const float SKIRT_RADIAL_MARGIN_CM = ${f(SKIRT_RADIAL_MARGIN_CM)};
const float SKIRT_FIBRE_CLIP = ${f(SKIRT_FIBRE_CLIP)};
const float SKIRT_TAPER_START = ${f(SKIRT_TAPER_START)};
const float SKIRT_TAPER_WIDTH = ${f(SKIRT_TAPER_WIDTH)};
const float SKIRT_LOBE_PERIOD = ${f(SKIRT_LOBE_PERIOD)};
const float SKIRT_THICK_BASE = ${f(SKIRT_THICK_BASE)};
const float SKIRT_THICK_EDGE = ${f(SKIRT_THICK_EDGE)};
const float SKIRT_THICK_FLOOR_CM = ${f(SKIRT_THICK_FLOOR_CM)};
const float SKIRT_THICK_COMMISSURE = ${f(SKIRT_THICK_COMMISSURE)};
const float SKIRT_THICK_BODY = ${f(SKIRT_THICK_BODY)};
struct Sample {
  int tissue;
  int structure;
  float sdf;
  vec3 n;
  vec3 m;
  float extra;
  float transmural; // depth across the LV wall, 0 endocardium → 1 epicardium; −1 elsewhere (decision 144)
};

void setSample(out Sample s, int tissue, float sdf, vec3 n, vec3 m, float extra, int structure) {
  float l = length(n);
  s.tissue = tissue;
  s.sdf = sdf;
  s.n = l > 0.0 ? n / l : n;
  s.m = m;
  s.extra = extra;
  s.structure = structure;
  s.transmural = -1.0;
}

// ---- profile helpers (skirts) ----
float profAt(int base, int i) { return P(base + i); }

// AV-valve skirt: minimum over leaflet zones (radial revolution or parallel-fibre sheets); writes distance, frac, zone, normal
float skirtDistance(vec3 p, vec3 c, float R, int zonesBase, int profBase, int nz, float closed, float blend, float thickness, float saddle, out float dOut, out float fracOut, out int zoneOut, out vec3 nOut) {
  vec2 d = p.xy - c.xy;
  float zr0 = p.z - c.z;
  float rho = length(d);
  zoneOut = 0;
  nOut = vec3(0.0, 0.0, 1.0);
  if (zr0 > SKIRT_ABOVE_CM || zr0 < -SKIRT_BELOW_CM || rho > R + SKIRT_RADIAL_MARGIN_CM) { dOut = 1e3; fracOut = 0.0; return 0.0; }
  float phi = atan(d.y, d.x);
  float zr = zr0 - annulusOffset(phi, TVS_SADDLE_PHI, saddle);
  float best = 1e9, bestFrac = 0.0, bestW = 0.0;
  int bestZone = 0;
  float bestEx = 0.0, bestEz = 1.0, bestCa = 1.0, bestSa = 0.0, bestKind = 0.0;
  for (int zi = 0; zi < 3; zi++) {
    if (zi >= nz) break;
    int zb = zonesBase + zi * 6;
    float zphi = P(zb), zhalf = P(zb + 1), zkind = P(zb + 2), zlobes = P(zb + 3), zc = P(zb + 4);
    float w, rhoS, s;
    float ca = cos(zphi), sa = sin(zphi);
    if (zkind > 0.5) {
      float v = d.x * ca + d.y * sa;
      float u = -d.x * sa + d.y * ca;
      float t = abs(u) / R;
      if (t >= SKIRT_FIBRE_CLIP) continue;
      float vAtt = sqrt(R * R - u * u);
      rhoS = R - (vAtt - v);
      float tw = (t - SKIRT_TAPER_START) / SKIRT_TAPER_WIDTH;
      w = tw <= 0.0 ? 1.0 : 1.0 - tw * tw * (3.0 - 2.0 * tw);
      float sc = sqrt(1.0 - t * t) * (1.0 + zc * t * t);
      if (zlobes > 0.0) sc *= 1.0 + zlobes * cos(TWO_PI * t / SKIRT_LOBE_PERIOD);
      s = 1.0 + (sc - 1.0) * closed;
    } else {
      float dphi = abs(phi - zphi);
      if (dphi > PI) dphi = TWO_PI - dphi;
      float tw = (dphi - (zhalf - blend)) / (2.0 * blend);
      w = tw <= 0.0 ? 1.0 : (tw >= 1.0 ? 0.0 : 1.0 - tw * tw * (3.0 - 2.0 * tw));
      if (w <= 0.0) continue;
      rhoS = rho;
      float q = dphi / zhalf;
      s = 1.0 - zc * q * q * closed;
    }
    int pb = profBase + zi * 8;
    for (int i = 0; i < 3; i++) {
      float ax = R + (P(pb + i * 2) - R) * s, az = P(pb + i * 2 + 1) * s;
      float bx = R + (P(pb + i * 2 + 2) - R) * s, bz = P(pb + i * 2 + 3) * s;
      float ex = bx - ax, ez = bz - az;
      float l2 = ex * ex + ez * ez;
      float uu = l2 > 0.0 ? ((rhoS - ax) * ex + (zr - az) * ez) / l2 : 0.0;
      uu = clamp(uu, 0.0, 1.0);
      float qx = ax + ex * uu - rhoS;
      float qz = az + ez * uu - zr;
      float dd = sqrt(qx * qx + qz * qz);
      if (dd < best) { best = dd; bestFrac = (float(i) + uu) / 3.0; bestW = w; bestZone = zi; bestEx = ex; bestEz = ez; bestCa = ca; bestSa = sa; bestKind = zkind; }
    }
  }
  dOut = best;
  fracOut = bestFrac;
  zoneOut = bestZone;
  // surface normal from the profile edge (like the mitral valve and the CPU skirt): the edge
  // direction in the (rho, z) plane is (ex, ez), so the outward normal is (-ez, ex) rotated into
  // 3D by the radial direction at this point. For radial zones the radial direction is (dx, dy)/rho;
  // for parallel zones it is the zone's perpendicular (-sa, ca).
  float rx, ry;
  if (bestKind > 0.5) {
    rx = -bestSa;
    ry = bestCa;
  } else {
    rx = rho > 1e-6 ? d.x / rho : bestCa;
    ry = rho > 1e-6 ? d.y / rho : bestSa;
  }
  nOut = vec3(-bestEz * rx, -bestEz * ry, bestEx);
  return (thickness * (SKIRT_THICK_BASE + SKIRT_THICK_EDGE * bestFrac) * 0.5 + SKIRT_THICK_FLOOR_CM) * (SKIRT_THICK_COMMISSURE + SKIRT_THICK_BODY * bestW);
}

// ---- mitral apparatus (mitralValve.ts) ----
float mvBin(int tab, int col, float f) {
  float xx = clamp(f - 0.5, 0.0, float(MV_BINS - 1));
  int i = min(MV_BINS - 2, int(floor(xx)));
  float w = xx - float(i);
  int o = tab + col * MV_BINS + i;
  return P(o) * (1.0 - w) + P(o + 1) * w;
}
// annulus height above the hinge plane at (u, v) around the valve centre: saddle and curtain lift
float mvHingeHeight(float u, float v) {
  float theta = atan(abs(u), v);
  float thetaC = atan(sqrt(MVL_R * MVL_R - MVL_D * MVL_D), MVL_D) + AML_ARC_EXTENSION;
  float onCurtain = clamp((thetaC - theta) / AML_ARC_EXTENSION, 0.0, 1.0);
  float r2 = u * u + v * v;
  return MVL_SADDLE * (u * u / (r2 > 0.0 ? r2 : 1.0)) + MVL_LIFT * onCurtain;
}
float mvHingeZ(vec2 p) {
  vec2 d = p - vec2(MVL_CX, MVL_CY);
  return MVL_CZ + mvHingeHeight(-d.x * MVL_UY + d.y * MVL_UX, d.x * MVL_UX + d.y * MVL_UY);
}
float mvOutlineSdf(vec2 p) {
  vec2 d = p - vec2(MVL_CX, MVL_CY);
  return max(length(d) - MVL_R, dot(d, vec2(MVL_UX, MVL_UY)) - MVL_D);
}
bool mvInsideOutline(vec2 p) {
  vec2 d = p - vec2(MVL_CX, MVL_CY);
  return dot(d, d) < MVL_R * 0.98 * (MVL_R * 0.98) && dot(d, vec2(MVL_UX, MVL_UY)) < MVL_D * 0.98;
}
float mvInflowTaper(float h) {
  if (h < 0.0) return h < -0.25 ? 2.0 * (-h - 0.25) : 0.0;
  float beyond = h - MVL_INFLOW_DEPTH;
  return MVL_INFLOW_SLOPE * h + (beyond > 0.0 ? 3.0 * beyond * beyond : 0.0);
}
float mvAnnulusDistance(vec3 p, float tube) {
  vec2 d = p.xy - vec2(MVL_CX, MVL_CY);
  float v = dot(d, vec2(MVL_UX, MVL_UY));
  float u = -d.x * MVL_UY + d.y * MVL_UX;
  float uc = sqrt(MVL_R * MVL_R - MVL_D * MVL_D);
  float rho = length(vec2(u, v));
  if (rho == 0.0) rho = 1e-6;
  float qu = u / rho * MVL_R, qv = v / rho * MVL_R;
  float su = clamp(u, -uc, uc);
  if (qv > MVL_D || (u - su) * (u - su) + (v - MVL_D) * (v - MVL_D) < (u - qu) * (u - qu) + (v - qv) * (v - qv)) {
    qu = su;
    qv = MVL_D;
  }
  float dPlane = length(vec2(u - qu, v - qv));
  float dzz = p.z - (MVL_CZ + mvHingeHeight(qu, qv));
  return sqrt(dPlane * dPlane + dzz * dzz) - tube;
}
// one leaflet (fan of fibres from its focus): updates the nearest hit
void mvLeaflet(float v, float u, float zr0, int tab, int prof, float focusV, float axisSign, float halfSpan, int leaflet, float openness,
               inout float best, inout float bestFrac, inout int bestLeaflet, inout float bestW, inout vec3 bestN) {
  float dv = v - focusV;
  float rho = length(vec2(dv, u));
  if (rho < 1e-6) return;
  float q = atan(u, dv * axisSign) / halfSpan;
  if (q <= -1.0 || q >= 1.0) return;
  float f = (q + 1.0) * 0.5 * float(MV_BINS);
  float hingeS = mvBin(tab, 0, f);
  float reach = mvBin(tab, 1, f);
  float tent = mvBin(tab, 2, f);
  float zr = zr0 - mvBin(tab, 3, f);
  float aq = abs(q);
  float tq = (aq - 0.9) / 0.1;
  float w = aq < 0.9 ? 1.0 : 1.0 - tq * tq * (3.0 - 2.0 * tq);
  float openScale = 0.55 + 0.45 * sqrt(max(0.0, 1.0 - q * q));
  float c = 1.0 - openness;
  float rot = openness > 0.0 ? mvBin(tab, 4, f) : 0.0;
  float cr = cos(rot), sr = sin(rot);
  float inw = hingeS - rho;
  float ix = -(dv * MVL_UX - u * MVL_UY) / rho, iy = -(dv * MVL_UY + u * MVL_UX) / rho;
  float ax = 0.0, az = 0.0;
  for (int i = 0; i < 3; i++) {
    float oa = P(prof + i * 2) * openScale, oz = P(prof + i * 2 + 1) * openScale;
    float bx = reach * MV_CLOSED_REACH[i] * c + (oa * cr + oz * sr) * openness;
    float bz = tent * MV_CLOSED_DEPTH[i] * c + (oz * cr - oa * sr) * openness;
    float ex = bx - ax, ez = bz - az;
    float l2 = ex * ex + ez * ez;
    float sg = l2 > 0.0 ? clamp(((inw - ax) * ex + (zr - az) * ez) / l2, 0.0, 1.0) : 0.0;
    float qx = ax + ex * sg - inw, qz = az + ez * sg - zr;
    float dd = sqrt(qx * qx + qz * qz);
    if (dd < best) {
      best = dd;
      bestFrac = (float(i) + sg) / 3.0;
      bestLeaflet = leaflet;
      bestW = w;
      bestN = vec3(-ez * ix, -ez * iy, ex);
    }
    ax = bx;
    az = bz;
  }
}
// distance to the mitral leaflets; returns the local half thickness
float mitralDistance(vec3 p, out float dOut, out float fracOut, out int leafletOut, out vec3 nOut) {
  dOut = 1e3;
  fracOut = 0.0;
  leafletOut = 0;
  nOut = vec3(0.0, 0.0, 1.0);
  float dx = p.x - MVL_CX, dy = p.y - MVL_CY;
  float zr0 = p.z - MVL_CZ;
  if (zr0 > 3.5 || zr0 < -2.5 || dx * dx + dy * dy > (MVL_R + 2.2) * (MVL_R + 2.2)) return 0.0;
  float v = dx * MVL_UX + dy * MVL_UY;
  float u = -dx * MVL_UY + dy * MVL_UX;
  float best = 1e9, bestFrac = 0.0, bestW = 1.0;
  int bestLeaflet = 0;
  vec3 bestN = vec3(0.0, 0.0, 1.0);
  mvLeaflet(v, u, zr0, MVL_A_TAB_BASE, MVL_A_PROF_BASE, MVL_A_FOCUS, MVL_A_AXIS, MVL_A_HALF, 0, max(MVL_OPEN, MVL_SAM), best, bestFrac, bestLeaflet, bestW, bestN);
  mvLeaflet(v, u, zr0, MVL_P_TAB_BASE, MVL_P_PROF_BASE, MVL_P_FOCUS, MVL_P_AXIS, MVL_P_HALF, 1, MVL_OPEN, best, bestFrac, bestLeaflet, bestW, bestN);
  if (best >= 1e8) return 0.0;
  dOut = best;
  fracOut = bestFrac;
  leafletOut = bestLeaflet;
  nOut = bestN;
  return (MVL_T * (0.6 + 0.4 * bestFrac) * 0.5 + 0.035) * (0.4 + 0.6 * bestW);
}

// ---- aortic root profile and cusps (aorticValve.ts) ----
float rootRadiusAt(float t, float phi) {
  float sinusMax = SINUS_R * (1.0 + 0.06 * cos(CUSP_COUNT * (phi - AV_PHI0)) * ((t > 0.0 && t < ROOT_STJ_T) ? sin(PI * t / ROOT_STJ_T) : 0.0));
  float stjR = min(ASC_R, SINUS_R * 0.88);
  if (t < 0.0) return AV_R * 0.95 + (LVOT_D / 2.0 - AV_R * 0.95) * min(1.0, -t / 1.2);
  if (t < ROOT_SINUS_T) return AV_R + (sinusMax - AV_R) * sin((PI / 2.0) * (t / ROOT_SINUS_T));
  if (t < ROOT_STJ_T) return stjR + (sinusMax - stjR) * 0.5 * (1.0 + cos(PI * (t - ROOT_SINUS_T) / (ROOT_STJ_T - ROOT_SINUS_T)));
  if (t < ROOT_ASC_T) return stjR + (ASC_R - stjR) * 0.5 * (1.0 - cos(PI * (t - ROOT_STJ_T) / (ROOT_ASC_T - ROOT_STJ_T)));
  return ASC_R;
}
// coaptation band on the line to a commissure: [bottom, top]
vec2 aorticBand(float rn) {
  float r = clamp(rn, 0.0, 1.0);
  float margin = CUSP_COUNT == 3.0 ? r * r * r : pow(r, 1.5);
  float top = AVC_EH + (AVC_HCOMM - AVC_EH) * margin;
  if (CUSP_COUNT != 3.0) return vec2(top - (AVC_CH * (1.0 - r) + 0.1 * r), top);
  bool inner = r <= AV_LATERAL_PROFILE_RADIUS;
  float u = inner ? r / AV_LATERAL_PROFILE_RADIUS : (r - AV_LATERAL_PROFILE_RADIUS) / (1.0 - AV_LATERAL_PROFILE_RADIUS);
  float blend = u * u * (3.0 - 2.0 * u);
  float height = inner ? AVC_CH + (AV_LATERAL_COAPTATION_HEIGHT - AVC_CH) * blend : AV_LATERAL_COAPTATION_HEIGHT + (0.1 - AV_LATERAL_COAPTATION_HEIGHT) * blend;
  return vec2(top - height, top);
}
bool aorticContactBand(float t, float r, float phi, out vec2 band) {
  float closed = 1.0 - AVC_OPEN;
  if (closed <= 0.0) return false;
  float hingeT = AVC_HCOMM - 0.1;
  float hingeR = rootRadiusAt(hingeT, phi) - 0.05;
  float restT = (t - AVC_OPEN * hingeT) / closed;
  float restR = (r - AVC_OPEN * hingeR) / closed;
  if (restT < 0.0 || restR < 0.0) return false;
  float wallR = rootRadiusAt(restT, phi);
  if (restR >= wallR * 0.97) return false;
  band = closed * aorticBand(restR / wallR) + AVC_OPEN * hingeT;
  return true;
}
float aorticCuspDistance(float t, float rr, float phi, out float dOut, out float fracOut, out vec2 nOut) {
  dOut = 1e3;
  fracOut = 0.0;
  nOut = vec2(0.0, 1.0);
  if (t < -0.5 || t > AVC_HCOMM + 0.3) return 0.0;
  float per = TWO_PI / CUSP_COUNT;
  float psi = mod(phi - AV_PHI0, per);
  if (psi > per / 2.0) psi -= per;
  float q = psi / (per / 2.0);
  float aq = min(1.0, abs(q));
  float k = 1.0 - sqrt(max(0.0, 1.0 - pow(aq, AV_CROWN_EXPONENT)));
  float tAtt = (AVC_HCOMM - 0.1) * k;
  float rw = rootRadiusAt(tAtt, phi) - 0.02;
  float tTopOpen = AVC_HCOMM - 0.35 + 0.25 * aq * aq;
  float centreWeight = 1.0 - aq * aq;
  float best = 1e9, bestFrac = 0.0;
  vec2 bestN = vec2(0.0, 1.0);
  vec2 a = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    float rn = i == 0 ? 1.0 : (i == 1 ? AV_LATERAL_PROFILE_RADIUS : (i == 2 ? 0.29 : 0.0));
    float tMid = (AVC_EH - AVC_CH) * (1.0 - rn) - AVC_SAG * sin(PI * rn) * (1.0 - aq);
    float edge = aorticBand(rn).x;
    float rc = rw * rn, tc = tMid + (edge - tMid) * k;
    float fo = float(i) / 3.0;
    float to = tAtt + (tTopOpen - tAtt) * fo;
    float wallR = rootRadiusAt(to, phi) - AV_OPEN_WALL_GAP;
    float hangR = AV_R * (1.0 - (1.0 - AV_OPEN_EDGE_FRACTION) * fo);
    float ro = min(wallR, wallR + (hangR - wallR) * centreWeight);
    vec2 b = vec2(rc + (ro - rc) * AVC_OPEN, tc + (to - tc) * AVC_OPEN);
    if (i > 0) {
      vec2 e = b - a;
      float l2 = dot(e, e);
      float sg = l2 > 0.0 ? clamp(dot(vec2(rr, t) - a, e) / l2, 0.0, 1.0) : 0.0;
      float dd = length(a + e * sg - vec2(rr, t));
      if (dd < best) {
        best = dd;
        bestFrac = (float(i - 1) + sg) / 3.0;
        float l = sqrt(l2);
        if (l == 0.0) l = 1.0;
        bestN = vec2(-e.y / l, e.x / l);
      }
    }
    a = b;
  }
  dOut = best;
  fracOut = bestFrac;
  nOut = bestN;
  float tw = (aq - 0.85) / 0.15;
  float w = aq < 0.85 ? 1.0 : 1.0 - tw * tw * (3.0 - 2.0 * tw);
  return (CUSP_T * (0.7 + 0.3 * bestFrac) * 0.5 + 0.012) * (0.4 + 0.6 * w);
}

// distance to a 2-segment cusp chain with tapered width
float sdCuspChain(vec3 p, int segBase, float segLen, vec3 w, float halfW, float taper, out float fracOut) {
  float best = 1e9;
  float bestFrac = 0.0;
  for (int i = 0; i < 2; i++) {
    float hw = halfW * (1.0 - taper * (float(i) + 0.5) / 2.0);
    int o = segBase + i * 6;
    vec3 s0 = vec3(P(o), P(o + 1), P(o + 2));
    vec3 d = vec3(P(o + 3), P(o + 4), P(o + 5));
    vec3 r = p - s0;
    float a = clamp(dot(r, d), 0.0, segLen);
    float b = clamp(dot(r, w), -hw, hw);
    vec3 q = s0 + d * a + w * b - p;
    float dd = length(q);
    if (dd < best) { best = dd; bestFrac = (float(i) + a / segLen) / 2.0; }
  }
  fracOut = bestFrac;
  return best;
}

int ahaSegment(float az, float levelFrac) {
  float deg = mod(az * 180.0 / PI + 28.0, 360.0);
  if (deg < 0.0) deg += 360.0;
  if (levelFrac > 0.93) return 17;
  if (levelFrac > 0.66) {
    if (deg < 45.0 || deg >= 315.0) return 16;
    if (deg < 135.0) return 13;
    if (deg < 225.0) return 14;
    return 15;
  }
  int base = levelFrac <= 0.33 ? 0 : 6;
  if (deg < 60.0) return base + 6;
  if (deg < 120.0) return base + 1;
  if (deg < 180.0) return base + 2;
  if (deg < 240.0) return base + 3;
  if (deg < 300.0) return base + 4;
  return base + 5;
}

// ---- LV bullet profile (lvShape.ts) ----
float lvProfileG(float zeta) {
  if (zeta < 0.0) {
    float v = zeta / LV_ZETATOP;
    return v >= 1.0 ? 0.0 : LV_G0 * sqrt(1.0 - v * v);
  }
  if (zeta <= LV_ZETAMAX) {
    float u = 1.0 - zeta / LV_ZETAMAX;
    return max(0.0, 1.0 - (1.0 - LV_G0) * u * u);
  }
  if (zeta >= 1.0) return 0.0;
  float s = (zeta - LV_ZETAMAX) / (1.0 - LV_ZETAMAX);
  return sqrt(max(0.0, 1.0 - pow(s, LV_N)));
}
float lvProfileDG(float zeta) {
  if (zeta < 0.0) {
    float v = zeta / LV_ZETATOP;
    if (v >= 0.999) return 6.0;
    return -LV_G0 * v / LV_ZETATOP / sqrt(1.0 - v * v);
  }
  if (zeta <= LV_ZETAMAX) {
    float u = 1.0 - zeta / LV_ZETAMAX;
    return 2.0 * (1.0 - LV_G0) * u / LV_ZETAMAX;
  }
  if (zeta >= 1.0) return -6.0;
  float s = (zeta - LV_ZETAMAX) / (1.0 - LV_ZETAMAX);
  float sn = pow(s, LV_N);
  float d = -((LV_N / 2.0) * pow(s, LV_N - 1.0)) / sqrt(max(1e-9, 1.0 - sn)) / (1.0 - LV_ZETAMAX);
  return max(-6.0, d);
}
float lvCavityRadius(float az, float z) {
  float zeta = (z - ZANN) / max(LENGTH_NOW, 1e-3);
  return LV_RMAX * lvProfileG(zeta) * ellipseFactor(LV_RATIO, az);
}
float lvRadialOffsetFactor(float az, float z) {
  float zeta = (z - ZANN) / max(LENGTH_NOW, 1e-3);
  float drdz = LV_RMAX * lvProfileDG(zeta) * ellipseFactor(LV_RATIO, az) / max(LENGTH_NOW, 1e-3);
  return sqrt(1.0 + min(9.0, drdz * drdz));
}
// signed distance to the tabulated cavity surface (polar table from the centre LV_PZC); writes the normal
float lvCavitySdf(float xs, float y, float z, out vec3 n) {
  float ys = y / LV_RATIO;
  float rho2 = xs * xs + ys * ys;
  float rho = sqrt(rho2);
  float dz = z - LV_PZC;
  float phi = rho > 1e-9 ? atan(rho, dz) : (dz >= 0.0 ? 0.0 : PI);
  float rad = sqrt(rho2 + dz * dz);
  float nb = float(LV_PROF_BINS - 1);
  float fk = clamp(phi / PI * nb, 0.0, nb - 1.0001);
  int k = int(floor(fk));
  float t = fk - float(k);
  float R = P(LV_PROF_R_BASE + k) + (P(LV_PROF_R_BASE + k + 1) - P(LV_PROF_R_BASE + k)) * t;
  float S = P(LV_PROF_S_BASE + k) + (P(LV_PROF_S_BASE + k + 1) - P(LV_PROF_S_BASE + k)) * t;
  float f = 1.0 / sqrt(1.0 + S * S);
  float sinP = rad > 1e-9 ? rho / rad : 0.0;
  float cosP = rad > 1e-9 ? dz / rad : 1.0;
  float nr = sinP - S * cosP, nz = cosP + S * sinP;
  float ir = rho > 1e-9 ? 1.0 / rho : 0.0;
  n = vec3(nr * xs * ir, nr * ys * ir / LV_RATIO, nz);
  float q = rho2 > 1e-12 ? sqrt((xs * xs + LV_RATIO * LV_RATIO * ys * ys) / rho2) : 1.0;
  float corr = 1.0 - (1.0 - q) * sinP * sinP;
  return (rad - R) * f * corr;
}

float wallThicknessAt(float az, float levelFrac, float amp) {
  float septalness = 0.5 - 0.5 * cos(az);
  float tBase = LV_LVPWD + (LV_IVSD - LV_LVPWD) * septalness;
  float tED = tBase * axialWallFactor(levelFrac, APEX_T / tBase);
  float wallMod = 1.0 + 0.28 * (lat(vec3(cos(az) * 1.6 + 7.3, sin(az) * 1.6 + 2.1, levelFrac * 2.4), 3) - 0.5) * (1.0 - levelFrac * levelFrac);
  return tED * max(0.6, 1.0 + (LV_THICK_K - 1.0) * (0.35 + 0.65 * amp)) * wallMod;
}


// [rIn, u, rOut, t] without trabecular noise
vec4 rvRadii(float az, float z, float contraction, float tvZ, float rvCollapse) {
  float L = LV_LEN;
  float azN = az < 0.0 ? az + TWO_PI : az;
  float u = (azN - RV_AZA) / (RV_AZP - RV_AZA);
  float rCav = lvCavityRadius(az, z);
  float levelFrac = clamp((z - ZANN) / max(LENGTH_NOW, 1.0), 0.0, 1.0);
  float amp = P(SEG_AMP_BASE + ahaSegment(az, levelFrac));
  float rEpi = rCav + wallThicknessAt(az, levelFrac, amp) * lvRadialOffsetFactor(az, z);
  float rIn = rEpi - septalShiftAt(SEPTAL_SHIFT, az, levelFrac) + 0.05;
  if (u <= 0.0 || u >= 1.0) return vec4(rIn, u, rIn, 0.0);
  float tvPlane = TV_CZ + tvZ;
  float t = RV_T * rvAzProfile(RV_AZA, RV_AZP, u) * rvAxialTaper(tvPlane, RV_APEX_FRAC * L, z) * (1.0 - 0.35 * contraction);
  if (rvCollapse > 0.0 && u < 0.55) t *= 1.0 - 0.65 * rvCollapse * (1.0 - u / 0.55);
  return vec4(rIn, u, rIn + t, t);
}
// tricuspid inflow column (heartModel.ts tvInflowSdf): annular circle narrowing below the hinges, closed on the atrial side
// annulus offset above a point, by its azimuth around the tricuspid centre (valveSkirt.ts skirtOffsetAt)
float tvOffsetAt(vec2 q) {
  vec2 d = q - vec2(TVS_CX, TVS_CY);
  float phi = dot(d, d) > 1e-12 ? atan(d.y, d.x) : 0.0;
  return annulusOffset(phi, TVS_SADDLE_PHI, TVS_SADDLE);
}
float tvInflowSdf(vec3 p) {
  vec2 d = p.xy - vec2(TVS_CX, TVS_CY);
  float r2 = dot(d, d);
  float rho = sqrt(r2);
  float phi = r2 > 1e-12 ? atan(d.y, d.x) : 0.0;
  float h = p.z - (TVS_CZ + annulusOffset(phi, TVS_SADDLE_PHI, TVS_SADDLE));
  float bulge = TV_INFLOW_BULGE_CM * 0.5 * (1.0 - cos(phi - P(TVS_ZONES_BASE + 6)));
  return rho - TVS_R + 0.04 + tvInflowTaper(h, 0.25 + 0.3 * TVZ, bulge);
}
// RV crescent: returns [signed distance, rIn, rOut]
vec3 rvCrescent(vec3 p, float az) {
  vec4 rr = rvRadii(az, p.z, CONTRACTION, TVZ, RV_COLLAPSE);
  float rIn = rr.x, u = rr.y;
  if (u <= 0.0 || u >= 1.0) return vec3(1e3, rIn, rIn);
  float L = LV_LEN;
  float zApex = RV_APEX_FRAC * L;
  float zBase = rvFloorZ(TV_CZ, TVZ, PV_Z, u, tvOffsetAt(p.xy));
  float t = rr.w;
  if (p.z > 0.25 * L) {
    float w = min(1.0, (p.z - 0.25 * L) / (0.35 * L));
    float rs = 1.0 - 0.3 * CONTRACTION;
    float n = lat(vec3((p.x / rs) * 1.4 + 3.1, (p.y / rs) * 1.4 + 9.7, p.z * 0.9 + 5.3), 3) - 0.5;
    t += (0.25 + 0.25 * w) * n - 0.12 * w * w;
  }
  float rOut = rIn + max(0.0, t);
  float r = length(p.xy);
  float d = max(max(rIn - r, r - rOut), max(zBase - p.z, p.z - zApex));
  return vec3(d, rIn, rOut);
}

// Shared RV distance for the pericardium block (recomputed; cheap)
bool classifyHeart(vec3 p0, out Sample s) {
  vec3 p = vec3(p0.x - SWING_X, p0.y, p0.z);
  float x = p.x, y = p.y, z = p.z;
  vec3 bd = p - vec3(BOUND_CX, BOUND_CY, BOUND_CZ);
  if (dot(bd, bd) > BOUND_R * BOUND_R) { s.sdf = FAR_FROM_HEART_CM; return false; }
  float zAnn = ZANN;

  // ---------- aortic root coordinates ----------
  float rootT = -99.0, rootRr = 0.0, rootR = 0.0, rootPhi = 0.0;
  vec3 rootQ = vec3(0.0);
  vec3 avC = vec3(AV_CX, AV_CY, AV_CZ);
  vec3 ax = vec3(AV_AXX, AV_AXY, AV_AXZ);
  {
    float czz = avC.z + zAnn * ROOT_EXCURSION;
    vec3 d = vec3(x - avC.x, y - avC.y, z - czz);
    float t = dot(d, ax);
    if (t > -1.6 && t < 6.5) {
      float bend = rootBend(t);
      rootQ = d - ax * t - vec3(AV_BX, AV_BY, AV_BZ) * bend;
      rootRr = length(rootQ);
      rootT = t;
      rootPhi = atan(dot(rootQ, vec3(AV_E2X, AV_E2Y, AV_E2Z)), dot(rootQ, vec3(AV_E1X, AV_E1Y, AV_E1Z)));
      rootR = rootRadiusAt(t, rootPhi);
    }
  }
  bool inRootLumen = rootT >= -0.05 && rootRr < rootR;
  bool inOutflowLumen = rootT > -1.6 && rootRr < rootR;

  // ---------- valves ----------
  {
    float dM, fr;
    int lf;
    vec3 nM;
    float t = mitralDistance(p, dM, fr, lf, nM);
    if (dM < t) {
      setSample(s, T_VALVE, dM - t, nM, p, MV_CALC, lf == 0 ? S_MV_ANT : S_MV_POST);
      return true;
    }
  }
  if (rootT > -0.5 && rootRr < rootR + 0.02) {
    float dA, frA;
    vec2 nA;
    float hA = aorticCuspDistance(rootT, rootRr, rootPhi, dA, frA, nA);
    if (dA < hA) {
      vec3 u = rootQ / max(rootRr, 1e-6);
      setSample(s, T_VALVE, dA - hA, u * nA.x + ax * nA.y, p, AV_CALC, S_AV);
      return true;
    }
  }
  if (AVC_OPEN < 1.0 && rootT > 0.0 && rootT < AVC_HCOMM && rootRr < rootR * 0.97) {
    vec2 band;
    float axialDistance = 1e3;
    if (aorticContactBand(rootT, rootRr, rootPhi, band)) axialDistance = max(max(band.x - rootT, rootT - band.y), 0.0);
    if (axialDistance < AV_COAPT_HALF) {
      float n = CUSP_COUNT;
      float per = TWO_PI / n;
      float dphi = mod(mod(rootPhi - 0.5 - PI / n, per) + per, per);
      if (dphi > PI / n) dphi = per - dphi;
      float dist = length(vec2(rootRr * sin(dphi), axialDistance));
      if (dist < AV_COAPT_HALF) {
        vec3 u = rootQ / max(rootRr, 1e-6);
        setSample(s, T_VALVE, dist - AV_COAPT_HALF, cross(ax, u), p, AV_CALC, S_AV);
        return true;
      }
    }
  }
  bool outsideAorticRoot = rootT <= -1.6 || rootRr > rootR + 0.22;
  if (outsideAorticRoot && sdCapsule(p, vec3(RVOT_MX, RVOT_MY, RVOT_MZ + PV_Z), vec3(PA_EX, PA_EY, PA_EZ), PA_R + 0.02) < 0.0) {
    for (int i = 0; i < 3; i++) {
      vec3 w = vec3(P(PV_W_BASE + i * 3), P(PV_W_BASE + i * 3 + 1), P(PV_W_BASE + i * 3 + 2));
      float fr;
      float dd = sdCuspChain(p, PV_SEGS_BASE + i * 12, PV_SEGLEN, w, PV_HALF, 0.75, fr);
      float t = PV_T * (1.0 - 0.3 * fr) * 0.5 + 0.03;
      if (dd < t) {
        int o = PV_SEGS_BASE + i * 12 + min(1, int(floor(fr * 2.0))) * 6;
        vec3 d = vec3(P(o + 3), P(o + 4), P(o + 5));
        setSample(s, T_VALVE, dd - t, cross(d, w), p, 0.0, S_PV);
        return true;
      }
    }
  }
  {
    float dS, fr;
    int zn;
    vec3 nS;
    vec3 c = vec3(TVS_CX, TVS_CY, TVS_CZ);
    float t = skirtDistance(p, c, TVS_R, TVS_ZONES_BASE, TVS_PROF_BASE, int(TVS_NZ + 0.5), TVS_CLOSED, TVS_BLEND, TVS_T, TVS_SADDLE, dS, fr, zn, nS);
    if (dS < t) {
      setSample(s, T_VALVE, dS - t, nS, p, 0.0, int(P(TVS_ZONES_BASE + zn * 6 + 5) + 0.5));
      return true;
    }
  }
  {
    float dR = mvAnnulusDistance(p, 0.11);
    if (dR < 0.0) {
      setSample(s, T_FIBROUS, dR, vec3(x - MVL_CX, y - MVL_CY, 0.0), p, 0.15 * MV_CALC, S_MV_ANN);
      return true;
    }
    vec3 q = vec3(TV_RING_X, TV_RING_Y, TV_RING_Z);
    float dT = sdTorusZ(vec3(x, y, z - tvOffsetAt(p.xy)), q, TV_RING_R, 0.09);
    if (dT < 0.0) {
      setSample(s, T_FIBROUS, dT, vec3(x - q.x, y - q.y, 0.0), p, 0.0, S_TV_ANN);
      return true;
    }
  }
  for (int i = 0; i < 10; i++) {
    int o = CHORDAE_BASE + i * 6;
    float d = sdCapsule(p, vec3(P(o), P(o + 1), P(o + 2)), vec3(P(o + 3), P(o + 4), P(o + 5)), 0.045);
    if (d < 0.0) {
      setSample(s, T_CHORDAE, d, vec3(0.0, 0.0, 1.0), p, 0.0, S_CHORDAE);
      return true;
    }
  }

  // ---------- LV cavity & wall ----------
  float az = atan(y, x);
  float levelFrac = clamp((z - zAnn) / max(LENGTH_NOW, 1.0), 0.0, 1.0);
  float septalShift = septalShiftAt(SEPTAL_SHIFT, az, levelFrac);
  float xs = x - septalShift;
  vec3 n0;
  float dProf = lvCavitySdf(xs, y, z, n0);
  float dCav = smax(dProf, zAnn - z, 0.6);
  int seg = ahaSegment(az, levelFrac);
  float amp = P(SEG_AMP_BASE + seg);
  // an akinetic segment keeps its end-diastolic radius; a hyperkinetic one (amp > 1) adds nothing, as on the CPU
  float regional = amp < 1.0 ? (1.0 - amp) * (LV_RMAX_ED - LV_RMAX) * lvProfileG(levelFrac) : 0.0;
  float rs = RADIAL_SCALE, ls = LONG_SCALE;
  float trab = levelFrac > 0.45 ? 0.2 * min(1.0, (levelFrac - 0.45) / 0.35) * (lat(vec3((x / rs) * 2.6 + 11.3, (y / rs) * 2.6 + 2.9, ((z - LV_LEN) / ls) * 1.1 + 6.1), 3) - 0.5) : 0.0;
  float dCavR = dCav - regional + trab;
  float septalness = 0.5 - 0.5 * cos(az);
  float tNow = wallThicknessAt(az, levelFrac, amp);
  // mitral inflow: cavity and wall are the smooth union of the profile with the narrowing annular outline
  bool inRootTube = rootT > -1.6 && rootRr < rootR + 0.2;
  float zHinge = mvHingeZ(p.xy);
  float dInflow = inRootTube ? 1e3 : mvOutlineSdf(p.xy) + 0.04 + mvInflowTaper(z - zHinge);
  float dLvBlood = smin(dCavR, dInflow, 0.3);
  if (dLvBlood < 0.0) {
    float dPa = sdRoundCone(p, vec3(P(PAPS_BASE), P(PAPS_BASE + 1), P(PAPS_BASE + 2)), vec3(P(PAPS_BASE + 3), P(PAPS_BASE + 4), P(PAPS_BASE + 5)), P(PAPS_BASE + 6), P(PAPS_BASE + 7));
    float dPm = sdRoundCone(p, vec3(P(PAPS_BASE + 8), P(PAPS_BASE + 9), P(PAPS_BASE + 10)), vec3(P(PAPS_BASE + 11), P(PAPS_BASE + 12), P(PAPS_BASE + 13)), P(PAPS_BASE + 14), P(PAPS_BASE + 15));
    float dPap = min(dPa, dPm);
    if (dPap < 0.0) {
      setSample(s, T_MYO, dPap, vec3(x, y, 0.0), vec3(x / rs, y / rs, z / ls), 0.0, S_PAP);
      return true;
    }
    setSample(s, T_BLOOD, dLvBlood, n0, vec3(x / rs, y / rs, (z - LV_LEN) / ls), 0.0, (dCavR >= 0.0 && z < zHinge) ? S_LA_CAV : S_LV_CAV);
    return true;
  }
  float wallT = tNow;
  float dEllR = smin(dProf, dInflow, 0.3) - regional;
  if (dEllR + trab >= 0.0 && dEllR < wallT && z >= zAnn - 0.25 && !inOutflowLumen) {
    int structure = S_LV_LAT;
    if (z > LV_LEN - 0.6) structure = S_LV_APEX;
    else if (septalness > 0.7) structure = S_LV_SEPT;
    else if (sin(az) > 0.5) structure = S_LV_ANT;
    else if (sin(az) < -0.5) structure = S_LV_INF;
    bool nearEpi = wallT - dEllR < dEllR;
    // only the smooth epicardium reflects coherently; the trabeculated endocardium scatters (decision 144)
    float dIn = nearEpi ? -(wallT - dEllR) : -wallT;
    float sg = nearEpi ? 1.0 : -1.0;
    setSample(s, T_MYO, dIn, sg * n0, vec3(x / rs, y / rs, (z - LV_LEN) / ls), 0.0, structure);
    s.transmural = clamp(dEllR / wallT, 0.0, 1.0);
    return true;
  }
  bool inAnnularRegion = dEllR < 0.0 && z < zAnn && !inRootLumen;
  if (inAnnularRegion) {
    if (mvInsideOutline(p.xy)) {
      setSample(s, T_BLOOD, -0.3, vec3(0.0, 0.0, 1.0), p, 0.0, S_LA_CAV);
      return true;
    }
  }

  // ---------- aortic root / LVOT ----------
  if (rootT > -1.6) {
    float wall = 0.2;
    if (rootRr < rootR) {
      setSample(s, T_BLOOD, rootRr - rootR, rootQ / rootRr, vec3(x, y, z - zAnn * ROOT_EXCURSION), 0.0, rootT < 0.0 ? S_LVOT : S_AO_ROOT);
      return true;
    }
    if (rootRr < rootR + wall) {
      float dIn = -min(rootRr - rootR, rootR + wall - rootRr);
      setSample(s, T_VESSEL, dIn, rootQ / rootRr, p, 0.0, S_AO_ROOT);
      return true;
    }
  }
  if (inAnnularRegion && z > zAnn - 1.2) {
    setSample(s, T_FIBROUS, -0.15, vec3(0.0, 0.0, 1.0), p, 0.0, S_LV_SEPT);
    return true;
  }

  // the base the ventricle vacated as the annulus descended, atrium now (decision 133); read again by the pericardium
  float raSleeve = 1e3;
  // ---------- atria ----------
  vec3 la = vec3(LA_CX, LA_CY, LA_CZ);
  vec3 lr = vec3(LA_RX, LA_RY, LA_RZ);
  vec3 ra = vec3(RA_CX, RA_CY, RA_CZ);
  vec3 rar = vec3(RA_RX, RA_RY, RA_RZ);
  float bo = atrialScale(LA_BOOSTER, LA_RESERVOIR, CONTRACTION);
  float czL, rzL, czR, rzR;
  {
    float zTop = la.z - lr.z;
    float zBottom = zAnn + 0.25;
    czL = (zTop + zBottom) / 2.0;
    rzL = (zBottom - zTop) / 2.0;
    float xIas = IAS_X;
    float fo = length(vec2((y - FOSSA_Y) / 0.6, (z - FOSSA_Z) / 0.7));
    float tIas = iasThickness(fo);
    float dEllLa = sdEllipsoid(p, vec3(la.x, la.y, czL), vec3(lr.x * bo, lr.y * bo, rzL));
    float dFreeLa = smax(smax(dEllLa, la.y - 0.72 * lr.y * bo - y, 0.6), zTop + 0.15 * rzL - z, 0.5);
    float d = smax(dFreeLa, xIas + tIas / 2.0 - x, 0.3);
    if (d < 0.0) {
      setSample(s, T_BLOOD, d, vec3((x - la.x) / lr.x, (y - la.y) / lr.y, (z - czL) / rzL), p, 0.0, S_LA_CAV);
      return true;
    }
    if (dFreeLa < 0.25 && x > xIas + tIas / 2.0) {
      setSample(s, T_MYO, -min(dFreeLa, 0.25 - dFreeLa), vec3((x - la.x) / lr.x, (y - la.y) / lr.y, (z - czL) / rzL), p, 0.0, S_LA_WALL);
      return true;
    }
    float zTopR = ra.z - rar.z;
    // the atrium ends at the annulus (decision 64): mirrors classifyHeart
    float tvOff = tvOffsetAt(p.xy);
    float zBotR = TV_CZ + TVZ + tvOff + 0.03;
    czR = (zTopR + zBotR) / 2.0;
    rzR = (zBotR - zTopR) / 2.0;
    float raC = raCollapseScale(RA_COLLAPSE);
    float dEllRa = sdEllipsoid(p, vec3(ra.x, ra.y, czR), vec3(rar.x * bo * raC, rar.y * bo * raC, rzR));
    float dFreeRa = smax(dEllRa, ra.y - 0.8 * rar.y * bo - y, 0.6);
    if (TVZ > 0.05) {
      vec4 rr0 = rvRadii(az, z, 0.0, 0.0, 0.0);
      float u0 = rr0.y;
      if (u0 > 0.0 && u0 < 1.0) {
        float r0 = length(p.xy);
        raSleeve = max(max(rr0.x + 0.1 - r0, r0 - (rr0.z - RV_FW)), max(rvFloorZ(TV_CZ, 0.0, 0.0, u0, tvOff) - z, z - rvFloorZ(TV_CZ, TVZ, PV_Z, u0, tvOff)));
      }
    }
    dFreeRa = min(dFreeRa, raSleeve);
    float dR = smax(dFreeRa, x - (xIas - tIas / 2.0), 0.3);
    if (dR < 0.0) {
      setSample(s, T_BLOOD, dR, vec3((x - ra.x) / rar.x, (y - ra.y) / rar.y, (z - czR) / rzR), p, 0.0, S_RA_CAV);
      return true;
    }
    if (dFreeRa < 0.22 && x < xIas - tIas / 2.0) {
      // no wall across the tricuspid orifice (decision 64): atrial blood up to the annular plane, ventricular past it
      if (length(vec2(x - TVS_CX, y - TVS_CY)) < TVS_R) {
        setSample(s, T_BLOOD, dFreeRa - 0.22, vec3((x - ra.x) / rar.x, (y - ra.y) / rar.y, (z - czR) / rzR), p, 0.0, z > TV_CZ + TVZ + tvOff ? S_RV_CAV : S_RA_CAV);
        return true;
      }
      setSample(s, T_MYO, -min(dFreeRa, 0.22 - dFreeRa), vec3((x - ra.x) / rar.x, (y - ra.y) / rar.y, (z - czR) / rzR), p, 0.0, S_RA_WALL);
      return true;
    }
    if (abs(x - xIas) <= tIas / 2.0 && z < zAnn + 0.4) {
      if (sdEllipsoid(vec3(xIas, y, z), vec3(la.x, la.y, czL), vec3(lr.x * bo, lr.y * bo, rzL)) < 0.45 || sdEllipsoid(vec3(xIas, y, z), vec3(ra.x, ra.y, czR), vec3(rar.x * bo * raC, rar.y * bo * raC, rzR)) < 0.45) {
        setSample(s, T_MYO, -(tIas / 2.0 - abs(x - xIas)), vec3(1.0, 0.0, 0.0), p, 0.0, S_IAS);
        return true;
      }
    }
    // appendage
    {
      vec3 a0 = vec3(la.x + lr.x * 0.55, la.y + lr.y * 0.55, czL + 0.4);
      vec3 a1 = vec3(la.x + lr.x * 0.95, a0.y + 2.0, czL + 0.9);
      float lob = 0.12 * (lat(vec3(x * 2.3 + 1.7, y * 2.3 + 4.2, z * 2.3 + 8.8), 3) - 0.5);
      float dApp = sdCapsule(p, a0, a1, 0.55 * bo + lob);
      if (dApp < 0.0) {
        setSample(s, T_BLOOD, dApp, vec3(0.0, 1.0, 0.0), p, 0.0, S_LAA);
        return true;
      }
      if (dApp < 0.18) {
        setSample(s, T_MYO, -min(dApp, 0.18 - dApp), vec3(0.0, 1.0, 0.0), p, 0.0, S_LA_WALL);
        return true;
      }
    }
    // pulmonary veins: towards the hila from the lateral wall (left) and the posteromedial corner (right); mirror of
    // pulmonaryVeins.ts (decision 143)
    for (int i = 0; i < 4; i++) {
      float sx = (i == 0 || i == 2) ? -1.0 : 1.0;
      bool sup = i < 2;
      float dzN = sup ? PV_SUP_Z : PV_INF_Z;
      float kz = sqrt(1.0 - dzN * dzN);
      float t = sx > 0.0 ? (sup ? PV_LEFT_SUP_T : PV_LEFT_INF_T) : PV_RIGHT_T;
      float px = la.x + sx * lr.x * bo * kz * cos(t);
      float py0 = la.y - lr.y * bo * kz * sin(t);
      float pz = czL + dzN * rzL;
      float dPv = sdCapsule(p, vec3(px, py0, pz), vec3(px + sx * (sx > 0.0 ? PV_LEFT_DX : PV_RIGHT_DX), py0 - (sx > 0.0 ? PV_LEFT_DY : PV_RIGHT_DY), pz + (sup ? PV_SUP_DZ : PV_INF_DZ)), PV_RADIUS);
      if (dPv < 0.0) {
        setSample(s, T_BLOOD, dPv, vec3(0.0, -1.0, 0.0), p, 0.0, S_PVEIN);
        return true;
      }
      if (dPv < 0.12) {
        setSample(s, T_VESSEL, -min(dPv, 0.12 - dPv), vec3(0.0, -1.0, 0.0), p, 0.0, S_PVEIN);
        return true;
      }
    }
    // venae cavae and hepatic vein
    {
      float dSvc = sdCapsule(p, vec3(SVC_AX, SVC_AY, SVC_AZ), vec3(SVC_BX, SVC_BY, SVC_BZ), SVC_R);
      if (dSvc < 0.0) { setSample(s, T_BLOOD, dSvc, vec3(0.0, 0.0, -1.0), p, 0.0, S_SVC); return true; }
      if (dSvc < 0.12) { setSample(s, T_VESSEL, -min(dSvc, 0.12 - dSvc), vec3(0.0, 0.0, -1.0), p, 0.0, S_SVC); return true; }
      float dIvc = sdCapsule(p, vec3(IVC_AX, IVC_AY, IVC_AZ), vec3(IVC_BX, IVC_BY, IVC_BZ), IVC_R);
      if (dIvc < 0.0) { setSample(s, T_BLOOD, dIvc, vec3(0.0, 0.0, 1.0), p, 0.0, S_IVC); return true; }
      if (dIvc < 0.12) { setSample(s, T_VESSEL, -min(dIvc, 0.12 - dIvc), vec3(0.0, 0.0, 1.0), p, 0.0, S_IVC); return true; }
      float dHv = sdCapsule(p, vec3(HV_AX, HV_AY, HV_AZ), vec3(HV_BX, HV_BY, HV_BZ), 0.4);
      if (dHv < 0.0) { setSample(s, T_BLOOD, dHv, vec3(0.0, 0.0, 1.0), p, 0.0, S_HV); return true; }
      if (dHv < 0.08) { setSample(s, T_VESSEL, -min(dHv, 0.08 - dHv), vec3(0.0, 0.0, 1.0), p, 0.0, S_HV); return true; }
    }
    // coronary sinus
    {
      float rInflow = -MVL_CY + sqrt(max(0.0, MVL_R * MVL_R - MVL_CX * MVL_CX)) - mvInflowTaper(0.6);
      float gy = -(max(lvCavityRadius(-PI / 2.0, zAnn + 0.6), rInflow) + LV_LVPWD * LV_THICK_K + 0.4);
      float dCs = sdCapsule(p, vec3(2.2, gy * 0.85, zAnn + 0.35), vec3(ra.x + rar.x * 0.4, gy * 0.7, zAnn + 0.1), 0.33);
      if (dCs < 0.0) {
        setSample(s, T_BLOOD, dCs, vec3(0.0, -1.0, 0.0), p, 0.0, S_CS);
        return true;
      }
      if (dCs < 0.1) {
        setSample(s, T_VESSEL, -min(dCs, 0.1 - dCs), vec3(0.0, -1.0, 0.0), p, 0.0, S_CS);
        return true;
      }
    }
  }

  // ---------- RV ----------
  vec3 rvc = rvCrescent(p, az);
  float dRv = rvc.x;
  float dRvU = smin(dRv, tvInflowSdf(p), 0.3);
  {
    float sc = CONTRACTION;
    float fw = rvFreeWallNow(RV_FW, sc);
    float k = rvOutflowScale(sc);
    // the outflow tract and the pulmonary root move with the base; the bifurcation stays (decision 111)
    vec3 rvotA = vec3(RVOT_AX, RVOT_AY, RVOT_AZ + PV_Z);
    vec3 rvotM = vec3(RVOT_MX, RVOT_MY, RVOT_MZ + PV_Z);
    vec3 rvotB = vec3(RVOT_BX, RVOT_BY, RVOT_BZ + PV_Z);
    vec3 paEnd = vec3(PA_EX, PA_EY, PA_EZ);
    float dRvot = min(sdRoundCone(p, rvotA, rvotM, RVOT_RA * k, RVOT_RM * k), sdRoundCone(p, rvotM, rvotB, RVOT_RM * k, RVOT_R * k));
    vec3 paStj = vec3(PA_SX, PA_SY, PA_SZ + PV_Z);
    float dPa = min(sdRoundCone(p, rvotB, paStj, PA_ROOT_R, PA_R), sdCapsule(p, paStj, paEnd, PA_R));
    float dRpa = sdCapsule(p, paEnd, vec3(RPA_EX, RPA_EY, RPA_EZ), RPA_R);
    float dLpa = sdCapsule(p, paEnd, vec3(LPA_EX, LPA_EY, LPA_EZ), LPA_R);
    float dTrunk = min(dPa, min(dRpa, dLpa));
    vec3 v = p - rvotB;
    if (dTrunk < 0.0) {
      setSample(s, T_BLOOD, dTrunk, v, p, 0.0, S_PA);
      return true;
    }
    if (dTrunk < 0.18 && dRvot > 0.0 && dRvU > 0.0) {
      setSample(s, T_VESSEL, -min(dTrunk, 0.18 - dTrunk), v, p, 0.0, S_PA);
      return true;
    }
    float dCavRv = min(dRvU, dRvot);
    float sc3 = 1.0 - 0.3 * sc;
    if (dCavRv < 0.0) {
      if (dRv < 0.0) {
        float L = LV_LEN;
        float rIn = rvc.y, rOut = rvc.z;
        vec3 b0 = vec3(-(rIn + 0.12), -0.2, L * 0.6);
        float rB = rOut - fw * 1.2;
        vec3 b1 = vec3(rB * cos(RV_PAP_AZ), rB * sin(RV_PAP_AZ), L * 0.68);
        float dBand = sdCapsule(p, b0, b1, 0.28);
        if (dBand < 0.0) {
          setSample(s, T_MYO, dBand, vec3(0.0, 0.0, 1.0), p, 0.0, S_MOD_BAND);
          return true;
        }
        float dRp = sdRoundCone(p, vec3(P(RVPAP_BASE), P(RVPAP_BASE + 1), P(RVPAP_BASE + 2)), vec3(P(RVPAP_BASE + 3), P(RVPAP_BASE + 4), P(RVPAP_BASE + 5)), P(RVPAP_BASE + 6), P(RVPAP_BASE + 7));
        if (dRp < 0.0) {
          setSample(s, T_MYO, dRp, vec3(x, y, 0.0), p, 0.0, S_RV_PAP);
          return true;
        }
      }
      float rr = length(p.xy); if (rr == 0.0) rr = 1.0;
      setSample(s, T_BLOOD, dCavRv, vec3(x / rr, y / rr, 0.0), vec3(x / sc3, y / sc3, z), 0.0, dRvot < dRvU ? S_RVOT : ((dRv >= 0.0 && z <= TV_CZ + TVZ + tvOffsetAt(p.xy)) ? S_RA_CAV : S_RV_CAV));
      return true;
    }
    if (dCavRv < fw) {
      float rr = length(p.xy); if (rr == 0.0) rr = 1.0;
      setSample(s, T_MYO, -min(dCavRv, fw - dCavRv), vec3(x / rr, y / rr, 0.0), vec3(x / sc3, y / sc3, z), 0.0, S_RV_WALL);
      return true;
    }
  }

  // ---------- pericardium & effusion ----------
  {
    float dLvEpi = dEllR - wallT;
    float fw = RV_FW;
    float dRvEpi = dRvU - fw;
    float dLaEpi = sdEllipsoid(p, la, lr + 0.25);
    float dRaEpi = min(sdEllipsoid(p, ra, rar + 0.22), raSleeve + 0.22);
    // the sac around the outflow tract and the trunk stays where the pericardium is anchored (decision 111)
    vec3 rvotA = vec3(RVOT_AX, RVOT_AY, RVOT_AZ);
    vec3 rvotB = vec3(RVOT_BX, RVOT_BY, RVOT_BZ);
    vec3 paEnd = vec3(PA_EX, PA_EY, PA_EZ);
    float dRvotEpi = sdCapsule(p, rvotA, rvotB, RVOT_RA + fw);
    vec3 paStj = vec3(PA_SX, PA_SY, PA_SZ);
    float dPaEpi = min(sdRoundCone(p, rvotB, paStj, PA_ROOT_R + 0.2, PA_R + 0.2), sdCapsule(p, paStj, paEnd, PA_R + 0.2));
    float dEpi = smin(smin(smin(dLvEpi, dRvEpi, 0.8), smin(dLaEpi, dRaEpi, 0.8), 0.8), smin(dRvotEpi, dPaEpi, 0.8), 0.8);
    float eff = EFFUSION;
    vec3 nEpi = n0;
    if (dEpi < 0.0) {
      setSample(s, T_FAT, dEpi, nEpi, p, 0.0, S_EPI_FAT);
      return true;
    }
    if (dEpi < 0.12) {
      float de = max(dEpi, 0.0);
      setSample(s, T_PERI, -min(de, 0.12 - de), nEpi, p, 0.0, S_PERI);
      return true;
    }
    if (eff > 0.0 && dEpi < 0.12 + eff) {
      setSample(s, T_FLUID, dEpi - 0.12 - eff, nEpi, p, 0.0, S_EFFUSION);
      return true;
    }
    if (eff > 0.0 && dEpi < 0.12 + eff + 0.12) {
      setSample(s, T_PERI, 0.0, nEpi, p, 0.0, S_PERI);
      return true;
    }
    // outside the sac: distance beyond the parietal pericardium or the wall of the ascending aorta (decision 144)
    float dSac = dEpi - 0.12 - (eff > 0.0 ? eff + 0.12 : 0.0);
    float dRoot = rootT > -90.0 ? rootRr - rootR - 0.2 : dSac;
    s.sdf = min(dSac, dRoot);
  }
  return false;
}
`;
