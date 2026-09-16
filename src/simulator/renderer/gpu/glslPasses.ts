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
void acoustic(int tissue, int structure, float sdf, float extra, float nd, vec3 m, vec3 dirH, out float sigma, out float specular) {
  vec4 props = uTissue[tissue];
  sigma = props.x;
  if (tissue == T_BLOOD && HARM > 0.5) sigma *= BLOOD_HARMONIC_SIGMA;
  // myocardial backscatter is strongest with the beam across the fibres, which run ~circumferentially
  // around the LV long axis (heart-frame z): circumferential direction = (−m.y, m.x, 0)/r
  if (tissue == T_MYO) {
    if (structure >= S_LV_SEPT && structure <= S_LV_APEX) {
      float rr = length(m.xy);
      float dphi = rr > MYO_ANISO_RADIAL_EPS ? abs(dot(dirH.xy, vec2(-m.y, m.x)) / rr) : 0.0;
      sigma *= myoAnisoGain(dphi, dirH.z * dirH.z);
    } else {
      sigma *= MYO_ANISO_FLOOR + (1.0 - MYO_ANISO_FLOOR) * nd * nd;
    }
  }
  float het = heteroDb(tissue);
  if (het > 0.0) sigma *= pow(10.0, ((lat(m * HETERO_FREQ + HETERO_OFFSET, 2) - 0.5) * het) / 20.0);
  if (extra > 0.0) sigma += extra * CALCIUM_GAIN * (CALCIUM_BASE + CALCIUM_AMP * lat(m * CALCIUM_FREQ + CALCIUM_OFFSET, 1));
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
  // slice thickness: the side passes sample the planes at ±sliceHalfWidthCm (elevation beam width, acoustic/psf.ts)
  float e = sliceHalfWidthCm(r, FOCUS);
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
  acoustic(s.tissue, s.structure, s.sdf, s.extra, nd, s.m, dirH, sigma, specular);
  // complex scatterer phasor anchored in tissue coordinates (moves with the tissue); across the plane its lattice cell is
  // the slice thickness (decision 99), as in the CPU renderer
  vec3 nrm = inHeart ? vec3(dot(bN, ex), dot(bN, ey), dot(bN, ez)) : bN;
  vec3 q = s.m * SCATTER_FREQ - (SCATTER_FREQ - 1.0 / (2.0 * e)) * dot(s.m, nrm) * nrm;
  float zr = (lat(q, 0) + lat(q * SCATTER_FREQ_RATIO + PHASOR_RE_B, 1) - 1.0) * PHASOR_NORM;
  float zi = (lat(q + PHASOR_IM_A, 2) + lat(q * SCATTER_FREQ_RATIO + PHASOR_IM_B, 0) - 1.0) * PHASOR_NORM;
  float lungFlag = s.tissue == T_LUNG ? 1.0 : 0.0;
  // two-way amplitude loss integrated over the sample's length for every tissue, bone included (decision 89)
  float attenNp = ATTEN_NP_PER_DB * props.z * F_ATTEN * dr;
  if (s.extra > CALCIUM_ATTEN_THRESHOLD) attenNp += CALCIUM_ATTEN_NP * s.extra * (dr / CALCIUM_ATTEN_REF_CM);
  if (!inHeart && (s.tissue == T_FAT || s.tissue == T_MUSCLE || s.tissue == T_SKIN)) attenNp *= 1.0 + WINDOW_ATTEN_GAIN * WINDOW_ATTEN;
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
    if (transmission < TRANSMISSION_FLOOR) transmission = TRANSMISSION_FLOOR;
  }
  vec4 a = texelFetch(uPassA, ivec2(si, li), 0);
  vec4 b = texelFetch(uPassB, ivec2(si, li), 0);
  float r = (float(si) + 0.5) * dr;
  if (dead) {
    float n = REVERB_MOD_BASE + REVERB_MOD_AMP * lat(vec3(float(li) * REVERB_MOD_LINE_FREQ, r * REVERB_MOD_DEPTH_FREQ, REVERB_MOD_Z), 2);
    float amp = pleuralReverberation(r, lungEntryR, lungEntryT, n);
    // reverberation energy is incoherent: a phasor tied to the line and the depth
    float px2 = float(li) * REVERB_PHASOR_LINE_FREQ, pr = r * SCATTER_FREQ;
    float zr2 = (lat(vec3(px2, pr, REVERB_PHASOR_RE_A_Z), 0) + lat(vec3(px2, pr * SCATTER_FREQ_RATIO, 0.0) + REVERB_PHASOR_RE_B, 1) - 1.0) * PHASOR_NORM;
    float zi2 = (lat(vec3(px2, pr, 0.0) + REVERB_PHASOR_IM_A, 2) + lat(vec3(px2, pr * SCATTER_FREQ_RATIO, 0.0) + REVERB_PHASOR_IM_B, 0) - 1.0) * PHASOR_NORM;
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
    outSig = vec4(transmission * (PLEURA_BASE + PLEURA_AMP * lat(vec3(float(li) * PLEURA_LINE_FREQ, r * PLEURA_DEPTH_FREQ, PLEURA_Z), 0)), transmission, 0.0, 1.0);
    outIds = b;
    return;
  }
  vec4 c = texelFetch(uPassC, ivec2(si, li), 0);
  float sigma = a.x;
  float specular = c.x;
  if (ELEV_N > 1.0) { // three elevation samples (high tier); one otherwise
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
  if (r < CLUTTER_MAX_CM && CLUTTER > 0.0) {
    // near-field clutter: reverberation in the chest wall under the footprint, incoherent, fixed to the probe position
    float cm = CLUTTER * exp(-r / CLUTTER_DECAY_CM) * (CLUTTER_BASE + CLUTTER_AMP * lat(vec3(B_OX * CLUTTER_MOD_FREQ + float(li) * CLUTTER_MOD_LINE_FREQ, B_OY * CLUTTER_MOD_FREQ + B_OZ * CLUTTER_MOD_FREQ, r * CLUTTER_MOD_DEPTH_FREQ), 2));
    float cx = B_OX * CLUTTER_FREQ + float(li) * CLUTTER_LINE_FREQ, cy = B_OY * CLUTTER_FREQ + B_OZ * CLUTTER_FREQ, cz = r * SCATTER_FREQ;
    sRe += cm * (lat(vec3(cx + CLUTTER_RE_A_X, cy, cz), 0) + lat(vec3(cx * SCATTER_FREQ_RATIO, cy, cz * SCATTER_FREQ_RATIO) + vec3(CLUTTER_RE_B, 0.0), 1) - 1.0) * PHASOR_NORM;
    sIm += cm * (lat(vec3(cx, cy, cz) + CLUTTER_IM_A, 2) + lat(vec3(cx * SCATTER_FREQ_RATIO, cy, cz * SCATTER_FREQ_RATIO) + CLUTTER_IM_B, 0) - 1.0) * PHASOR_NORM;
  }
  if (r < RINGDOWN_CM) sRe += RINGDOWN_GAIN * (1.0 - r / RINGDOWN_CM); // transducer ring-down
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
  int R = int(texelFetch(uPsf, ivec2(PSF_LATERAL_RADIUS, 0), 0).g + 0.5);
  int last = int(SAMPLES) - 1;
  float sr = 0.0, sm = 0.0;
  for (int j = -PSF_AXIAL_RADIUS; j <= PSF_AXIAL_RADIUS; j++) {
    if (j < -R || j > R) continue;
    vec4 v = texelFetch(uSig, ivec2(clamp(si + j, 0, last), li), 0);
    float w = texelFetch(uPsf, ivec2(PSF_LATERAL_RADIUS + j, 0), 0).r;
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
  int R = int(texelFetch(uPsf, ivec2(PSF_LATERAL_RADIUS, si + 1), 0).g + 0.5);
  int last = int(LINES) - 1;
  float sr = 0.0, sm = 0.0;
  for (int j = -PSF_LATERAL_RADIUS; j <= PSF_LATERAL_RADIUS; j++) {
    if (j < -R || j > R) continue;
    vec4 v = texelFetch(uAx, ivec2(si, clamp(li + j, 0, last)), 0);
    float w = texelFetch(uPsf, ivec2(PSF_LATERAL_RADIUS + j, si + 1), 0).r;
    sr += w * v.x;
    sm += w * v.z;
  }
  outAmp = vec4(sqrt(sr * sr + sm * sm) * ENVELOPE_NORM, texelFetch(uAx, ivec2(si, li), 0).y, 0.0, 1.0);
}
`;
