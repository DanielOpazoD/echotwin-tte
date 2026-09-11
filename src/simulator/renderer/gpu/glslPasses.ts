/**
 * Pass A (per line × sample, parallel): classify the sample point and compute the local echo before
 * attenuation, the local attenuation (Np) and the lung flag. Pass B (per sample, loops over the
 * samples before it on the same line): two-way transmission, lung dead zone with reverberation.
 * Both mirror ProceduralSliceRenderer.renderLine.
 */
export const GLSL_VERT = /* glsl */ `#version 300 es
void main() {
  // full-screen triangle
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const GLSL_PASS_A_MAIN = /* glsl */ `
uniform vec4 uTissue[20]; // reflect, specular, attenuation, grain per tissue id
uniform float uElevK;     // elevation plane: -1 / 0 / +1 (slice-thickness passes)
layout(location = 0) out vec4 outA; // local echo (before clutter and attenuation), attenNp, lungFlag, inBody
layout(location = 1) out vec4 outB; // structure/255, tissue/255, extra, 0

// local echo before attenuation: tissue backscatter with attached speckle, specular interface, calcification
float localEcho(int tissue, vec3 sn, vec3 sm, float sdf, float extra, bool inHeart, vec3 dirH, vec3 latH, vec3 norH, vec3 dirT, vec3 latT, vec3 bN, float latRes) {
  vec4 props = uTissue[tissue];
  float u, v, w;
  if (inHeart) {
    u = dot(sm, latH); v = dot(sm, norH); w = dot(sm, dirH);
  } else {
    u = dot(sm, latT); v = dot(sm, bN); w = dot(sm, dirT);
  }
  float gl = props.w * GRAIN_LAT * latRes;
  float ga = props.w * GRAIN_AX;
  float n1 = lat(vec3(u * gl, v * gl, w * ga), 0);
  float n2 = lat(vec3(u * gl * 2.1 + 11.7, v * gl * 2.1 + 3.3, w * ga * 2.1 + 7.9), 1);
  float spk = (n1 * 0.6 + n2 * 0.4) * 2.0;
  float speckle = spk * spk * 0.8 + 0.2;
  bool harm = HARM > 0.5;
  float reflect = props.x;
  if (tissue == T_BLOOD && harm) reflect *= 0.6;
  float echo = reflect * speckle;
  if (props.y > 0.0) {
    float ad = abs(inHeart ? dot(sn, dirH) : dot(sn, dirT));
    float fall = max(0.0, 1.0 - abs(sdf) / 0.16);
    echo += props.y * ad * ad * ad * fall * (harm ? 1.25 : 1.0) * 1.35;
  }
  if (extra > 0.0) echo += extra * 1.5 * (0.6 + 0.8 * lat(vec3(u * 6.0 + 3.3, v * 6.0 + 1.1, w * 6.0 + 9.2), 1));
  return echo;
}

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  float dr = DEPTH / SAMPLES;
  float theta = -SECTOR / 2.0 + SECTOR * (float(li) + 0.5) / LINES;
  float ct = cos(theta), sn = sin(theta);
  vec3 bF = vec3(B_FX, B_FY, B_FZ), bL = vec3(B_LX, B_LY, B_LZ), bN = vec3(B_NX, B_NY, B_NZ);
  vec3 dirT = bF * ct + bL * sn;           // torso-frame line direction
  vec3 latT = bL * ct - bF * sn;           // in-plane lateral
  vec3 ex = vec3(HF_EXX, HF_EXY, HF_EXZ), ey = vec3(HF_EYX, HF_EYY, HF_EYZ), ez = vec3(HF_EZX, HF_EZY, HF_EZZ);
  vec3 dirH = vec3(dot(dirT, ex), dot(dirT, ey), dot(dirT, ez));
  vec3 latH = vec3(dot(latT, ex), dot(latT, ey), dot(latT, ez));
  vec3 norH = vec3(dot(bN, ex), dot(bN, ey), dot(bN, ez));
  float r = (float(si) + 0.5) * dr;
  // slice thickness: the side passes sample the planes at ±(0.2 + 0.04·|r − focus|) cm (elevation beam width)
  float e = 0.2 + 0.04 * abs(r - FOCUS);
  vec3 pT = vec3(B_OX, B_OY, B_OZ) + dirT * r + bN * (ELEV_OFFSET + uElevK * e);
  vec3 hfO = vec3(HF_OX, HF_OY, HF_OZ);
  vec3 pH = vec3(dot(pT - hfO, ex), dot(pT - hfO, ey), dot(pT - hfO, ez));
  Sample s;
  bool inHeart = false;
  bool inBody = true;
  if (isAnteriorLung(pT)) {
    s.tissue = T_LUNG; s.structure = S_LUNG; s.sdf = -1.0; s.n = vec3(0.0, 0.0, 1.0); s.m = pT; s.extra = 0.0;
  } else {
    inHeart = classifyHeart(pH, s);
    if (!inHeart) inBody = classifyThorax(pT, s);
  }
  if (!inBody) {
    outA = vec4(0.0, 0.0, 0.0, 0.0);
    outB = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec4 props = uTissue[s.tissue];
  float latRes = 1.0 / (1.0 + 0.06 * abs(r - FOCUS));
  float echo = localEcho(s.tissue, s.n, s.m, s.sdf, s.extra, inHeart, dirH, latH, norH, dirT, latT, bN, latRes);
  float lungFlag = s.tissue == T_LUNG ? 1.0 : 0.0;
  float attenNp = 0.23 * props.z * F_ATTEN * dr;
  if (s.tissue == T_BONE || s.tissue == T_CALC || s.tissue == T_SPINE) attenNp = 1.2;
  else if (s.extra > 0.4) attenNp += 0.09 * s.extra * (dr / 0.07);
  if (!inHeart && (s.tissue == T_FAT || s.tissue == T_MUSCLE || s.tissue == T_SKIN)) attenNp *= 1.0 + 1.5 * WINDOW_ATTEN;
  outA = vec4(echo, attenNp, lungFlag, 1.0);
  outB = vec4(float(s.structure) / 255.0, float(s.tissue) / 255.0, s.extra, 1.0);
}
`;

export const GLSL_PASS_B_MAIN = /* glsl */ `
uniform sampler2D uPassA;
uniform sampler2D uPassB;
uniform sampler2D uSideA;   // pass A on the elevation plane −e (slice thickness, high tier)
uniform sampler2D uSideB;   // pass A on the elevation plane +e
layout(location = 0) out vec4 outAmp;   // amplitude, transmission, 0, 1
layout(location = 1) out vec4 outIds;   // structure/255, tissue/255, 0, 1

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  float dr = DEPTH / SAMPLES;
  float transmission = P(LINE_DROP_BASE + li);
  float lungEntryR = -1.0, lungEntryT = 0.0;
  bool dead = false;
  // march the samples before this one on the same line (attenuation and lung entry are sequential)
  for (int k = 0; k < 1024; k++) {
    if (k >= si) break;
    vec4 a = texelFetch(uPassA, ivec2(k, li), 0);
    if (a.w < 0.5) continue; // outside the body: no attenuation, transmission unchanged
    if (a.z > 0.5) { // lung entry
      lungEntryR = (float(k) + 0.5) * dr;
      lungEntryT = transmission;
      dead = true;
      break;
    }
    transmission *= exp(-a.y);
    if (transmission < 1e-4) transmission = 1e-4;
  }
  vec4 a = texelFetch(uPassA, ivec2(si, li), 0);
  vec4 b = texelFetch(uPassB, ivec2(si, li), 0);
  float r = (float(si) + 0.5) * dr;
  if (dead) {
    float d = r - lungEntryR;
    float period = max(lungEntryR, 0.4);
    float k = d / period;
    float frac = k - floor(k);
    float band = exp(-pow((min(frac, 1.0 - frac) * period) / 0.12, 2.0));
    float decay = pow(0.55, floor(k) + 1.0);
    float n = 0.4 + 0.6 * lat(vec3(float(li) * 0.7, r * 4.0, 3.1), 2);
    outAmp = vec4(lungEntryT * (band * decay * 0.9 + 0.06 * decay * n), 0.0, 0.0, 1.0);
    outIds = vec4(float(S_LUNG) / 255.0, float(T_LUNG) / 255.0, 0.0, 1.0);
    return;
  }
  if (a.w < 0.5) {
    outAmp = vec4(0.0, transmission, 0.0, 1.0);
    outIds = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  if (a.z > 0.5) {
    // the lung entry sample itself: bright pleural line
    outAmp = vec4(transmission * (1.2 + 0.4 * lat(vec3(float(li) * 0.8, r * 3.0, 1.0), 0)), transmission, 0.0, 1.0);
    outIds = b;
    return;
  }
  float echo = a.x;
  if (ELEV_N > 1.5) {
    // slice thickness: weighted mean over the three elevation planes (¼ ½ ¼); side samples outside the body
    // or in lung are dropped and the weights renormalised, as in the CPU renderer
    vec4 sa = texelFetch(uSideA, ivec2(si, li), 0);
    vec4 sb = texelFetch(uSideB, ivec2(si, li), 0);
    float acc = echo * 0.5, wsum = 0.5;
    if (sa.w > 0.5 && sa.z < 0.5) { acc += 0.25 * sa.x; wsum += 0.25; }
    if (sb.w > 0.5 && sb.z < 0.5) { acc += 0.25 * sb.x; wsum += 0.25; }
    echo = acc / wsum;
  }
  // near-field clutter and transducer ring-down, added after the slice mean (central plane position)
  if (r < 4.5 && CLUTTER > 0.0) {
    float theta = -SECTOR / 2.0 + SECTOR * (float(li) + 0.5) / LINES;
    vec3 dirT = vec3(B_FX, B_FY, B_FZ) * cos(theta) + vec3(B_LX, B_LY, B_LZ) * sin(theta);
    vec3 pT = vec3(B_OX, B_OY, B_OZ) + dirT * r + vec3(B_NX, B_NY, B_NZ) * ELEV_OFFSET;
    float cn = lat(vec3(pT.x * 2.3, pT.y * 2.3, r * 5.0), 2);
    echo += CLUTTER * exp(-r / 1.8) * (0.15 + 0.5 * cn);
  }
  if (r < 0.35) echo += 0.6 * (1.0 - r / 0.35);
  outAmp = vec4(echo * transmission, transmission, 0.0, 1.0);
  outIds = b;
}
`;
