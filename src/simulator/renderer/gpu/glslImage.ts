import {
  CLINICAL_GREY_CURVE,
  HIGH_CONTRAST_GAMMA,
  LOG_FLOOR,
  NOISE_MAGNITUDE_BINS,
  NOISE_PHASE_BINS,
  NOISE_RMS,
  NOISE_TAIL,
  REF_DB,
  S_CURVE_MIX,
} from '../postprocess/consolePipeline';
import { colorMapDefinesGlsl } from '../postprocess/colorMap';
import { psfDefinesGlsl } from '../acoustic/psf';
import { TRANS_K } from '../transmissionCode';

/**
 * GPU image chain after envelope detection (decision 54), mirroring the CPU code step by step:
 *  - receiver noise passes (consolePipeline.ts `receiverNoise`, decision 91): white complex noise from the same
 *    integer hash per line, sample, frame and seed, filtered along the beam and then across lines by the same
 *    kernel table the CPU builds (`buildNoiseKernels`), in two passes into a float texture.
 *  - console pass (postprocess/consolePipeline.ts): |envelope + receiver noise| × compensation table → log
 *    compression → edge enhancement along the beam → persistence against a history texture → grey map. It writes the new history (float) and a
 *    packed RGBA8 frame: grey, structure id, tissue id and the 8-bit log transmission code. Only that packed
 *    frame is read back. The mirror and side-lobe artifacts stay on the CPU console.
 *  - present pass (scanConvert.ts `scanConvertLut` + colorDoppler.ts `overlayColorField`): per pixel, the
 *    integer bilinear gather of the scan-conversion LUT uploaded as RGBA16UI texels, then the colour map blended
 *    inside the colour box, tested against the LUT's polar coordinates (uploaded as a float texture). It draws into the canvas, which is transferred as an ImageBitmap.
 */
const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

const GLSL_HASH = /* glsl */ `
// core/random.ts hash3: identical 32-bit integer mixing
uint hash3u(uint x, uint y, uint z, uint seed) {
  uint h = (x * 0x8da6b343u) ^ (y * 0xd8163841u) ^ (z * 0xcb1ab31fu) ^ seed;
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}
`;

/** Receiver noise, first pass: white complex samples filtered along the beam (row 0 of the kernel table, centre 8). */
export const GLSL_NOISE_AXIAL_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uKernels;  // buildNoiseKernels: row 0 axial taps, row 1 + sample lateral taps, radius in .g of the centre
uniform int uSamples;
uniform uint uSeed;
uniform uint uFrameIndex;
layout(location = 0) out vec4 outNoise;  // re, 0, im, 1
#define NOISE_RMS ${glslFloat(NOISE_RMS)}
#define NOISE_TAIL ${glslFloat(NOISE_TAIL)}
#define NOISE_MAGNITUDE_BINS ${NOISE_MAGNITUDE_BINS}
#define NOISE_PHASE_BINS ${NOISE_PHASE_BINS}
${psfDefinesGlsl()}
${GLSL_HASH}
// consolePipeline.ts receiverNoise: magnitude from the high 16 bits of one hash, phase from its low 10 bits
vec2 white(int li, int si) {
  uint h = hash3u(uint(li), uint(si), uFrameIndex, uSeed);
  float r = NOISE_RMS * sqrt(-log(1.0 - NOISE_TAIL * (float(h >> 16u) / float(NOISE_MAGNITUDE_BINS))));
  float phi = 6.283185307179586 * (float(h & uint(NOISE_PHASE_BINS - 1)) / float(NOISE_PHASE_BINS));
  return vec2(r * cos(phi), r * sin(phi));
}

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  int R = int(texelFetch(uKernels, ivec2(PSF_LATERAL_RADIUS, 0), 0).g + 0.5);
  int last = uSamples - 1;
  vec2 acc = vec2(0.0);
  for (int j = -PSF_AXIAL_RADIUS; j <= PSF_AXIAL_RADIUS; j++) {
    if (j < -R || j > R) continue;
    acc += texelFetch(uKernels, ivec2(PSF_LATERAL_RADIUS + j, 0), 0).r * white(li, clamp(si + j, 0, last));
  }
  outNoise = vec4(acc.x, 0.0, acc.y, 1.0);
}
`;

/** Receiver noise, second pass: the axial result filtered across lines (row 1 + sample of the kernel table). */
export const GLSL_NOISE_LATERAL_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uNoiseAx;
uniform sampler2D uKernels;
uniform int uLines;
layout(location = 0) out vec4 outNoise;  // re, 0, im, 1
${psfDefinesGlsl()}

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  int R = int(texelFetch(uKernels, ivec2(PSF_LATERAL_RADIUS, si + 1), 0).g + 0.5);
  int last = uLines - 1;
  vec4 acc = vec4(0.0);
  for (int j = -PSF_LATERAL_RADIUS; j <= PSF_LATERAL_RADIUS; j++) {
    if (j < -R || j > R) continue;
    acc += texelFetch(uKernels, ivec2(PSF_LATERAL_RADIUS + j, si + 1), 0).r * texelFetch(uNoiseAx, ivec2(si, clamp(li + j, 0, last)), 0);
  }
  outNoise = vec4(acc.x, 0.0, acc.z, 1.0);
}
`;

