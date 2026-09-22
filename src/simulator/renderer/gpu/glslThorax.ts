import {
  ANTERIOR_CORRIDOR_CM,
  FASCIA_HALF_CM,
  FAT_FRACTION,
  PERICARDIAL_FAT_CM,
  SKIN_CM,
} from '@/simulator/anatomy/thoraxModel';

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** GLSL port of thoraxModel.ts (skinZ, isAnteriorLung, classifyThorax). */
export const GLSL_THORAX = /* glsl */ `
const float PERICARDIAL_FAT_CM = ${f(PERICARDIAL_FAT_CM)};
const float ANTERIOR_CORRIDOR_CM = ${f(ANTERIOR_CORRIDOR_CM)};
const float SKIN_CM = ${f(SKIN_CM)};
const float FAT_FRACTION = ${f(FAT_FRACTION)};
const float FASCIA_HALF_CM = ${f(FASCIA_HALF_CM)};
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
  s.m = p; s.extra = 0.0; s.n = vec3(0.0, 0.0, 1.0);
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
    float yDome = liverDomeY(x, z);
    if (y < yDome && z > -14.0) {
      bool fibrous = y > yDome - 0.25;
      s.tissue = fibrous ? T_FIBROUS : T_LIVER; s.structure = fibrous ? S_DIAPH : S_LIVER; s.sdf = fibrous ? -0.1 : -1.0;
      s.n = vec3(0.0, 1.0, 0.0);
      return true;
    }
  }
  {
    float dx = x, dz = z + 17.3;
    float d = sqrt(dx * dx + dz * dz) - 2.2;
    if (d < 0.0) { s.tissue = T_SPINE; s.structure = S_SPINE; s.sdf = d; return true; }
  }
  {
    float dx = x + 1.0, dz = z + 14.2;
    float d = sqrt(dx * dx + dz * dz) - 1.1;
    if (d < 0.0) { s.tissue = T_BLOOD; s.structure = S_DESC_AO; s.sdf = d; s.n = vec3(dx / 1.1, 0.0, dz / 1.1); return true; }
    if (d < 0.2) { s.tissue = T_VESSEL; s.structure = S_DESC_AO; s.sdf = -min(d, 0.2 - d); s.n = vec3(dx / 1.1, 0.0, dz / 1.1); return true; }
  }
  bool lungL = x > leftLungBorderX(y);
  bool lungR = x < rightLungBorderX();

  // the pleural cavities wrap the pericardium (decision 144)
  // beyond the pericardial fat pad and the corridor, outside the posterior and superior mediastinum (thoraxModel.ts, decision 150)
  bool aroundHeart = heartDist > PERICARDIAL_FAT_CM && depth > T + ANTERIOR_CORRIDOR_CM && mediastinumDistance(x, y, z) > 0.0;
  if (lungL || lungR || aroundHeart) { s.tissue = T_LUNG; s.structure = S_LUNG; s.sdf = -1.0; s.n = vec3(0.0, 0.0, 1.0); return true; }
  s.tissue = T_FAT; s.structure = S_NONE; s.sdf = -1.0;
  return true;
}
`;
