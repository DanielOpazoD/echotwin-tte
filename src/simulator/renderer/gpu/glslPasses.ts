/**
 * WebGL2 image formation, mirroring ProceduralSliceRenderer and acoustic/psf.ts (decision 52):
 *  - pass A (per line × sample, parallel): classify the sample, incoherent backscatter σ, coherent specular
 *    echo, tissue-anchored scatterer phasor, local attenuation (Np) and lung flag;
 *  - pass B (per sample, marches the samples before it on the same line): two-way transmission, lung dead
 *    zone with reverberation, slice-thickness mean, near-field clutter → complex signal (re, im);
 *  - pass C: axial PSF along samples; pass D: lateral PSF across lines and envelope detection.
 * The PSF taps come from the same Float32 kernel table as the CPU renderer (uPsf).
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
layout(location = 0) out vec4 outA; // backscatter σ, attenNp, lungFlag, inBody
layout(location = 1) out vec4 outB; // structure/255, tissue/255, extra, 1
layout(location = 2) out vec4 outC; // specular echo, scatterer phasor re, im, 0

float heteroDb(int t) {
  if (t == T_MYO) return HETERO_DB_MYO;
  if (t == T_LIVER) return HETERO_DB_LIVER;
  if (t == T_MUSCLE) return HETERO_DB_MUSCLE;
  return 0.0;
}

// incoherent backscatter σ and coherent interface echo of a classified sample, before attenuation
void acoustic(int tissue, float sdf, float extra, float nd, vec3 m, out float sigma, out float specular) {
  vec4 props = uTissue[tissue];
  sigma = props.x;
  if (tissue == T_BLOOD && HARM > 0.5) sigma *= 0.6;
  if (tissue == T_MYO) sigma *= MYO_ANISO_FLOOR + (1.0 - MYO_ANISO_FLOOR) * nd * nd;
  float het = heteroDb(tissue);
  if (het > 0.0) sigma *= pow(10.0, ((lat(vec3(m.x * HETERO_FREQ + 5.3, m.y * HETERO_FREQ + 1.7, m.z * HETERO_FREQ + 9.1), 2) - 0.5) * het) / 20.0);
  if (extra > 0.0) sigma += extra * 1.5 * (0.6 + 0.8 * lat(vec3(m.x * 6.0 + 3.3, m.y * 6.0 + 1.1, m.z * 6.0 + 9.2), 1));
  specular = 0.0;
  if (props.y > 0.0 && abs(sdf) < max(nd, SPECULAR_WINDOW_MIN) * (DEPTH / SAMPLES)) specular = props.y * SPECULAR_GAIN * nd * nd * nd * nd * (HARM > 0.5 ? SPECULAR_HARMONIC : 1.0);
}

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  float dr = DEPTH / SAMPLES;
  float theta = -SECTOR / 2.0 + SECTOR * (float(li) + 0.5) / LINES;
  float ct = cos(theta), sn = sin(theta);
  vec3 bF = vec3(B_FX, B_FY, B_FZ), bL = vec3(B_LX, B_LY, B_LZ), bN = vec3(B_NX, B_NY, B_NZ);
  vec3 dirT = bF * ct + bL * sn;           // torso-frame line direction
  vec3 ex = vec3(HF_EXX, HF_EXY, HF_EXZ), ey = vec3(HF_EYX, HF_EYY, HF_EYZ), ez = vec3(HF_EZX, HF_EZY, HF_EZZ);
  vec3 dirH = vec3(dot(dirT, ex), dot(dirT, ey), dot(dirT, ez));
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
    outA = vec4(0.0);
    outB = vec4(0.0, 0.0, 0.0, 1.0);
    outC = vec4(0.0);
    return;
  }
  vec4 props = uTissue[s.tissue];
  float nd = abs(inHeart ? dot(s.n, dirH) : dot(s.n, dirT));
  float sigma, specular;
  acoustic(s.tissue, s.sdf, s.extra, nd, s.m, sigma, specular);
  // complex scatterer phasor anchored in tissue coordinates (moves with the tissue); across the plane its lattice cell is
  // the slice thickness (decision 99), as in the CPU renderer
  vec3 nrm = inHeart ? vec3(dot(bN, ex), dot(bN, ey), dot(bN, ez)) : bN;
  vec3 q = s.m * SCATTER_FREQ - (SCATTER_FREQ - 1.0 / (2.0 * (0.2 + 0.04 * abs(r - FOCUS)))) * dot(s.m, nrm) * nrm;
  float zr = (lat(q, 0) + lat(q * SCATTER_FREQ_RATIO + vec3(37.3, 11.9, 23.7), 1) - 1.0) * PHASOR_NORM;
  float zi = (lat(q + vec3(71.1, 53.5, 5.3), 2) + lat(q * SCATTER_FREQ_RATIO + vec3(17.9, 91.1, 43.3), 0) - 1.0) * PHASOR_NORM;
  float lungFlag = s.tissue == T_LUNG ? 1.0 : 0.0;
  // two-way amplitude loss integrated over the sample's length for every tissue, bone included (decision 89)
  float attenNp = 0.23 * props.z * F_ATTEN * dr;
  if (s.extra > 0.4) attenNp += 0.09 * s.extra * (dr / 0.07);
  if (!inHeart && (s.tissue == T_FAT || s.tissue == T_MUSCLE || s.tissue == T_SKIN)) attenNp *= 1.0 + 1.5 * WINDOW_ATTEN;
  outA = vec4(sigma, attenNp, lungFlag, 1.0);
  outB = vec4(float(s.structure) / 255.0, float(s.tissue) / 255.0, s.extra, 1.0);
  outC = vec4(specular, zr, zi, 0.0);
}
`;

export const GLSL_PASS_B_MAIN = /* glsl */ `
uniform sampler2D uPassA;
uniform sampler2D uPassB;
uniform sampler2D uPassC;
uniform sampler2D uSideA;   // pass A (σ, …) on the elevation plane −e (slice thickness, high tier)
uniform sampler2D uSideB;   // pass A (σ, …) on the elevation plane +e
uniform sampler2D uSideCA;  // pass A attachment C (specular, …) on −e
uniform sampler2D uSideCB;  // pass A attachment C (specular, …) on +e
layout(location = 0) out vec4 outSig;   // complex signal re, transmission, im, 1
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
    float amp = lungEntryT * (band * decay * 0.9 + 0.02 * decay * n);
    // reverberation energy is incoherent: a phasor tied to the line and the depth
    float px2 = float(li) * 0.9, pr = r * SCATTER_FREQ;
    float zr2 = (lat(vec3(px2, pr, 17.3), 0) + lat(vec3(px2 + 5.1, pr * SCATTER_FREQ_RATIO + 2.3, 29.9), 1) - 1.0) * PHASOR_NORM;
    float zi2 = (lat(vec3(px2 + 9.7, pr + 13.1, 41.3), 2) + lat(vec3(px2 + 3.3, pr * SCATTER_FREQ_RATIO + 7.7, 53.9), 0) - 1.0) * PHASOR_NORM;
    outSig = vec4(amp * zr2, 0.0, amp * zi2, 1.0);
    outIds = vec4(float(S_LUNG) / 255.0, float(T_LUNG) / 255.0, 0.0, 1.0);
    return;
  }
  if (a.w < 0.5) {
    outSig = vec4(0.0, transmission, 0.0, 1.0);
    outIds = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  if (a.z > 0.5) {
    // the pleural line itself: a strong coherent reflector
    outSig = vec4(transmission * (1.2 + 0.4 * lat(vec3(float(li) * 0.8, r * 3.0, 1.0), 0)), transmission, 0.0, 1.0);
    outIds = b;
    return;
  }
  vec4 c = texelFetch(uPassC, ivec2(si, li), 0);
  float sigma = a.x;
  float specular = c.x;
  if (ELEV_N > 1.5) {
    // slice thickness: weighted mean of σ and specular over the three elevation planes (¼ ½ ¼); side samples
    // outside the body or in lung are dropped and the weights renormalised, as in the CPU renderer
    vec4 sa = texelFetch(uSideA, ivec2(si, li), 0);
    vec4 sb = texelFetch(uSideB, ivec2(si, li), 0);
    float accS = sigma * 0.5, accP = specular * 0.5, wsum = 0.5;
    if (sa.w > 0.5 && sa.z < 0.5) { accS += 0.25 * sa.x; accP += 0.25 * texelFetch(uSideCA, ivec2(si, li), 0).x; wsum += 0.25; }
    if (sb.w > 0.5 && sb.z < 0.5) { accS += 0.25 * sb.x; accP += 0.25 * texelFetch(uSideCB, ivec2(si, li), 0).x; wsum += 0.25; }
    sigma = accS / wsum;
    specular = accP / wsum;
  }
  float sRe = sigma * c.y + specular;
  float sIm = sigma * c.z;
  if (r < 4.5 && CLUTTER > 0.0) {
    // near-field clutter: reverberation in the chest wall under the footprint, incoherent, fixed to the probe position
    float cm = CLUTTER * exp(-r / 1.8) * (0.15 + 0.5 * lat(vec3(B_OX * 6.0 + float(li) * 0.7, B_OY * 6.0 + B_OZ * 6.0, r * 5.0), 2));
    float cx = B_OX * 25.0 + float(li) * 0.9, cy = B_OY * 25.0 + B_OZ * 25.0, cz = r * SCATTER_FREQ;
    sRe += cm * (lat(vec3(cx + 3.1, cy, cz), 0) + lat(vec3(cx * SCATTER_FREQ_RATIO + 8.3, cy + 1.9, cz * SCATTER_FREQ_RATIO), 1) - 1.0) * PHASOR_NORM;
    sIm += cm * (lat(vec3(cx + 61.7, cy + 5.5, cz + 3.3), 2) + lat(vec3(cx * SCATTER_FREQ_RATIO + 21.1, cy + 44.4, cz * SCATTER_FREQ_RATIO + 9.9), 0) - 1.0) * PHASOR_NORM;
  }
  if (r < 0.35) sRe += 0.6 * (1.0 - r / 0.35); // transducer ring-down
  outSig = vec4(sRe * transmission, transmission, sIm * transmission, 1.0);
  outIds = b;
}
`;