export const GLSL_CONSOLE_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uEnv;    // pass D: envelope amplitude (r), transmission (g)
uniform sampler2D uIds;    // pass B ids: structure / 255 (r), tissue / 255 (g)
uniform sampler2D uComp;   // console amplification per sample (r), one row
uniform sampler2D uHist;   // previous console output before the grey map (r)
uniform sampler2D uNoise;  // receiver noise passes: re (r), im (b)
uniform int uSamples;
uniform float uDynRange;   // dB
uniform float uEdge;       // edge enhancement strength (edgeEnhance · 0.8)
uniform float uPersist;    // weight of the history (0 without history)
uniform int uGrayMap;      // 0 linear, 1 s-curve, 2 high-contrast, 3 clinical
layout(location = 0) out vec4 outHist;
layout(location = 1) out vec4 outPacked;
#define REF_DB ${glslFloat(REF_DB)}
#define TRANS_K ${glslFloat(TRANS_K)}
#define GREY_C ${glslFloat(CLINICAL_GREY_CURVE)}
#define GREY_LOG ${glslFloat(Math.log1p(CLINICAL_GREY_CURVE))}
#define S_CURVE_MIX ${glslFloat(S_CURVE_MIX)}
#define HIGH_CONTRAST_GAMMA ${glslFloat(HIGH_CONTRAST_GAMMA)}
#define LOG_FLOOR ${glslFloat(LOG_FLOOR)}

// detection with the receiver noise + amplification + log compression of one sample → 0..1
float compressed(int si, int li) {
  float amp = texelFetch(uEnv, ivec2(si, li), 0).r;
  vec4 nz = texelFetch(uNoise, ivec2(si, li), 0);
  float x = amp + nz.r;
  float a = sqrt(x * x + nz.b * nz.b) * texelFetch(uComp, ivec2(si, 0), 0).r;
  float db = 20.0 * log(a + LOG_FLOOR) * 0.4342944819032518 - REF_DB;
  return clamp((db + uDynRange) / uDynRange, 0.0, 1.0);
}

