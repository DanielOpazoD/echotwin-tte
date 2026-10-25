/**
 * GLSL of the heart read from a label volume (decision 353): the mirror of `anatomy/volumeHeart.ts` for pass A, compiled
 * into a variant of it (`VOLUME_HEART`) when the scene carries the volume. The backward map of the motion (decision 350)
 * takes each frame's numbers from the CPU (`motionParams`), the geometry and every constant come as uniforms, and the
 * volume, its fields and the slice tables as textures, so no number of the anatomy is written twice. The leaflets and
 * chords are the analytic heart's of the frame (`classifyHeart`, called once: a shader with two inlined copies of the
 * classifier fails under SwiftShader). Shipped with the volume's code, outside the WebGL2 chunk.
 */
export const GLSL_VOLUME_HEART = /* glsl */ `
uniform highp usampler3D uVolLabel; // labels (R8UI)
uniform highp sampler3D uVolField;  // distance beyond the epicardium (mm), to the nearest interface (mm), octahedral normal
uniform highp sampler2D uVolSlices; // per slice: LV cx, cy, RV cx, cy, radius, endocardial and epicardial sector radii
uniform ivec2 uVolMap[64];          // tissue, structure of labels 0–63 (tissue −1: not heart)
uniform ivec2 uVolFat;              // tissue, structure of the groove fat
uniform int uVolFatLabel;
uniform uvec2 uVolHosts;            // labels that may hold the analytic leaflets (bit l of x for l < 32, of y for l − 32)
uniform uvec2 uVolLeftAtrium, uVolRightAtrium; // each atrium's labels
uniform ivec3 uVolDims;
uniform vec3 uVolGridO;
uniform float uVolVox;
uniform vec3 uVolMO, uVolMX, uVolMY, uVolMZ;
uniform float uVolFar;
uniform vec3 uVolFO, uVolFX, uVolFY, uVolFZ;
uniform float uVolK, uVolL, uVolHand;
uniform vec2 uVolApicalRamp;        // where the stretch's ramp starts (the cavity's tip) and ends (the apex), cm
uniform int uVolNSlices, uVolSectors;
uniform float uVolSliceCm;
uniform vec4 uVolAtria[2];          // cx, cy, reach, present
uniform float uVolPeri;             // pericardium (cm)
uniform vec4 uVolTwistProfile;      // base and apex (deg), LV fade (cm), apical share of the length
uniform vec4 uVolRvShape;           // descent from, to (cm); RV reach fade from, to (over its radius)
uniform vec4 uVolBand;              // LV taper above the annulus (−1, 0), atrial band (0.5, −0.5) (cm)
// the frame's motion
uniform int uVolMotion;
uniform int uVolApparatus;
uniform int uVolAoLabel;             // the root's blood label where the analytic cusps are drawn, -1 for none (decision 373)
uniform vec3 uVolAoC, uVolAoN, uVolAoO; // the CT's valve plane: centre and axis (reference frame), and the map's offset
uniform mat3 uVolAoM;                // the map of a reference point onto the analytic valve
uniform vec2 uVolAoReach;            // reach of the cusps along the axis (cm)
uniform float uVolSL, uVolSR, uVolCapLambda, uVolAlpha, uVolTwist, uVolRoof, uVolRvRatio;
uniform vec2 uVolAtrialScale;

bool volHas(uvec2 set, int l) {
  if (l < 0 || l >= 64) return false;
  uint bit = 1u << uint(l & 31);
  return ((l < 32 ? set.x : set.y) & bit) != 0u;
}
float volSmooth(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
float volCol(int col, int row) { return texelFetch(uVolSlices, ivec2(col, row), 0).r; }
float volSlice(float z, int col) {
  float f = clamp(z / uVolSliceCm, 0.0, float(uVolNSlices - 1));
  int i0 = int(floor(f));
  int i1 = min(uVolNSlices - 1, i0 + 1);
  float a = volCol(col, i0);
  return a + (volCol(col, i1) - a) * (f - float(i0));
}
float volSector(float z, float th, int base) {
  float f = clamp(z / uVolSliceCm, 0.0, float(uVolNSlices - 1));
  int i0 = int(floor(f));
  int i1 = min(uVolNSlices - 1, i0 + 1);
  float S = float(uVolSectors);
  float dth = 2.0 * PI / S;
  float g = mod((th + PI) / dth - 0.5 + S, S);
  int t0 = int(floor(g));
  int t1 = (t0 + 1) % uVolSectors;
  float ft = g - float(t0);
  float a0 = volCol(base + t0, i0), b0 = volCol(base + t1, i0);
  float a1 = volCol(base + t0, i1), b1 = volCol(base + t1, i1);
  float v0 = a0 + (b0 - a0) * ft, v1 = a1 + (b1 - a1) * ft;
  return v0 + (v1 - v0) * (f - float(i0));
}
/** The grid position (voxels, fractional) of an anatomical point (mm of the mesh). */
vec3 volGrid(vec3 a) {
  return (uVolMO + a.x * uVolMX + a.y * uVolMY + a.z * uVolMZ - uVolGridO) / uVolVox;
}
int volLabelAtGrid(ivec3 c) {
  if (any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, uVolDims))) return -1;
  return int(texelFetch(uVolLabel, c, 0).r);
}
int volLabelAtAnat(float x, float y, float z) {
  return volLabelAtGrid(ivec3(floor(volGrid(vec3(x, y, z) / uVolK))));
}
float volAtrialWeight(float z, float d, float r) {
  return volSmooth(uVolBand.z, uVolBand.w, z) * (1.0 - volSmooth(1.0, 1.0 + 1.0 / r, d));
}
vec2 volAtrialBack(int ai, float px, float py, float zr) {
  vec4 a = uVolAtria[ai];
  float d = length(vec2(px - a.x, py - a.y)) / a.z;
  float w = volAtrialWeight(zr, d, a.z);
  float sc = 1.0 + (uVolAtrialScale[ai] - 1.0) * w;
  return vec2(a.x + (px - a.x) / sc, a.y + (py - a.y) / sc);
}
/** The cavity's longitudinal stretch for a base descent s0: the LV's end stays at L (decision 362). */
float volCavityLambda(float s0) {
  float zR = uVolApicalRamp.x, zT = uVolApicalRamp.y, w = zT - zR;
  return (uVolL - s0 - uVolCapLambda * (0.5 * w + (uVolL - zT))) / (zR + 0.5 * w);
}
/** The longitudinal stretch at reference height zr: the cavity's lc, then the apical cap's ramp (decision 362). */
float volStretchAt(float zr, float lc) {
  float zR = uVolApicalRamp.x, zT = uVolApicalRamp.y;
  return zr <= zR ? lc : zr >= zT ? uVolCapLambda : lc + (uVolCapLambda - lc) * (zr - zR) / (zT - zR);
}
/** Where a point now at height z (between the base, descended by s0, and L) lay: the inverse of the stretch's integral. */
float volLongBack(float z, float s0, float lc) {
  float zR = uVolApicalRamp.x, zT = uVolApicalRamp.y, w = zT - zR, la = uVolCapLambda;
  float u = z - s0, u1 = lc * zR, u2 = u1 + 0.5 * (lc + la) * w;
  if (u <= u1) return u / lc;
  if (u >= u2) return zT + (u - u2) / la;
  float a = (la - lc) / (2.0 * w), c = u1 - u;
  return zR - 2.0 * c / (lc + sqrt(lc * lc - 4.0 * a * c));
}
/** Where the tissue now at anatomical point (x, y, z) (cm) lay at end diastole; the twist that carried it in .w. */
vec4 volBackward(float x, float y, float z) {
  float sL = uVolSL, sR = uVolSR, L = uVolL, roof = uVolRoof;
  float s0 = sL + (sR - sL) * volSmooth(uVolRvShape.x, uVolRvShape.y, x);
  float lc = volCavityLambda(s0);
  float zr = z >= L || z <= roof ? z : z >= s0 ? volLongBack(z, s0, lc) : (z - s0) / (1.0 + s0 / -roof);
  float lz = volStretchAt(zr, volCavityLambda(sL)); // the LV's stretch: the radial step's area times height (decision 363)
  float px = x, py = y, rot = 0.0, lvReach = 0.0;
  float wz = volSmooth(uVolBand.x, uVolBand.y, zr);
  if (wz > 0.0) {
    float cx = volSlice(zr, 0), cy = volSlice(zr, 1);
    float dx = x - cx, dy = y - cy;
    float rNow = length(vec2(dx, dy));
    float th0 = atan(dy, dx);
    float re = volSector(zr, th0, 5), rp = volSector(zr, th0, 5 + uVolSectors);
    float A = uVolAlpha * re * re;
    float rEpiNow = sqrt(max(0.0, rp * rp - A) / lz);
    lvReach = 1.0 - volSmooth(rEpiNow, rEpiNow + uVolTwistProfile.z, rNow);
    float w = wz * lvReach;
    if (w > 0.0) {
      float r = rNow + (sqrt(lz * rNow * rNow + A) - rNow) * w;
      float zeta = clamp(zr / L, 0.0, 1.0);
      rot = -uVolTwist * (uVolTwistProfile.x + (uVolTwistProfile.y - uVolTwistProfile.x) * zeta) * w;
      float th = atan(dy, dx) + rot;
      float f = rNow > 1e-9 ? r : 0.0;
      px = cx + f * cos(th);
      py = cy + f * sin(th);
    }
  }
  if (wz > 0.0 && uVolRvRatio != 1.0 && lvReach < 1.0) {
    float rcx = volSlice(zr, 2), rcy = volSlice(zr, 3), rr = volSlice(zr, 4);
    if (rr > 0.0) {
      float d = length(vec2(px - rcx, py - rcy)) / rr;
      float w = wz * (1.0 - lvReach) * (1.0 - volSmooth(uVolRvShape.z, uVolRvShape.w, d));
      if (w > 0.0) {
        float sc = 1.0 + (uVolRvRatio - 1.0) * w;
        px = rcx + (px - rcx) / sc;
        py = rcy + (py - rcy) / sc;
      }
    }
  }
  float wa = volSmooth(uVolBand.z, uVolBand.w, zr);
  if (wa > 0.0 && (uVolAtria[0].w > 0.0 || uVolAtria[1].w > 0.0)) {
    bool chosen = false;
    vec2 c = vec2(px, py);
    for (int ai = 0; ai < 2 && !chosen; ai++) {
      if (uVolAtria[ai].w <= 0.0) continue;
      vec2 b = volAtrialBack(ai, px, py, zr);
      if (volHas(ai == 0 ? uVolLeftAtrium : uVolRightAtrium, volLabelAtAnat(b.x, b.y, zr))) {
        c = b;
        chosen = true;
      }
    }
    if (!chosen) {
      float best = 1e30;
      int bi = 0;
      for (int a = 0; a < 2; a++) {
        if (uVolAtria[a].w <= 0.0) continue;
        float d = length(vec2(px - uVolAtria[a].x, py - uVolAtria[a].y)) / uVolAtria[a].z;
        if (d < best) { best = d; bi = a; }
      }
      c = volAtrialBack(bi, px, py, zr);
    }
    px = c.x;
    py = c.y;
  }
  return vec4(px, py, zr, rot);
}
/** A gradient in mesh axes turned into the heart frame by the twist that carried the tissue, unit. */
vec3 volToHeart(vec3 g, float twist) {
  float a0 = dot(g, uVolMX), a1 = dot(g, uVolMY), a2 = dot(g, uVolMZ);
  float ct = cos(twist), st = sin(twist);
  vec3 a = vec3(a0 * ct - a1 * st, a0 * st + a1 * ct, a2);
  vec3 n = a.x * uVolFX + a.y * uVolFY + a.z * uVolFZ;
  float l = length(n);
  return l > 0.0 ? n / l : vec3(0.0, 0.0, 1.0);
}
vec3 volOcta(vec2 e) {
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return n;
}
float volEpi(ivec3 c) { return texelFetch(uVolField, clamp(c, ivec3(0), uVolDims - 1), 0).r; }
/** The analytic heart's great vessels alone (greatVessels.ts classifyGreatVessels, decision 372). */
bool classifyGreatVessels(vec3 p, inout Sample s) {
  if (classifyAorticExtension(p, s)) return true;
  float d = pulmonaryTrunkDist(p);
  if (d < PA_WALL_CM) {
    s.segment = 0;
    s.transmural = -1.0;
    setSample(s, d < 0.0 ? T_BLOOD : T_VESSEL, d < 0.0 ? d : -min(d, PA_WALL_CM - d), p - vec3(RVOT_BX, RVOT_BY, RVOT_BZ + PV_Z), p, 0.0, S_PA);
    return true;
  }
  s.sdf = min(s.sdf, d - PA_WALL_CM);
  return false;
}

bool classifyVolumeHeart(vec3 pH, inout Sample s) {
  s.segment = 0;
  s.transmural = -1.0;
  vec3 ref = pH;
  float normalTwist = 0.0;
  if (uVolMotion == 1) {
    vec3 d = pH - uVolFO;
    vec4 b = volBackward(dot(d, uVolFX), dot(d, uVolFY), dot(d, uVolFZ));
    ref = uVolFO + b.x * uVolFX + b.y * uVolFY + b.z * uVolFZ;
    normalTwist = -b.w;
  }
  vec3 dr = ref - uVolFO;
  vec3 a = vec3(dot(dr, uVolFX), dot(dr, uVolFY), dot(dr, uVolFZ)) / uVolK;
  vec3 f = volGrid(a);
  ivec3 c = ivec3(floor(f));
  bool outside = any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, uVolDims));
  int l = outside ? 0 : int(texelFetch(uVolLabel, c, 0).r);
  vec4 fld = outside ? vec4(0.0) : texelFetch(uVolField, c, 0);
  if (l == 0) {
    // beyond the grid: its margin plus the way out to it; inside it, the distance beyond the epicardium
    vec3 o = max(max(vec3(0.0), -f), f - vec3(uVolDims));
    float de = outside ? (volEpi(c) + length(o) * uVolVox) * uVolK : fld.r * uVolK;
    // where the CT has nothing, the great vessels it cut carry on as the analytic heart's (decision 372)
    s.sdf = de - uVolPeri;
    if (uVolApparatus == 1 && classifyGreatVessels(pH, s)) return true;
    if (outside || de >= uVolPeri) return false;
    vec3 g = vec3(
      volEpi(c + ivec3(1, 0, 0)) - volEpi(c - ivec3(1, 0, 0)),
      volEpi(c + ivec3(0, 1, 0)) - volEpi(c - ivec3(0, 1, 0)),
      volEpi(c + ivec3(0, 0, 1)) - volEpi(c - ivec3(0, 0, 1)));
    setSample(s, T_PERI, -min(de, uVolPeri - de), volToHeart(g, normalTwist), ref, 0.0, S_PERI);
    return true;
  }
  // the analytic leaflets and chords where the analytic heart has them now (decision 353); in the root over the CT's
  // annulus, the analytic cusps carried onto it (decision 373): one call of the classifier for both
  float tAo = dot(ref - uVolAoC, uVolAoN);
  bool aortic = uVolApparatus == 1 && l == uVolAoLabel && tAo >= uVolAoReach.x && tAo <= uVolAoReach.y;
  if (aortic || (uVolApparatus == 1 && volHas(uVolHosts, l))) {
    Sample s2;
    s2.segment = 0;
    s2.transmural = -1.0;
    vec3 qp = aortic ? uVolAoM * ref + uVolAoO : pH;
    if (classifyHeart(qp, s2) &&
        (aortic ? s2.structure == S_AV
                : (s2.structure == S_MV_ANT || s2.structure == S_MV_POST || s2.structure == S_TV || s2.structure == S_CHORDAE))) {
      s = s2;
      return true;
    }
  }
  ivec2 ts = l == uVolFatLabel ? uVolFat : l < 64 ? uVolMap[l] : ivec2(-1, 0);
  if (ts.x < 0) { s.sdf = uVolPeri; return false; }
  int structure = ts.y;
  if (l == 1) {
    // the LV wall by its sector around the long axis, the apex beyond its share of the length
    float phi = atan(a.y, a.x);
    structure = a.z > uVolTwistProfile.w * uVolFar ? S_LV_APEX
      : abs(phi) < PI / 4.0 ? S_LV_LAT
      : abs(phi) > 3.0 * PI / 4.0 ? S_LV_SEPT
      : phi > 0.0 ? S_LV_ANT : S_LV_INF;
  }
  setSample(s, ts.x, -fld.g * uVolK, volToHeart(volOcta(fld.ba), normalTwist), ref, 0.0, structure);
  return true;
}
`;
