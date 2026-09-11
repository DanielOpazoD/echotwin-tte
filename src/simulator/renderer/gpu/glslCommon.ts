import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import { paramDefinesGlsl } from './paramLayout';

/** GLSL defines for the tissue and structure ids used by the shaders (kept in sync with tissue.ts). */
export function enumDefinesGlsl(): string {
  const T: Record<string, number> = {
    T_NONE: Tissue.None,
    T_BLOOD: Tissue.Blood,
    T_MYO: Tissue.Myocardium,
    T_VALVE: Tissue.Valve,
    T_PERI: Tissue.Pericardium,
    T_FAT: Tissue.Fat,
    T_MUSCLE: Tissue.Muscle,
    T_BONE: Tissue.Bone,
    T_CART: Tissue.Cartilage,
    T_LUNG: Tissue.Lung,
    T_FLUID: Tissue.Fluid,
    T_VESSEL: Tissue.VesselWall,
    T_CALC: Tissue.Calcium,
    T_SKIN: Tissue.Skin,
    T_LIVER: Tissue.Liver,
    T_SPINE: Tissue.Spine,
    T_FIBROUS: Tissue.Fibrous,
    T_CHORDAE: Tissue.Chordae,
  };
  const S: Record<string, number> = {
    S_NONE: Structure.None,
    S_LV_CAV: Structure.LvCavity,
    S_LV_SEPT: Structure.LvWallSeptal,
    S_LV_LAT: Structure.LvWallLateral,
    S_LV_ANT: Structure.LvWallAnterior,
    S_LV_INF: Structure.LvWallInferior,
    S_LV_APEX: Structure.LvApex,
    S_PAP: Structure.PapillaryMuscle,
    S_RV_CAV: Structure.RvCavity,
    S_RV_WALL: Structure.RvWall,
    S_RVOT: Structure.Rvot,
    S_LA_CAV: Structure.LaCavity,
    S_LA_WALL: Structure.LaWall,
    S_RA_CAV: Structure.RaCavity,
    S_RA_WALL: Structure.RaWall,
    S_MV_ANT: Structure.MitralAnterior,
    S_MV_POST: Structure.MitralPosterior,
    S_TV: Structure.TricuspidValve,
    S_AV: Structure.AorticValve,
    S_AO_ROOT: Structure.AorticRoot,
    S_LVOT: Structure.Lvot,
    S_PV: Structure.PulmonaryValve,
    S_IAS: Structure.InteratrialSeptum,
    S_MV_ANN: Structure.MitralAnnulus,
    S_TV_ANN: Structure.TricuspidAnnulus,
    S_CHORDAE: Structure.Chordae,
    S_PERI: Structure.Pericardium,
    S_EFFUSION: Structure.PericardialEffusion,
    S_MOD_BAND: Structure.ModeratorBand,
    S_LAA: Structure.LaAppendage,
    S_PVEIN: Structure.PulmonaryVein,
    S_CS: Structure.CoronarySinus,
    S_PA: Structure.PulmonaryArtery,
    S_RV_PAP: Structure.RvPapillary,
    S_SVC: Structure.Svc,
    S_IVC: Structure.Ivc,
    S_HV: Structure.HepaticVein,
    S_DIAPH: Structure.Diaphragm,
    S_EPI_FAT: Structure.EpicardialFat,
    S_CHEST: Structure.ChestWall,
    S_STERNUM: Structure.Sternum,
    S_RIB: Structure.Rib,
    S_LIVER: Structure.Liver,
    S_SPINE: Structure.Spine,
    S_DESC_AO: Structure.DescendingAorta,
    S_LUNG: Structure.Lung,
  };
  return [...Object.entries(T), ...Object.entries(S)].map(([k, v]) => `#define ${k} ${v}`).join('\n');
}

/** Shared GLSL: parameter access, lattice noise, signed-distance primitives. */
export const GLSL_COMMON = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler3D;
uniform sampler2D uParams;   // RGBA32F, 4 floats per texel
uniform sampler3D uNoise;    // RGBA8 128^3: latA, latB, latC, wallNoise
float P(int i) { return texelFetch(uParams, ivec2(i >> 2, 0), 0)[i & 3]; }
${paramDefinesGlsl()}
${enumDefinesGlsl()}
const float PI = 3.14159265358979;
const float TWO_PI = 6.28318530717959;

// value noise on a 128^3 lattice with smoothstep weights (same as core/noise.ts latticeNoise3)
float lat(vec3 p, int ch) {
  vec3 p0 = floor(p);
  vec3 f = p - p0;
  vec3 u = f * f * (3.0 - 2.0 * f);
  ivec3 i0 = ivec3(p0) & 127;
  ivec3 i1 = (i0 + 1) & 127;
  float c000 = texelFetch(uNoise, ivec3(i0.x, i0.y, i0.z), 0)[ch];
  float c100 = texelFetch(uNoise, ivec3(i1.x, i0.y, i0.z), 0)[ch];
  float c010 = texelFetch(uNoise, ivec3(i0.x, i1.y, i0.z), 0)[ch];
  float c110 = texelFetch(uNoise, ivec3(i1.x, i1.y, i0.z), 0)[ch];
  float c001 = texelFetch(uNoise, ivec3(i0.x, i0.y, i1.z), 0)[ch];
  float c101 = texelFetch(uNoise, ivec3(i1.x, i0.y, i1.z), 0)[ch];
  float c011 = texelFetch(uNoise, ivec3(i0.x, i1.y, i1.z), 0)[ch];
  float c111 = texelFetch(uNoise, ivec3(i1.x, i1.y, i1.z), 0)[ch];
  float x00 = mix(c000, c100, u.x);
  float x10 = mix(c010, c110, u.x);
  float x01 = mix(c001, c101, u.x);
  float x11 = mix(c011, c111, u.x);
  float y0 = mix(x00, x10, u.y);
  float y1 = mix(x01, x11, u.y);
  return mix(y0, y1, u.z);
}

float sdEllipsoid(vec3 p, vec3 c, vec3 r) {
  vec3 d = (p - c) / r;
  float k0 = length(d);
  float k1 = length(d / r);
  if (k1 < 1e-9) return -min(r.x, min(r.y, r.z));
  return k0 * (k0 - 1.0) / k1;
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float bb = dot(ba, ba);
  float h = bb > 0.0 ? clamp(dot(pa, ba) / bb, 0.0, 1.0) : 0.0;
  return length(pa - ba * h) - r;
}
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a;
  float l2 = dot(ba, ba);
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  float il2 = 1.0 / l2;
  vec3 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  vec3 x = pa * l2 - ba * y;
  float x2 = dot(x, x);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
float sdTorusZ(vec3 p, vec3 c, float R, float r) {
  float q = length(p.xy - c.xy) - R;
  float dz = p.z - c.z;
  return sqrt(q * q + dz * dz) - r;
}
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
float saddleOffset(float phi, float phiA, float saddle) {
  float sn = sin(phi - phiA);
  return saddle * sn * sn;
}
`;