void main() {
  int si = int(gl_FragCoord.x);
  int li = int(gl_FragCoord.y);
  float c = compressed(si, li);
  float y = c;
  if (uEdge > 0.0 && si > 0 && si < uSamples - 1) {
    float m = (compressed(si - 1, li) + compressed(si + 1, li)) / 2.0;
    y = min(1.0, max(0.0, c + (c - m) * uEdge));
  }
  if (uPersist > 0.0) y = y * (1.0 - uPersist) + texelFetch(uHist, ivec2(si, li), 0).r * uPersist;
  outHist = vec4(y, 0.0, 0.0, 1.0);
  float g = y;
  if (uGrayMap == 1) g = g * g * (3.0 - 2.0 * g) * S_CURVE_MIX + g * (1.0 - S_CURVE_MIX);
  else if (uGrayMap == 2) g = pow(g, HIGH_CONTRAST_GAMMA);
  else if (uGrayMap == 3) g = (exp(g * GREY_LOG) - 1.0) / GREY_C;
  vec4 ids = texelFetch(uIds, ivec2(si, li), 0);
  float t = clamp(texelFetch(uEnv, ivec2(si, li), 0).g, 1e-4, 1.0);
  float code = clamp(floor(-log(t) / TRANS_K * 255.0 + 0.5), 0.0, 255.0);
  outPacked = vec4(floor(g * 255.0 + 0.5) / 255.0, ids.r, ids.g, code / 255.0);
}
`;

export const GLSL_PRESENT_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;
uniform sampler2D uPacked;  // console output: grey (r)
uniform usampler2D uLut;    // scanConvert.ts packScanLutTexels, top row first
uniform sampler2D uColor;   // colour field per polar sample: velocity (r), variance (g), valid (b)
uniform sampler2D uPolar;   // the LUT's polar coordinates per pixel: r in cm (r), theta in rad (g), top row first
uniform int uHeightPx;
uniform int uLines;
uniform int uSamples;
uniform int uColorOn;
uniform vec4 uBox;          // rMin, rMax, thetaMin, thetaMax
uniform vec2 uColorMap;     // scale (m/s), show variance (0/1)
out vec4 outColor;
${colorMapDefinesGlsl()}

uint grey(int s, int l) { return uint(texelFetch(uPacked, ivec2(s, l), 0).r * 255.0 + 0.5); }

// postprocess/colorMap.ts colorMap
vec3 colorMap(float v, float scale, float variance, bool showVariance) {
  float t = clamp(v / scale, -1.0, 1.0);
  float a = abs(t);
  float dominant = CM_DOMINANT_BASE + CM_DOMINANT_RANGE * min(1.0, a * CM_DOMINANT_GAIN);
  vec3 c = t >= 0.0
    ? vec3(dominant, CM_GREEN_BASE_TOWARD + CM_GREEN_RANGE_TOWARD * max(0.0, a - CM_GREEN_KNEE) * CM_GREEN_GAIN, CM_QUIET)
    : vec3(CM_QUIET, CM_GREEN_BASE_AWAY + CM_GREEN_RANGE_AWAY * max(0.0, a - CM_GREEN_KNEE) * CM_GREEN_GAIN, dominant);
  if (showVariance && variance > CM_VARIANCE_MIN) {
    float g = min(1.0, (variance - CM_VARIANCE_MIN) * CM_VARIANCE_GAIN);
    c.g = c.g * (1.0 - g) + CM_VARIANCE_GREEN * g;
    c.r = c.r * (1.0 - g * CM_VARIANCE_FADE);
    c.b = c.b * (1.0 - g * CM_VARIANCE_FADE);
  }
  return c;
}

void main() {
  int x = int(gl_FragCoord.x);
  int y = uHeightPx - 1 - int(gl_FragCoord.y);
  uvec4 L = texelFetch(uLut, ivec2(x, y), 0);
  if ((L.b & 2048u) == 0u) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  int l0 = int(L.r);
  int s0 = int(L.g);
  uint lt = L.b & 1023u;
  uint st = L.a & 1023u;
  int dl = int((L.b >> 10u) & 1u);
  int ds = int((L.a >> 10u) & 1u);
  uint v00 = grey(s0, l0), v10 = grey(s0, l0 + dl), v01 = grey(s0 + ds, l0), v11 = grey(s0 + ds, l0 + dl);
  uint g = ((v00 * (1024u - lt) + v10 * lt) * (1024u - st) + (v01 * (1024u - lt) + v11 * lt) * st) >> 20u;
  vec3 rgb = vec3(float(g));
  if (uColorOn == 1) {
    vec2 rt = texelFetch(uPolar, ivec2(x, y), 0).rg;
    if (rt.x >= uBox.x && rt.x <= uBox.y && rt.y >= uBox.z && rt.y <= uBox.w) {
      int li = min(uLines - 1, l0 + (lt >= 512u ? 1 : 0));
      int si = min(uSamples - 1, s0 + (st >= 512u ? 1 : 0));
      vec4 cf = texelFetch(uColor, ivec2(si, li), 0);
      if (cf.b > 0.5) rgb = floor(colorMap(cf.r, uColorMap.x, cf.g, uColorMap.y > 0.5) * COLOR_BLEND + rgb * (1.0 - COLOR_BLEND) + 0.5);
    }
  }
  outColor = vec4(rgb / 255.0, 1.0);
}
`;
