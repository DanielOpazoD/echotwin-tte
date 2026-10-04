import {
  ANTERIOR_CORRIDOR_CM,
  FUNDUS_MEDIAL_X_CM,
  LIVER_LEFT_LOBE_DEPTH_CM,
  FASCIA_HALF_CM,
  FAT_FRACTION,
  PERICARDIAL_FAT_CM,
  SKIN_CM,
  DIAPHRAGM_MAP_N,
  DIAPHRAGM_MAP_NONE_CM,
  UNDERSIDE_FAT_CM,
} from '@/simulator/anatomy/thoraxModel';

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** GLSL port of thoraxModel.ts (skinZ, isAnteriorLung, classifyThorax). */
export const GLSL_THORAX = /* glsl */ `
const float PERICARDIAL_FAT_CM = ${f(PERICARDIAL_FAT_CM)};
const float ANTERIOR_CORRIDOR_CM = ${f(ANTERIOR_CORRIDOR_CM)};
const float FUNDUS_MEDIAL_X_CM = ${f(FUNDUS_MEDIAL_X_CM)};
const float LIVER_LEFT_LOBE_DEPTH_CM = ${f(LIVER_LEFT_LOBE_DEPTH_CM)};
const float SKIN_CM = ${f(SKIN_CM)};
const float FAT_FRACTION = ${f(FAT_FRACTION)};
const float FASCIA_HALF_CM = ${f(FASCIA_HALF_CM)};
const int DM_N = ${DIAPHRAGM_MAP_N};
const float DM_NONE = ${f(DIAPHRAGM_MAP_NONE_CM)};
const float UNDERSIDE_FAT_CM = ${f(UNDERSIDE_FAT_CM)};
float skinZ(float x, float y) {
  float ax = min(abs(x) / TH_AW, 0.999);
  float inner = 1.0 - pow(ax, TH_N);
  float z = -TH_BDEPTH * (1.0 - pow(inner, 1.0 / TH_N));
  if (y > 8.0) z -= 0.12 * (y - 8.0) * (y - 8.0);
  if (y < -8.0) z -= TH_ABD * (-8.0 - y);
  return z;
}
float liverDomeY(float x, float z) {
  float ex = (x + 2.0) / 7.0, ez = (z + 7.0) / 8.0;
  return -8.5 + 3.5 * max(0.0, 1.0 - ex * ex - ez * ez) + TH_DIAPH;
}
// the diaphragm under the right heart, bilinear in its grid (thoraxModel.ts diaphragmMapY, decision 229)
float diaphragmMapY(float x, float z) {
  float fx = x - DM_X0, fz = z - DM_Z0;
  float nm = float(DM_N - 1);
  if (!(fx >= 0.0 && fz >= 0.0 && fx < nm && fz < nm)) return DM_NONE;
  int i = int(floor(fx)), j = int(floor(fz));
  float u = fx - float(i), v = fz - float(j);
  int k = DM_H_BASE + j * DM_N + i;
  float a = P(k), b = P(k + 1), c = P(k + DM_N), d = P(k + DM_N + 1);
  return mix(mix(a, b, u), mix(c, d, u), v);
}
float diaphragmY(float x, float z) { return max(liverDomeY(x, z), diaphragmMapY(x, z)); }
bool isUnderHeart(float x, float y, float z) { return y < diaphragmMapY(x, z) + UNDERSIDE_FAT_CM; }
float leftLungBorderX(float y) {
  float base = 2.4 + max(0.0, 3.5 - y) * 0.75;
  return min(9.0, max(2.0, base)) - TH_LUNGSHIFT;
}
float rightLungBorderX() { return -1.8 + TH_LUNGSHIFT * 0.3; }
float ribSpacingAt(float x) { return TH_RIBSP * (1.0 + 0.03 * abs(x)); }
float ribCenterY(float k, float x) { return TH_RIB2Y - (k - 2.0) * ribSpacingAt(x) + TH_RIBSLOPE * abs(x); }
float ribRadiusAt(float x) { return TH_RIBR * (1.0 - 0.45 * min(1.0, abs(x) / 8.0)); }

bool isAnteriorLung(vec3 p) {
  float depth = skinZ(p.x, p.y) - p.z;
  if (depth <= TH_CHESTWALL) return false;
  float border = leftLungBorderX(p.y);
  if (p.x > border) {
    float thick = min(5.0, (p.x - border) * 1.3 + 0.4);
    return depth < TH_CHESTWALL + thick;
  }
  float rb = rightLungBorderX();
  if (p.x < rb) {
    float thick = min(5.0, (rb - p.x) * 1.3 + 0.4);
    return depth < TH_CHESTWALL + thick;
  }
  return false;
}

// heartDist: distance beyond the pericardial sac that classifyHeart leaves in s.sdf on a miss (decision 144)
bool classifyThorax(vec3 p, out Sample s, float heartDist) {
  float x = p.x, y = p.y, z = p.z;
  float zs = skinZ(x, y);
  float depth = zs - z;
  s.m = p; s.extra = 0.0; s.n = vec3(0.0, 0.0, 1.0); s.transmural = -1.0; s.segment = 0;
  if (depth < 0.0) { s.tissue = T_NONE; s.structure = S_NONE; s.sdf = -depth; return false; }
  if (depth < SKIN_CM) { s.tissue = T_SKIN; s.structure = S_CHEST; s.sdf = -min(depth, SKIN_CM - depth); return true; }
  float T = TH_CHESTWALL;
  if (abs(x) < 1.6 && y > -5.0 && y < 9.5 && depth > T * 0.3 && depth < T * 0.3 + 1.0) { s.tissue = T_BONE; s.structure = S_STERNUM; s.sdf = -0.3; return true; }
  if (abs(x) >= 1.6 && abs(x) < TH_AW * 0.95) {
    float kf = (TH_RIB2Y + TH_RIBSLOPE * abs(x) - y) / ribSpacingAt(x) + 2.0;
    float k = floor(kf + 0.5);
    if (k >= 2.0 && k <= 9.0) {
      float ry = ribCenterY(k, x);
      float rDepth = T * 0.7;
      float rr = ribRadiusAt(x);
      float dy = y - ry, dd = depth - rDepth;
      float dist = sqrt(dy * dy + dd * dd) - rr;
      if (dist < 0.0) {
        s.tissue = abs(x) < 5.0 ? T_CART : T_BONE; s.structure = S_RIB; s.sdf = dist;
        s.n = vec3(0.0, dy / (rr + 1e-6), -dd / (rr + 1e-6));
        return true;
      }
    }
  }
  if (depth < T) {
    // skin, subcutaneous fat, the superficial fascia as a thin coherent sheet, muscle (decision 144)
    float fasciaDepth = T * FAT_FRACTION;
    if (abs(depth - fasciaDepth) < FASCIA_HALF_CM) { s.tissue = T_FIBROUS; s.structure = S_CHEST; s.sdf = -(FASCIA_HALF_CM - abs(depth - fasciaDepth)); return true; }
    s.tissue = depth < fasciaDepth ? T_FAT : T_MUSCLE; s.structure = S_CHEST;
    s.sdf = depth < fasciaDepth ? -min(depth - SKIN_CM, fasciaDepth - FASCIA_HALF_CM - depth) : -min(depth - fasciaDepth - FASCIA_HALF_CM, T - depth);
    return true;
  }
  {
    float yDome = diaphragmY(x, z);
    if (y < yDome && z > -14.0) {
      bool fibrous = y > yDome - 0.25;
      // decision 271: the gastric fundus, a gas interface, left of the midline and behind the left lobe of the liver
      bool fundus = !fibrous && x > FUNDUS_MEDIAL_X_CM && depth > LIVER_LEFT_LOBE_DEPTH_CM;
      s.tissue = fibrous ? T_FIBROUS : (fundus ? T_LUNG : T_LIVER); s.structure = fibrous ? S_DIAPH : (fundus ? S_STOMACH : S_LIVER); s.sdf = fibrous ? -0.1 : -1.0;
      s.n = vec3(0.0, 1.0, 0.0);
      return true;
    }
  }
  {
    float dx = x, dz = z - SPINE_Z - TH_COL_SHIFT;
    float d = sqrt(dx * dx + dz * dz) - SPINE_R;
    if (d < 0.0) { s.tissue = T_SPINE; s.structure = S_SPINE; s.sdf = d; return true; }
  }
  if (y <= TH_DA_TOP) {
    float ra = DESC_AORTA_R * TH_DA_SCALE;
    float dx = x - DESC_AORTA_X, dz = z - DESC_AORTA_Z - TH_COL_SHIFT;
    float d = sqrt(dx * dx + dz * dz) - ra;
    if (d < 0.0) { s.tissue = T_BLOOD; s.structure = S_DESC_AO; s.sdf = d; s.n = vec3(dx / ra, 0.0, dz / ra); return true; }
    if (d < DESC_AORTA_WALL) { s.tissue = T_VESSEL; s.structure = S_DESC_AO; s.sdf = -min(d, DESC_AORTA_WALL - d); s.n = vec3(dx / ra, 0.0, dz / ra); return true; }
  }
  bool lungL = x > leftLungBorderX(y);
  bool lungR = x < rightLungBorderX();

  // the pleural cavities wrap the pericardium (decision 144)
  // beyond the pericardial fat pad and the corridor, outside the posterior and superior mediastinum (thoraxModel.ts, decision 150),
  // and not under the heart, which rests on the diaphragm (decision 229)
  bool outsideMediastinum = mediastinumDistance(x, y, z - TH_COL_SHIFT) > 0.0;
  bool aroundHeart = heartDist > PERICARDIAL_FAT_CM && depth > T + ANTERIOR_CORRIDOR_CM;
  if ((lungL || lungR || aroundHeart) && outsideMediastinum && !isUnderHeart(x, y, z)) { s.tissue = T_LUNG; s.structure = S_LUNG; s.sdf = -1.0; s.n = vec3(0.0, 0.0, 1.0); return true; }
  s.tissue = T_FAT; s.structure = S_NONE; s.sdf = -1.0;
  return true;
}
`;