/** Axial PSF along samples (row 0 of uPsf: taps centred on column MAX_LATERAL_RADIUS, radius in .g). */
export const GLSL_PASS_C_MAIN = /* glsl */ `
uniform sampler2D uSig;
uniform sampler2D uPsf;
layout(location = 0) out vec4 outSig;

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  int R = int(texelFetch(uPsf, ivec2(8, 0), 0).g + 0.5);
  int last = int(SAMPLES) - 1;
  float sr = 0.0, sm = 0.0;
  for (int j = -4; j <= 4; j++) {
    if (j < -R || j > R) continue;
    vec4 v = texelFetch(uSig, ivec2(clamp(si + j, 0, last), li), 0);
    float w = texelFetch(uPsf, ivec2(8 + j, 0), 0).r;
    sr += w * v.x;
    sm += w * v.z;
  }
  outSig = vec4(sr, texelFetch(uSig, ivec2(si, li), 0).y, sm, 1.0);
}
`;

/** Lateral PSF across lines (row 1 + sample of uPsf) and envelope detection. */
export const GLSL_PASS_D_MAIN = /* glsl */ `
uniform sampler2D uAx;
uniform sampler2D uPsf;
layout(location = 0) out vec4 outAmp;   // amplitude, transmission, 0, 1

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  int R = int(texelFetch(uPsf, ivec2(8, si + 1), 0).g + 0.5);
  int last = int(LINES) - 1;
  float sr = 0.0, sm = 0.0;
  for (int j = -8; j <= 8; j++) {
    if (j < -R || j > R) continue;
    vec4 v = texelFetch(uAx, ivec2(si, clamp(li + j, 0, last)), 0);
    float w = texelFetch(uPsf, ivec2(8 + j, si + 1), 0).r;
    sr += w * v.x;
    sm += w * v.z;
  }
  outAmp = vec4(sqrt(sr * sr + sm * sm) * ENVELOPE_NORM, texelFetch(uAx, ivec2(si, li), 0).y, 0.0, 1.0);
}
`;
