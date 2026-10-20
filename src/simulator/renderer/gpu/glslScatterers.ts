/**
 * GLSL of the point scatterers anchored in tissue (decision 354): the mirror of `acoustic/scatterers.ts` for pass A,
 * compiled into a variant of it (`SCATTER_FIELD`) when the scene brings that image formation. The same 32-bit hash of
 * the cubes (GLSL ES 3.00 wraps its `uint` products modulo 2³², as `Math.imul` does), the same cubes, weights and
 * normalization; the phase of the sample's depth is reduced modulo 2π before the scatterer's offset is added, since
 * float32 has only a few thousandths of a radian left at 6000 rad. The wavenumber, the seed and every constant come as
 * uniforms (`scatterFieldGpu.ts`). Shipped with the formation's code, outside the WebGL2 chunk.
 */
export const GLSL_SCATTERERS = /* glsl */ `
uniform float uScatK;      // wavenumber of the received echo (rad/cm)
uniform uint uScatSeed;    // the scene's seed
uniform float uScatCell;   // edge of the cube that holds one scatterer (cm)
uniform float uScatReach;  // how far across the plane the elevation profile is summed, in standard deviations
uniform float uScatElev;   // the elevation profile's standard deviation over the slice's half-width

uint scatHash(int i, int j, int k, uint c) {
  uint h = (uint(i) * 0x8da6b343u) ^ (uint(j) * 0xd8163841u) ^ (uint(k) * 0xcb1ab31fu) ^ (c * 0x165667b1u) ^ uScatSeed;
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}

// The scatterer phasor of one sample: p is its material position on the probe's axes (forward, lateral, normal), the
// line runs at (cosT, sinT) from the forward axis, r is its depth, dr its spacing along the line, width the line
// spacing at that depth and sigmaE the elevation profile's standard deviation (cm).
vec2 scatterPhasor(vec3 p, float cosT, float sinT, float r, float dr, float width, float sigmaE) {
  const float U32 = 1.0 / 4294967296.0;
  const float SQRT3 = 1.7320508075688772;
  const float TAU = 6.283185307179586;
  float c = uScatCell;
  float halfA = dr, halfL = width;
  float reachE = uScatReach * sigmaE;
  float hu = abs(cosT) * halfA + abs(sinT) * halfL, hv = abs(sinT) * halfA + abs(cosT) * halfL;
  int i0 = int(floor((p.x - hu) / c)), i1 = int(floor((p.x + hu) / c));
  int j0 = int(floor((p.y - hv) / c)), j1 = int(floor((p.y + hv) / c));
  int k0 = int(floor((p.z - reachE) / c)), k1 = int(floor((p.z + reachE) / c));
  float inv2s2 = 1.0 / (2.0 * sigmaE * sigmaE);
  float base = mod(2.0 * uScatK * r, TAU);
  vec2 sum = vec2(0.0);
  for (int kk = k0; kk <= k1; kk++)
    for (int j = j0; j <= j1; j++)
      for (int i = i0; i <= i1; i++) {
        float pu = (float(i) + float(scatHash(i, j, kk, 0u)) * U32) * c - p.x;
        float pv = (float(j) + float(scatHash(i, j, kk, 1u)) * U32) * c - p.y;
        float pw = (float(kk) + float(scatHash(i, j, kk, 2u)) * U32) * c - p.z;
        float da = pu * cosT + pv * sinT;
        if (da <= -halfA || da >= halfA) continue;
        float dl = -pu * sinT + pv * cosT;
        if (dl <= -halfL || dl >= halfL || abs(pw) > reachE) continue;
        float g = ((float(scatHash(i, j, kk, 3u)) + float(scatHash(i, j, kk, 4u))) * U32 +
                   (float(scatHash(i, j, kk, 5u)) + float(scatHash(i, j, kk, 6u))) * U32 - 2.0) * SQRT3;
        float a = g * (1.0 - abs(da) / halfA) * (1.0 - abs(dl) / halfL) * exp(-pw * pw * inv2s2);
        float ph = -base - 2.0 * uScatK * da;
        sum += a * vec2(cos(ph), sin(ph));
      }
  float n = ((2.0 / 3.0) * dr * (2.0 / 3.0) * width * sqrt(3.141592653589793) * sigmaE) / (c * c * c);
  return n > 0.0 ? sum / sqrt(n) : vec2(0.0);
}
`;
