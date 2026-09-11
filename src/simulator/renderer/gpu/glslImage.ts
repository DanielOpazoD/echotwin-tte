import { NOISE_FLOOR, RAYLEIGH_MEAN, REF_DB } from '../postprocess/consolePipeline';
import { TRANS_K } from '../transmissionCode';

/**
 * GPU image chain after envelope detection (decision 54), mirroring the CPU code step by step:
 *  - console pass (postprocess/consolePipeline.ts): compensation table × (envelope + Rayleigh receiver noise
 *    from the same integer hash per line, sample, frame and seed) → log compression → edge enhancement along
 *    the beam → persistence against a history texture → grey map. It writes the new history (float) and a
 *    packed RGBA8 frame: grey, structure id, tissue id and the 8-bit log transmission code. Only that packed
 *    frame is read back. The mirror and side-lobe artifacts stay on the CPU console.
 *  - present pass (scanConvert.ts `scanConvertLut` + colorDoppler.ts `overlayColorField`): per pixel, the
 *    integer bilinear gather of the scan-conversion LUT uploaded as RGBA16UI texels, then the colour map blended
 *    inside the colour box, tested against the LUT's polar coordinates (uploaded as a float texture). It draws into the canvas, which is transferred as an ImageBitmap.
 */
const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const GLSL_CONSOLE_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uEnv;    // pass D: envelope amplitude (r), transmission (g)
uniform sampler2D uIds;    // pass B ids: structure / 255 (r), tissue / 255 (g)
uniform sampler2D uComp;   // console amplification per sample (r), one row
uniform sampler2D uHist;   // previous console output before the grey map (r)
uniform int uSamples;
uniform float uDynRange;   // dB
uniform float uEdge;       // edge enhancement strength (edgeEnhance · 0.8)
uniform float uPersist;    // weight of the history (0 without history)
uniform int uGrayMap;      // 0 linear, 1 s-curve, 2 high-contrast
uniform uint uSeed;
uniform uint uFrameIndex;
layout(location = 0) out vec4 outHist;
layout(location = 1) out vec4 outPacked;
#define NOISE_SCALE ${glslFloat(NOISE_FLOOR / RAYLEIGH_MEAN)}
#define REF_DB ${glslFloat(REF_DB)}
#define TRANS_K ${glslFloat(TRANS_K)}

// core/random.ts hash3: identical 32-bit integer mixing
uint hash3u(uint x, uint y, uint z, uint seed) {
  uint h = (x * 0x8da6b343u) ^ (y * 0xd8163841u) ^ (z * 0xcb1ab31fu) ^ seed;
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}

// amplification + noise + log compression of one sample → 0..1
float compressed(int si, int li) {
  float amp = texelFetch(uEnv, ivec2(si, li), 0).r;
  float u = float(hash3u(uint(li), uint(si), uFrameIndex, uSeed)) / 4294967296.0;
  float noise = NOISE_SCALE * sqrt(-2.0 * log(1.0 - 0.999999 * u));
  float a = (amp + noise) * texelFetch(uComp, ivec2(si, 0), 0).r;
  float db = 20.0 * log(a + 1e-6) * 0.4342944819032518 - REF_DB;
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
  if (uGrayMap == 1) g = g * g * (3.0 - 2.0 * g) * 0.85 + g * 0.15;
  else if (uGrayMap == 2) g = pow(g, 1.6);
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

uint grey(int s, int l) { return uint(texelFetch(uPacked, ivec2(s, l), 0).r * 255.0 + 0.5); }

// colorDoppler.ts colorMap
vec3 colorMap(float v, float scale, float variance, bool showVariance) {
  float t = clamp(v / scale, -1.0, 1.0);
  float a = abs(t);
  vec3 c = t >= 0.0
    ? vec3(120.0 + 135.0 * min(1.0, a * 1.2), 20.0 + 220.0 * max(0.0, a - 0.55) * 2.2, 20.0)
    : vec3(20.0, 40.0 + 200.0 * max(0.0, a - 0.55) * 2.2, 120.0 + 135.0 * min(1.0, a * 1.2));
  if (showVariance && variance > 0.15) {
    float g = min(1.0, (variance - 0.15) * 1.5);
    c.g = c.g * (1.0 - g) + 230.0 * g;
    c.r = c.r * (1.0 - g * 0.4);
    c.b = c.b * (1.0 - g * 0.4);
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
      if (cf.b > 0.5) rgb = floor(colorMap(cf.r, uColorMap.x, cf.g, uColorMap.y > 0.5) * 0.85 + rgb * 0.15 + 0.5);
    }
  }
  outColor = vec4(rgb / 255.0, 1.0);
}
`;
