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
layout(location = 1) out vec4 outB; // structure/255, tissue/255, extra, LV segment code/255 (decision 152)
layout(location = 2) out vec4 outC; // specular echo, scatterer phasor re, im, grain coefficient (0–1)
layout(location = 3) out vec4 outD; // scatterer phasor of the second compounding look re, im, 0, 0

float heteroDb(int t) {
  if (t == T_MYO) return HETERO_DB_MYO;
  if (t == T_LIVER) return HETERO_DB_LIVER;
  if (t == T_MUSCLE) return HETERO_DB_MUSCLE;
  return 0.0;
}

// incoherent backscatter σ and coherent interface echo of a classified sample, before attenuation
/** A grain field above its threshold, 0–1 (decision 145). */
float grainAbove(float g) { return g > GRAIN_THRESHOLD ? (g - GRAIN_THRESHOLD) / (1.0 - GRAIN_THRESHOLD) : 0.0; }

void acoustic(int tissue, int structure, float sdf, float extra, float nd, vec3 m, vec3 dirH, float transmural, out float sigma, out float specular) {
  vec4 props = uTissue[tissue];
  sigma = props.x;
  if (tissue == T_BLOOD && HARM > 0.5) sigma *= BLOOD_HARMONIC_SIGMA;
  // myocardial backscatter is strongest with the beam across the fibres, which run ~circumferentially
  // around the LV long axis (heart-frame z): circumferential direction = (−m.y, m.x, 0)/r
  // the RV free wall takes the fibre response too; atrial walls and the interatrial septum scatter without anisotropy (decision 140)
  if (tissue == T_MYO) {
    if ((structure >= S_LV_SEPT && structure <= S_LV_APEX) || structure == S_RV_WALL) {
      float rr = length(m.xy);
      float dphi = rr > MYO_ANISO_RADIAL_EPS ? dot(dirH.xy, vec2(-m.y, m.x)) / rr : 0.0;
      // the fibre helix across the wall (decision 144); a wall sample without a depth (the RV free wall) takes the mid-wall
      sigma *= myoHelixGain(dphi, dirH.z, transmural >= 0.0 ? transmural : 0.5);
    } else if (structure != S_LA_WALL && structure != S_RA_WALL && structure != S_IAS) {
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
  s.segment = 0;
  s.transmural = -1.0;
  bool inHeart = false;
  bool inBody = true;
  if (isAnteriorLung(pT)) {
    s.tissue = T_LUNG; s.structure = S_LUNG; s.sdf = -1.0; s.n = vec3(0.0, 0.0, 1.0); s.m = pT; s.extra = 0.0;
  } else {
    inHeart = classifyHeart(pH, s);
    if (!inHeart) { float heartDist = s.sdf; inBody = classifyThorax(pT, s, heartDist); }
  }
  if (!inBody) {
    outA = vec4(0.0);
    outB = vec4(0.0);
    outC = vec4(0.0);
    outD = vec4(0.0);
    return;
  }
  vec4 props = uTissue[s.tissue];
  float nd = abs(inHeart ? dot(s.n, dirH) : dot(s.n, dirT));
  float sigma, specular;
  acoustic(s.tissue, s.structure, s.sdf, s.extra, nd, s.m, dirH, s.transmural, sigma, specular);
  // complex scatterer phasor anchored in tissue coordinates (moves with the tissue); across the plane its lattice cell is
  // the slice thickness (decision 99), as in the CPU renderer
  vec3 nrm = inHeart ? vec3(dot(bN, ex), dot(bN, ey), dot(bN, ez)) : bN;
  // a leaflet is a membrane thinner than the slice: it reads by the fraction of the slice it fills (decision 147)
  if (s.tissue == T_VALVE) {
    float wm = membraneWeight(dot(s.n, nrm), e);
    sigma *= wm;
    specular *= wm;
  }
  vec3 q = s.m * SCATTER_FREQ - (SCATTER_FREQ - 1.0 / (2.0 * e)) * dot(s.m, nrm) * nrm;
  // flowing blood is a new realization in every frame (decision 163)
  if (s.tissue == T_BLOOD) q.x += BLOOD_SHIFT;
  float zr = (lat(q, 0) + lat(q * SCATTER_FREQ_RATIO + PHASOR_RE_B, 1) - 1.0) * PHASOR_NORM;
  float zi = (lat(q + PHASOR_IM_A, 2) + lat(q * SCATTER_FREQ_RATIO + PHASOR_IM_B, 0) - 1.0) * PHASOR_NORM;
  // the second compounding look: the same scene on a shifted lattice (decision 145)
  vec3 q1 = q + LOOK_SHIFT_1;
  float zr1 = (lat(q1, 0) + lat(q * SCATTER_FREQ_RATIO + PHASOR_RE_B + LOOK_SHIFT_1, 1) - 1.0) * PHASOR_NORM;
  float zi1 = (lat(q1 + PHASOR_IM_A, 2) + lat(q * SCATTER_FREQ_RATIO + PHASOR_IM_B + LOOK_SHIFT_1, 0) - 1.0) * PHASOR_NORM;
  // bright grains of the parenchyma (decision 145): the coefficient (0–1) of a sparse coherent component, the same in
  // every look, scaled by σ in pass B. Its lattice is anchored in tissue coordinates at the tissue's grain frequency;
  // across the plane its cell is the slice thickness where that is coarser, as for the scatterer phasor
  float gcoef = 0.0;
  if (s.tissue == T_MYO || s.tissue == T_MUSCLE || s.tissue == T_LIVER) {
    float gf = props.w;
    vec3 gq = s.m * gf - (gf - min(gf, 1.0 / (2.0 * e))) * dot(s.m, nrm) * nrm + GRAIN_OFFSET;
    // the slice holds two or three grain cells across, whose coherent echoes add: the mean (¼ ½ ¼) of three
    // independent grain fields, as in the CPU renderer (grainCoef)
    gcoef = 0.25 * grainAbove(lat(gq, 0)) + 0.5 * grainAbove(lat(gq, 1)) + 0.25 * grainAbove(lat(gq, 2));
  }
  float lungFlag = s.tissue == T_LUNG ? 1.0 : 0.0;
  // two-way amplitude loss integrated over the sample's length for every tissue, bone included (decision 89)
  float attenNp = ATTEN_NP_PER_DB * props.z * F_ATTEN * dr;
  if (s.extra > CALCIUM_ATTEN_THRESHOLD) attenNp += CALCIUM_ATTEN_NP * s.extra * (dr / CALCIUM_ATTEN_REF_CM);
  if (!inHeart && (s.tissue == T_FAT || s.tissue == T_MUSCLE || s.tissue == T_SKIN)) attenNp *= 1.0 + WINDOW_ATTEN_GAIN * WINDOW_ATTEN;
  outA = vec4(sigma, attenNp, lungFlag, 1.0);
  outB = vec4(float(s.structure) / 255.0, float(s.tissue) / 255.0, s.extra, float(s.segment) / 255.0);
  outC = vec4(specular, zr, zi, gcoef);
  outD = vec4(zr1, zi1, 0.0, 0.0);
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
uniform sampler2D uPassD;   // pass A attachment D: the second look's phasor
layout(location = 0) out vec4 outSig;   // complex signal of the first look re, transmission, im, 1
layout(location = 1) out vec4 outIds;   // structure/255, tissue/255, extra, LV segment code/255
layout(location = 2) out vec4 outSig2;  // complex signal of the second look re, im, 0, 1


// A neighbouring line's lung entry, taken within w samples of this line's entry kE (decision 221): mirrors
// ProceduralSliceRenderer.drawLung — a line without lung there counts as a cliff behind this one's entry.
int lungEntryNear(int lj, int kE, int w) {
  int kEnd = min(int(SAMPLES) - 1, kE + w);
  for (int k = 0; k < 1024; k++) {
    if (k > kEnd) break;
    vec4 a = texelFetch(uPassA, ivec2(k, lj), 0);
    if (a.w < 0.5) continue;
    if (a.z > 0.5) return clamp(k, kE - w, kE + w);
  }
  return kE + w;
}

// Specular share of the pleural echo of line li entering lung at sample kE, from its neighbours' entries (decision 221)
float pleuralCoherenceAt(int li, int kE, float dr) {
  int w = int(floor(PLEURA_SLOPE_WINDOW_CM / dr + 0.5));
  int last = int(LINES) - 1;
  float dEntry = 0.0, span = 1.0;
  if (li > 0 && li < last) {
    dEntry = float(lungEntryNear(li + 1, kE, w) - lungEntryNear(li - 1, kE, w));
    span = 2.0;
  } else if (li > 0) {
    dEntry = float(kE - lungEntryNear(li - 1, kE, w));
  } else if (li < last) {
    dEntry = float(lungEntryNear(li + 1, kE, w) - kE);
  }
  float rE = (float(kE) + 0.5) * dr;
  return pleuralCoherence(pleuralIncidenceCos(dEntry * dr, span * rE * (SECTOR / LINES)));
}

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  float dr = DEPTH / SAMPLES;
  float transmission = P(LINE_DROP_BASE + li);
  float lungEntryR = -1.0, lungEntryT = 0.0;
  int lungEntryK = -1;
  bool dead = false;
  // march the samples before this one on the same line (attenuation and lung entry are sequential)
  for (int k = 0; k < 1024; k++) {
    if (k >= si) break;
    vec4 a = texelFetch(uPassA, ivec2(k, li), 0);
    if (a.w < 0.5) continue; // outside the body: no attenuation, transmission unchanged
    if (a.z > 0.5) { // lung entry
      lungEntryR = (float(k) + 0.5) * dr;
      lungEntryT = transmission;
      lungEntryK = k;
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
    float amp = pleuralReverberation(r, lungEntryR, lungEntryT, n, pleuralCoherenceAt(li, lungEntryK, dr));
    // reverberation energy is incoherent: a phasor tied to the line and the depth
    float px2 = float(li) * REVERB_PHASOR_LINE_FREQ, pr = r * SCATTER_FREQ;
    // one phasor per compounding look (decision 145)
    vec3 rp = vec3(px2, pr, REVERB_PHASOR_RE_A_Z);
    float zr2 = (lat(rp, 0) + lat(vec3(px2, pr * SCATTER_FREQ_RATIO, 0.0) + REVERB_PHASOR_RE_B, 1) - 1.0) * PHASOR_NORM;
    float zi2 = (lat(vec3(px2, pr, 0.0) + REVERB_PHASOR_IM_A, 2) + lat(vec3(px2, pr * SCATTER_FREQ_RATIO, 0.0) + REVERB_PHASOR_IM_B, 0) - 1.0) * PHASOR_NORM;
    float zr3 = (lat(rp + LOOK_SHIFT_1, 0) + lat(vec3(px2, pr * SCATTER_FREQ_RATIO, 0.0) + REVERB_PHASOR_RE_B + LOOK_SHIFT_1, 1) - 1.0) * PHASOR_NORM;
    float zi3 = (lat(vec3(px2, pr, 0.0) + REVERB_PHASOR_IM_A + LOOK_SHIFT_1, 2) + lat(vec3(px2, pr * SCATTER_FREQ_RATIO, 0.0) + REVERB_PHASOR_IM_B + LOOK_SHIFT_1, 0) - 1.0) * PHASOR_NORM;
    outSig = vec4(amp * zr2, 0.0, amp * zi2, 1.0);
    outSig2 = vec4(amp * zr3, amp * zi3, 0.0, 1.0);
    outIds = vec4(float(S_LUNG) / 255.0, float(T_LUNG) / 255.0, 0.0, 0.0);
    return;
  }
  if (a.w < 0.5) {
    outSig = vec4(0.0, transmission, 0.0, 1.0);
    outSig2 = vec4(0.0, 0.0, 0.0, 1.0);
    outIds = vec4(0.0);
    return;
  }
  if (a.z > 0.5) {
    // the pleural line itself: a strong coherent reflector, the same in every look
    float coh = pleuralCoherenceAt(li, si, dr);
    float pl = transmission * (PLEURA_BASE + PLEURA_AMP * lat(vec3(float(li) * PLEURA_LINE_FREQ, r * PLEURA_DEPTH_FREQ, PLEURA_Z), 0)) * (PLEURA_DIFFUSE_FLOOR + (1.0 - PLEURA_DIFFUSE_FLOOR) * coh);
    outSig = vec4(pl, transmission, 0.0, 1.0);
    outSig2 = vec4(pl, 0.0, 0.0, 1.0);
    outIds = b;
    return;
  }
  vec4 c = texelFetch(uPassC, ivec2(si, li), 0);
  vec4 d = texelFetch(uPassD, ivec2(si, li), 0);
  float sigma = a.x;
  float specular = c.x;
  // a valve membrane takes no elevation average: the side planes miss it (decision 147)
  if (ELEV_N > 1.0 && int(b.y * 255.0 + 0.5) != T_VALVE) { // three elevation samples (high tier); one otherwise
    // slice thickness: weighted mean of σ and specular over the three elevation planes (¼ ½ ¼); side samples outside
    // the body or in lung are dropped and the weights renormalised, as in the CPU renderer
    vec4 sa = texelFetch(uSideA, ivec2(si, li), 0);
    vec4 sb = texelFetch(uSideB, ivec2(si, li), 0);
    float accS = sigma * 0.5, accP = specular * 0.5, wsum = 0.5;
    if (sa.w > 0.5 && sa.z < 0.5) { vec4 ca = texelFetch(uSideCA, ivec2(si, li), 0); accS += 0.25 * sa.x; accP += 0.25 * ca.x; wsum += 0.25; }
    if (sb.w > 0.5 && sb.z < 0.5) { vec4 cb = texelFetch(uSideCB, ivec2(si, li), 0); accS += 0.25 * sb.x; accP += 0.25 * cb.x; wsum += 0.25; }
    sigma = accS / wsum;
    specular = accP / wsum;
  }
  // the beam's on-axis sensitivity at this depth: wide near the face, narrowest at the focus (decision 144)
  float fg = focusingGain(r, FOCUS);
  sigma *= fg;
  specular *= fg;
  // the parenchymal grains: their coefficient from pass A over the σ of the slice (decision 145)
  float grain = sigma * GRAIN_GAIN * c.w;
  // near-field clutter: reverberation in the chest wall under the footprint, incoherent, fixed to the probe position
  float cm = 0.0;
  if (r < CLUTTER_MAX_CM && CLUTTER > 0.0) cm = CLUTTER * exp(-r / CLUTTER_DECAY_CM) * (CLUTTER_BASE + CLUTTER_AMP * lat(vec3(B_OX * CLUTTER_MOD_FREQ + float(li) * CLUTTER_MOD_LINE_FREQ, B_OY * CLUTTER_MOD_FREQ + B_OZ * CLUTTER_MOD_FREQ, r * CLUTTER_MOD_DEPTH_FREQ), 2));
  vec3 cc = vec3(B_OX * CLUTTER_FREQ + float(li) * CLUTTER_LINE_FREQ, B_OY * CLUTTER_FREQ + B_OZ * CLUTTER_FREQ, r * SCATTER_FREQ);
  float ringDown = r < RINGDOWN_CM ? RINGDOWN_GAIN * (1.0 - r / RINGDOWN_CM) : 0.0; // transducer ring-down
  // one complex signal per compounding look: the scatterer and clutter phasors differ, the coherent echoes (specular,
  // grain, ring-down) do not (decision 145)
  float coh = specular + grain + ringDown;
  float sRe = sigma * c.y + coh;
  float sIm = sigma * c.z;
  float sRe2 = sigma * d.x + coh;
  float sIm2 = sigma * d.y;
  if (cm > 0.0) {
    sRe += cm * (lat(vec3(cc.x + CLUTTER_RE_A_X, cc.y, cc.z), 0) + lat(vec3(cc.x * SCATTER_FREQ_RATIO, cc.y, cc.z * SCATTER_FREQ_RATIO) + vec3(CLUTTER_RE_B, 0.0), 1) - 1.0) * PHASOR_NORM;
    sIm += cm * (lat(cc + CLUTTER_IM_A, 2) + lat(vec3(cc.x * SCATTER_FREQ_RATIO, cc.y, cc.z * SCATTER_FREQ_RATIO) + CLUTTER_IM_B, 0) - 1.0) * PHASOR_NORM;
    sRe2 += cm * (lat(vec3(cc.x + CLUTTER_RE_A_X, cc.y, cc.z) + LOOK_SHIFT_1, 0) + lat(vec3(cc.x * SCATTER_FREQ_RATIO, cc.y, cc.z * SCATTER_FREQ_RATIO) + vec3(CLUTTER_RE_B, 0.0) + LOOK_SHIFT_1, 1) - 1.0) * PHASOR_NORM;
    sIm2 += cm * (lat(cc + CLUTTER_IM_A + LOOK_SHIFT_1, 2) + lat(vec3(cc.x * SCATTER_FREQ_RATIO, cc.y, cc.z * SCATTER_FREQ_RATIO) + CLUTTER_IM_B + LOOK_SHIFT_1, 0) - 1.0) * PHASOR_NORM;
  }
  outSig = vec4(sRe * transmission, transmission, sIm * transmission, 1.0);
  outSig2 = vec4(sRe2 * transmission, sIm2 * transmission, 0.0, 1.0);
  outIds = b;
}
`;

/**
 * Beam attenuation (decision 144): the increment a line pays at a depth is the mean of the increments of the lines
 * within the beam's half-width at that depth (`beamHalfWidthCm`, the aperture tapering to the focus), over the
 * body-tissue samples among them; outside-body, lung and behind-the-pleura samples (pass L, which the CPU march never
 * classifies) neither pay nor count. Pass B then marches these increments. Mirror of `beamMarch` in the CPU renderer
 * (its prefix sums are a window loop here).
 */
export const GLSL_PASS_L_MAIN = /* glsl */ `
uniform sampler2D uPassA;
layout(location = 0) out vec4 outDead;   // 1 where the line has already entered lung before this sample

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  float dead = 0.0;
  for (int k = 0; k < 1024; k++) {
    if (k >= si) break;
    vec4 a = texelFetch(uPassA, ivec2(k, li), 0);
    if (a.w > 0.5 && a.z > 0.5) { dead = 1.0; break; }
  }
  outDead = vec4(dead, 0.0, 0.0, 1.0);
}
`;

export const GLSL_PASS_P_MAIN = /* glsl */ `
uniform sampler2D uPassA;
uniform sampler2D uDead;   // pass L: samples behind a pleural entry on their own line, which the CPU march never classifies
layout(location = 0) out vec4 outA;   // σ, beam-averaged attenuation increment, lung flag, in-body flag

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  vec4 a = texelFetch(uPassA, ivec2(si, li), 0);
  if (a.w < 0.5 || a.z > 0.5 || texelFetch(uDead, ivec2(si, li), 0).x > 0.5) { outA = a; return; }
  float dr = DEPTH / SAMPLES;
  float r = (float(si) + 0.5) * dr;
  float dTheta = SECTOR / LINES;
  const int kMax = int(BEAM_ATTEN_MAX_LINES);
  int K = min(kMax, min(int(floor(BEAM_ATTEN_MAX_HALF_ANGLE_RAD / dTheta + 0.5)),
                        int(floor(beamHalfWidthCm(r, FOCUS) / max(BEAM_ATTEN_MIN_ARC_CM, r * dTheta) + 0.5))));
  int last = int(LINES) - 1;
  float sum = 0.0;
  float n = 0.0;
  for (int j = -kMax; j <= kMax; j++) {
    if (j < -K || j > K) continue;
    int q = li + j;
    if (q < 0 || q > last) continue;
    vec4 b = texelFetch(uPassA, ivec2(si, q), 0);
    if (b.w < 0.5 || b.z > 0.5 || texelFetch(uDead, ivec2(si, q), 0).x > 0.5) continue;
    sum += b.y;
    n += 1.0;
  }
  outA = vec4(a.x, n > 0.0 ? sum / n : a.y, a.z, a.w);
}
`;

/** Axial PSF along samples (row 0 of uPsf: taps centred on column MAX_LATERAL_RADIUS, radius in .g). */
export const GLSL_PASS_C_MAIN = /* glsl */ `
uniform sampler2D uSig;
uniform sampler2D uSig2;   // the second compounding look
uniform sampler2D uPsf;
layout(location = 0) out vec4 outSig;
layout(location = 1) out vec4 outSig2;

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  int R = int(texelFetch(uPsf, ivec2(PSF_LATERAL_RADIUS, 0), 0).g + 0.5);
  int last = int(SAMPLES) - 1;
  float sr = 0.0, sm = 0.0, sr2 = 0.0, sm2 = 0.0;
  for (int j = -PSF_AXIAL_RADIUS; j <= PSF_AXIAL_RADIUS; j++) {
    if (j < -R || j > R) continue;
    ivec2 at = ivec2(clamp(si + j, 0, last), li);
    vec4 v = texelFetch(uSig, at, 0);
    vec4 v2 = texelFetch(uSig2, at, 0);
    float w = texelFetch(uPsf, ivec2(PSF_LATERAL_RADIUS + j, 0), 0).r;
    sr += w * v.x;
    sm += w * v.z;
    sr2 += w * v2.x;
    sm2 += w * v2.y;
  }
  outSig = vec4(sr, texelFetch(uSig, ivec2(si, li), 0).y, sm, 1.0);
  outSig2 = vec4(sr2, sm2, 0.0, 1.0);
}
`;

/** Lateral PSF across lines (row 1 + sample of uPsf) and envelope detection. */
export const GLSL_PASS_D_MAIN = /* glsl */ `
uniform sampler2D uAx;
uniform sampler2D uAx2;   // the second compounding look
uniform sampler2D uPsf;
layout(location = 0) out vec4 outAmp;   // amplitude, transmission, 0, 1

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  int R = int(texelFetch(uPsf, ivec2(PSF_LATERAL_RADIUS, si + 1), 0).g + 0.5);
  int last = int(LINES) - 1;
  float sr = 0.0, sm = 0.0, sr2 = 0.0, sm2 = 0.0;
  for (int j = -PSF_LATERAL_RADIUS; j <= PSF_LATERAL_RADIUS; j++) {
    if (j < -R || j > R) continue;
    ivec2 at = ivec2(si, clamp(li + j, 0, last));
    vec4 v = texelFetch(uAx, at, 0);
    vec4 v2 = texelFetch(uAx2, at, 0);
    float w = texelFetch(uPsf, ivec2(PSF_LATERAL_RADIUS + j, si + 1), 0).r;
    sr += w * v.x;
    sm += w * v.z;
    sr2 += w * v2.x;
    sm2 += w * v2.y;
  }
  // the looks are detected one by one and their envelopes averaged (compounding, decision 145)
  float env = sqrt(sr * sr + sm * sm) * ENVELOPE_NORM;
  if (COMPOUND_LOOKS > 1.0) env = (env + sqrt(sr2 * sr2 + sm2 * sm2) * ENVELOPE_NORM) / COMPOUND_LOOKS;
  outAmp = vec4(env, texelFetch(uAx, ivec2(si, li), 0).y, 0.0, 1.0);
}
`;
