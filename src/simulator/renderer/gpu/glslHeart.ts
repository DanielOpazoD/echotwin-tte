/**
 * GLSL port of `classifyHeart` (heartModel.ts). Mirrors the CPU classifier block by block; the
 * equivalence test (e2e/gpu-equivalence.spec.ts) compares both on the canonical views.
 */
export const GLSL_HEART = /* glsl */ `
struct Sample {
  int tissue;
  int structure;
  float sdf;
  vec3 n;
  vec3 m;
  float extra;
};

void setSample(out Sample s, int tissue, float sdf, vec3 n, vec3 m, float extra, int structure) {
  float l = length(n);
  s.tissue = tissue;
  s.sdf = sdf;
  s.n = l > 0.0 ? n / l : n;
  s.m = m;
  s.extra = extra;
  s.structure = structure;
}

// ---- profile helpers (skirts) ----
float profAt(int base, int i) { return P(base + i); }

// distance to an AV-valve skirt; returns thickness at the point, writes distance/frac
float skirtDistance(vec3 p, vec3 c, float R, int profA, int profP, float phiA, float halfSpan, float blend, float thickness, float saddle, out float dOut, out float fracOut) {
  vec2 d = p.xy - c.xy;
  float rho = length(d);
  float phi = atan(d.y, d.x);
  float dphi = abs(phi - phiA);
  if (dphi > PI) dphi = TWO_PI - dphi;
  float t = (dphi - (halfSpan - blend)) / (2.0 * blend);
  float w = t <= 0.0 ? 1.0 : (t >= 1.0 ? 0.0 : 1.0 - t * t * (3.0 - 2.0 * t));
  float zr = p.z - c.z - saddleOffset(phi, phiA, saddle);
  float best = 1e9;
  float bestFrac = 0.0;
  for (int i = 0; i < 3; i++) {
    float ax = w * profAt(profA, i * 2) + (1.0 - w) * profAt(profP, i * 2);
    float az = w * profAt(profA, i * 2 + 1) + (1.0 - w) * profAt(profP, i * 2 + 1);
    float bx = w * profAt(profA, i * 2 + 2) + (1.0 - w) * profAt(profP, i * 2 + 2);
    float bz = w * profAt(profA, i * 2 + 3) + (1.0 - w) * profAt(profP, i * 2 + 3);
    float ex = bx - ax, ez = bz - az;
    float l2 = ex * ex + ez * ez;
    float u = l2 > 0.0 ? ((rho - ax) * ex + (zr - az) * ez) / l2 : 0.0;
    u = clamp(u, 0.0, 1.0);
    float qx = ax + ex * u - rho;
    float qz = az + ez * u - zr;
    float dd = sqrt(qx * qx + qz * qz);
    if (dd < best) { best = dd; bestFrac = (float(i) + u) / 3.0; }
  }
  dOut = best;
  fracOut = bestFrac;
  return thickness * (1.0 - 0.45 * bestFrac) * 0.5 + 0.035;
}

// distance to a 2-segment cusp chain with tapered width
float sdCuspChain(vec3 p, int segBase, float segLen, vec3 w, float halfW, float taper, out float fracOut) {
  float best = 1e9;
  float bestFrac = 0.0;
  for (int i = 0; i < 2; i++) {
    float hw = halfW * (1.0 - taper * (float(i) + 0.5) / 2.0);
    int o = segBase + i * 6;
    vec3 s0 = vec3(P(o), P(o + 1), P(o + 2));
    vec3 d = vec3(P(o + 3), P(o + 4), P(o + 5));
    vec3 r = p - s0;
    float a = clamp(dot(r, d), 0.0, segLen);
    float b = clamp(dot(r, w), -hw, hw);
    vec3 q = s0 + d * a + w * b - p;
    float dd = length(q);
    if (dd < best) { best = dd; bestFrac = (float(i) + a / segLen) / 2.0; }
  }
  fracOut = bestFrac;
  return best;
}

int ahaSegment(float az, float levelFrac) {
  float deg = mod(az * 180.0 / PI + 28.0, 360.0);
  if (deg < 0.0) deg += 360.0;
  if (levelFrac > 0.93) return 17;
  if (levelFrac > 0.66) {
    if (deg < 45.0 || deg >= 315.0) return 16;
    if (deg < 135.0) return 13;
    if (deg < 225.0) return 14;
    return 15;
  }
  int base = levelFrac <= 0.33 ? 0 : 6;
  if (deg < 60.0) return base + 6;
  if (deg < 120.0) return base + 1;
  if (deg < 180.0) return base + 2;
  if (deg < 240.0) return base + 3;
  if (deg < 300.0) return base + 4;
  return base + 5;
}

// RV crescent: returns [signed distance, rIn, rOut]
vec3 rvCrescent(vec3 p, float az, float apexThick) {
  float L = LV_LEN;
  float azN = az < 0.0 ? az + TWO_PI : az;
  float u = (azN - RV_AZA) / (RV_AZP - RV_AZA);
  float r = length(p.xy);
  float cE = CCAV + apexThick * 0.7;
  float zeta = (p.z - ZCCAV) / cE;
  float ellFac = sqrt(max(0.0, 1.0 - zeta * zeta));
  float cosA = cos(az), sinA = sin(az);
  float rEpi = (AEPI * BEPI / sqrt(BEPI * cosA * (BEPI * cosA) + AEPI * sinA * (AEPI * sinA))) * ellFac;
  float rIn = rEpi + 0.05;
  float zApex = RV_APEX_FRAC * L;
  if (u <= 0.0 || u >= 1.0) return vec3(1e3, rIn, rIn);
  float tvPlane = TV_CZ + TVZ;
  float zBase = u >= 0.35 ? tvPlane : tvPlane - 2.2 * (1.0 - u / 0.35);
  float fz = 1.0;
  if (p.z > tvPlane) {
    float q = (p.z - tvPlane) / max(0.5, zApex - tvPlane);
    fz = q >= 1.0 ? 0.0 : sqrt(1.0 - q * q);
  }
  float plateau = min(1.0, sin(PI * u) / 0.7071);
  float uIn = (PI + 0.04 - RV_AZA) / (RV_AZP - RV_AZA);
  float inflow = exp(-((u - uIn) * (u - uIn)) / (2.0 * 0.15 * 0.15));
  float prof = 0.8 * plateau + 0.2 * inflow;
  float t = RV_T * prof * fz * (1.0 - 0.35 * CONTRACTION);
  if (p.z > 0.3 * L) t += 0.22 * min(1.0, (p.z - 0.3 * L) / (0.3 * L)) * (lat(vec3(p.x * 1.7 + 3.1, p.y * 1.7 + 9.7, p.z * 1.7 + 5.3), 3) - 0.5);
  float rOut = rIn + max(0.0, t);
  float d = max(max(rIn - r, r - rOut), max(zBase - p.z, p.z - zApex));
  if (u < 0.08 || u > 0.92) d = max(d, 0.35 - t);
  return vec3(d, rIn, rOut);
}

// Shared RV distance for the pericardium block (recomputed; cheap)
bool classifyHeart(vec3 p, out Sample s) {
  float x = p.x, y = p.y, z = p.z;
  vec3 bd = p - vec3(BOUND_CX, BOUND_CY, BOUND_CZ);
  if (dot(bd, bd) > BOUND_R * BOUND_R) return false;
  float zAnn = ZANN;

  // ---------- aortic root coordinates ----------
  float rootT = -99.0, rootRr = 0.0, rootR = 0.0;
  vec3 rootQ = vec3(0.0);
  vec3 avC = vec3(AV_CX, AV_CY, AV_CZ);
  vec3 ax = vec3(AV_AXX, AV_AXY, AV_AXZ);
  {
    float czz = avC.z + zAnn * 0.5;
    vec3 d = vec3(x - avC.x, y - avC.y, z - czz);
    float t = dot(d, ax);
    if (t > -1.6 && t < 6.5) {
      float bend = t > 3.0 ? 0.16 * (t - 3.0) * (t - 3.0) : 0.0;
      rootQ = d - ax * t - vec3(AV_BX, AV_BY, AV_BZ) * bend;
      rootRr = length(rootQ);
      rootT = t;
      if (t < 0.0) rootR = AV_R * 0.95 + (LVOT_D / 2.0 - AV_R * 0.95) * min(1.0, -t / 1.2);
      else if (t < 2.2) rootR = AV_R + (SINUS_R - AV_R) * sin(PI * t / 2.2);
      else if (t < 3.2) rootR = min(ASC_R, SINUS_R * 0.88);
      else rootR = ASC_R;
    }
  }
  bool inRootLumen = rootT >= -0.05 && rootRr < rootR;

  // ---------- valves ----------
  {
    float dS, fr;
    vec3 c = vec3(MVS_CX, MVS_CY, MVS_CZ);
    float t = skirtDistance(p, c, MVS_R, MVS_PROFA_BASE, MVS_PROFP_BASE, MVS_PHIA, MVS_HALFSPAN, MVS_BLEND, MVS_T, MVS_SADDLE, dS, fr);
    if (dS < t) {
      vec2 dm = p.xy - c.xy;
      float rr = length(dm); if (rr == 0.0) rr = 1.0;
      setSample(s, T_VALVE, dS - t, vec3(dm / rr, 0.8), p, MV_CALC, dm.y > 0.0 ? S_MV_ANT : S_MV_POST);
      return true;
    }
  }
  int nCusps = int(CUSP_COUNT + 0.5);
  for (int i = 0; i < 3; i++) {
    if (i >= nCusps) break;
    vec3 w = vec3(P(CUSP_W_BASE + i * 3), P(CUSP_W_BASE + i * 3 + 1), P(CUSP_W_BASE + i * 3 + 2));
    float fr;
    float dd = sdCuspChain(p, CUSP_SEGS_BASE + i * 12, CUSP_SEGLEN, w, CUSP_HALF, 0.75, fr);
    float t = CUSP_T * (1.0 - 0.3 * fr) * 0.5 + 0.03;
    if (dd < t && rootRr < rootR + 0.02) {
      int o = CUSP_SEGS_BASE + i * 12 + min(1, int(floor(fr * 2.0))) * 6;
      vec3 d = vec3(P(o + 3), P(o + 4), P(o + 5));
      setSample(s, T_VALVE, dd - t, cross(d, w), p, AV_CALC, S_AV);
      return true;
    }
  }
  if (AV_OPEN < 0.2 && rootT > 0.0 && rootRr < rootR * 0.97) {
    float finLo = AV_R * 0.45, finHi = AV_R * 1.05;
    if (rootT > finLo && rootT < finHi) {
      vec3 e1 = vec3(AV_E1X, AV_E1Y, AV_E1Z);
      vec3 e2 = vec3(AV_E2X, AV_E2Y, AV_E2Z);
      float u1 = dot(rootQ, e1), u2 = dot(rootQ, e2);
      float phi = atan(u2, u1);
      float n = CUSP_COUNT;
      float per = TWO_PI / n;
      float dphi = mod(mod(phi - PI / n, per) + per, per);
      if (dphi > PI / n) dphi = per - dphi;
      float dist = rootRr * sin(dphi);
      if (dist < 0.04) {
        setSample(s, T_VALVE, dist - 0.04, e1, p, AV_CALC, S_AV);
        return true;
      }
    }
  }
  {
    float dS, fr;
    vec3 c = vec3(TVS_CX, TVS_CY, TVS_CZ);
    float t = skirtDistance(p, c, TVS_R, TVS_PROFA_BASE, TVS_PROFP_BASE, TVS_PHIA, TVS_HALFSPAN, TVS_BLEND, TVS_T, TVS_SADDLE, dS, fr);
    if (dS < t) {
      vec2 dm = p.xy - c.xy;
      float rr = length(dm); if (rr == 0.0) rr = 1.0;
      setSample(s, T_VALVE, dS - t, vec3(dm / rr, 0.8), p, 0.0, S_TV);
      return true;
    }
  }
  {
    vec3 r = vec3(MV_RING_X, MV_RING_Y, MV_RING_Z);
    float dR = sdTorusZ(vec3(x, y, z - saddleOffset(atan(y - r.y, x - r.x), MVS_PHIA, MVS_SADDLE)), r, MV_RING_R, 0.11);
    if (dR < 0.0) {
      setSample(s, T_FIBROUS, dR, vec3(x - r.x, y - r.y, 0.0), p, 0.15 * MV_CALC, S_MV_ANN);
      return true;
    }
    vec3 q = vec3(TV_RING_X, TV_RING_Y, TV_RING_Z);
    float dT = sdTorusZ(vec3(x, y, z - saddleOffset(atan(y - q.y, x - q.x), TVS_PHIA, TVS_SADDLE)), q, TV_RING_R, 0.09);
    if (dT < 0.0) {
      setSample(s, T_FIBROUS, dT, vec3(x - q.x, y - q.y, 0.0), p, 0.0, S_TV_ANN);
      return true;
    }
  }
  for (int i = 0; i < 4; i++) {
    int o = CHORDAE_BASE + i * 6;
    float d = sdCapsule(p, vec3(P(o), P(o + 1), P(o + 2)), vec3(P(o + 3), P(o + 4), P(o + 5)), 0.045);
    if (d < 0.0) {
      setSample(s, T_CHORDAE, d, vec3(0.0, 0.0, 1.0), p, 0.0, S_CHORDAE);
      return true;
    }
  }

  // ---------- LV cavity & wall ----------
  float dEll = sdEllipsoid(p, vec3(0.0, 0.0, ZCCAV), vec3(ACAV, BCAV, CCAV));
  float dCav = smax(dEll, zAnn - z, 0.6);
  float az = atan(y, x);
  float levelFrac = clamp((z - zAnn) / max(LENGTH_NOW, 1.0), 0.0, 1.0);
  int seg = ahaSegment(az, levelFrac);
  float amp = P(SEG_AMP_BASE + seg);
  float regional = (1.0 - amp) * (LV_A - ACAV);
  float trab = levelFrac > 0.55 ? 0.16 * min(1.0, (levelFrac - 0.55) / 0.3) * (lat(vec3(x * 2.2 + 11.3, y * 2.2 + 2.9, z * 2.2 + 6.1), 3) - 0.5) : 0.0;
  float dCavR = dCav - regional + trab;
  float septalness = 0.5 - 0.5 * cos(az);
  float tED = LV_LVPWD + (LV_IVSD - LV_LVPWD) * septalness;
  float thickFactor = (AEPI - ACAV) / max((LV_A + (LV_IVSD + LV_LVPWD) / 2.0) - LV_A, 0.2);
  float wallMod = 0.86 + 0.28 * lat(vec3(cos(az) * 1.6 + 7.3, sin(az) * 1.6 + 2.1, levelFrac * 2.4), 3);
  float tNow = tED * max(0.6, thickFactor * (0.6 + 0.4 * amp)) * wallMod;
  float apexThick = APEX_T;
  float rs = RADIAL_SCALE, ls = LONG_SCALE;
  if (dCavR < 0.0) {
    vec3 pa = vec3(PAP_ALX, PAP_ALY, PAP_ALZ);
    vec3 pm = vec3(PAP_PMX, PAP_PMY, PAP_PMZ);
    float pr = PAP_R * (0.9 + 0.3 * CONTRACTION);
    float dPa = sdCapsule(p, vec3(pa.x * rs, pa.y * rs, pa.z * ls), vec3(pa.x * rs * 0.9, pa.y * rs * 0.9, pa.z * ls - 1.6 * ls), pr);
    float dPm = sdCapsule(p, vec3(pm.x * rs, pm.y * rs, pm.z * ls), vec3(pm.x * rs * 0.9, pm.y * rs * 0.9, pm.z * ls - 1.6 * ls), pr);
    float dPap = min(dPa, dPm);
    if (dPap < 0.0) {
      setSample(s, T_MYO, dPap, vec3(x, y, 0.0), vec3(x / rs, y / rs, z / ls), 0.0, S_PAP);
      return true;
    }
    setSample(s, T_BLOOD, dCavR, vec3(x / ACAV, y / BCAV, (z - ZCCAV) / CCAV), vec3(x / rs, y / rs, (z - LV_LEN) / ls), 0.0, S_LV_CAV);
    return true;
  }
  float wallT = z > LV_LEN - 0.5 ? apexThick : tNow;
  float dEllR = dEll - regional;
  if (dEllR >= 0.0 && dEllR < wallT && z >= zAnn - 0.25 && !inRootLumen) {
    int structure = S_LV_LAT;
    if (z > LV_LEN - 0.6) structure = S_LV_APEX;
    else if (septalness > 0.7) structure = S_LV_SEPT;
    else if (sin(az) > 0.5) structure = S_LV_ANT;
    else if (sin(az) < -0.5) structure = S_LV_INF;
    float dIn = -min(dEllR, wallT - dEllR);
    float sg = (wallT - dEllR < dEllR) ? 1.0 : -1.0;
    setSample(s, T_MYO, dIn, sg * vec3(x / ACAV, y / BCAV, (z - ZCCAV) / CCAV), vec3(x / rs, y / rs, (z - LV_LEN) / ls), 0.0, structure);
    return true;
  }
  bool inAnnularRegion = dEllR < 0.0 && z < zAnn && !inRootLumen;
  if (inAnnularRegion) {
    vec2 md = vec2(x - MV_CX, y - MV_CY);
    if (length(md) < MV_R * 0.98) {
      setSample(s, T_BLOOD, -0.3, vec3(0.0, 0.0, 1.0), p, 0.0, S_LV_CAV);
      return true;
    }
  }

  // ---------- aortic root / LVOT ----------
  if (rootT > -1.6) {
    float wall = 0.2;
    if (rootRr < rootR) {
      setSample(s, T_BLOOD, rootRr - rootR, rootQ / rootRr, vec3(x, y, z - zAnn * 0.5), 0.0, rootT < 0.0 ? S_LVOT : S_AO_ROOT);
      return true;
    }
    if (rootRr < rootR + wall) {
      float dIn = -min(rootRr - rootR, rootR + wall - rootRr);
      setSample(s, T_VESSEL, dIn, rootQ / rootRr, p, 0.0, S_AO_ROOT);
      return true;
    }
  }
  if (inAnnularRegion && z > zAnn - 1.2) {
    setSample(s, T_FIBROUS, -0.15, vec3(0.0, 0.0, 1.0), p, 0.0, S_LV_SEPT);
    return true;
  }

  // ---------- atria ----------
  vec3 la = vec3(LA_CX, LA_CY, LA_CZ);
  vec3 lr = vec3(LA_RX, LA_RY, LA_RZ);
  vec3 ra = vec3(RA_CX, RA_CY, RA_CZ);
  vec3 rar = vec3(RA_RX, RA_RY, RA_RZ);
  float bo = LA_BOOSTER * (0.88 + 0.12 * CONTRACTION);
  float czL, rzL, czR, rzR;
  {
    float zTop = la.z - lr.z;
    float zBottom = zAnn + 0.25;
    czL = (zTop + zBottom) / 2.0;
    rzL = (zBottom - zTop) / 2.0;
    float d = sdEllipsoid(p, vec3(la.x, la.y, czL), vec3(lr.x * bo, lr.y * bo, rzL));
    if (d < 0.0) {
      setSample(s, T_BLOOD, d, vec3((x - la.x) / lr.x, (y - la.y) / lr.y, (z - czL) / rzL), p, 0.0, S_LA_CAV);
      return true;
    }
    if (d < 0.25) {
      setSample(s, T_MYO, -min(d, 0.25 - d), vec3((x - la.x) / lr.x, (y - la.y) / lr.y, (z - czL) / rzL), p, 0.0, S_LA_WALL);
      return true;
    }
    float zTopR = ra.z - rar.z;
    float zBotR = TV_CZ + TVZ * 0.7 + 0.25;
    czR = (zTopR + zBotR) / 2.0;
    rzR = (zBotR - zTopR) / 2.0;
    float dR = sdEllipsoid(p, vec3(ra.x, ra.y, czR), vec3(rar.x * bo, rar.y * bo, rzR));
    if (dR < 0.0) {
      setSample(s, T_BLOOD, dR, vec3((x - ra.x) / rar.x, (y - ra.y) / rar.y, (z - czR) / rzR), p, 0.0, S_RA_CAV);
      return true;
    }
    if (dR < 0.22) {
      setSample(s, T_MYO, -min(dR, 0.22 - dR), vec3((x - ra.x) / rar.x, (y - ra.y) / rar.y, (z - czR) / rzR), p, 0.0, S_RA_WALL);
      return true;
    }
    if (d < 0.75 && dR < 0.75 && z < zAnn + 0.4) {
      setSample(s, T_MYO, -min(0.75 - d, 0.75 - dR), vec3(1.0, 0.0, 0.0), p, 0.0, S_IAS);
      return true;
    }
    float xIas = (la.x - lr.x + ra.x + rar.x) / 2.0;
    if (abs(x - xIas) < 0.3 && z < zAnn + 0.4 && sdEllipsoid(p, vec3(la.x, la.y, czL), vec3(lr.x + 1.3, lr.y + 0.9, rzL + 0.6)) < 0.0 && sdEllipsoid(p, vec3(ra.x, ra.y, czR), vec3(rar.x + 1.3, rar.y + 0.9, rzR + 0.6)) < 0.0) {
      setSample(s, T_MYO, -(0.3 - abs(x - xIas)), vec3(1.0, 0.0, 0.0), p, 0.0, S_IAS);
      return true;
    }
    // appendage
    {
      vec3 a0 = vec3(la.x + lr.x * 0.55, la.y + lr.y * 0.55, czL + 0.4);
      vec3 a1 = vec3(la.x + lr.x * 0.95, a0.y + 2.0, czL + 0.9);
      float lob = 0.12 * (lat(vec3(x * 2.3 + 1.7, y * 2.3 + 4.2, z * 2.3 + 8.8), 3) - 0.5);
      float dApp = sdCapsule(p, a0, a1, 0.55 * bo + lob);
      if (dApp < 0.0) {
        setSample(s, T_BLOOD, dApp, vec3(0.0, 1.0, 0.0), p, 0.0, S_LAA);
        return true;
      }
      if (dApp < 0.18) {
        setSample(s, T_MYO, -min(dApp, 0.18 - dApp), vec3(0.0, 1.0, 0.0), p, 0.0, S_LA_WALL);
        return true;
      }
    }
    // pulmonary veins
    for (int i = 0; i < 4; i++) {
      float sx = (i == 0 || i == 2) ? -1.0 : 1.0;
      float px = la.x + sx * lr.x * 0.6;
      float pz = czL + (i < 2 ? -0.7 : 0.6);
      float py0 = la.y - lr.y * 0.8;
      float dPv = sdCapsule(p, vec3(px, py0, pz), vec3(px + sx * 0.9, py0 - 1.6, pz + (i < 2 ? -0.5 : 0.4)), 0.42);
      if (dPv < 0.0) {
        setSample(s, T_BLOOD, dPv, vec3(0.0, -1.0, 0.0), p, 0.0, S_PVEIN);
        return true;
      }
      if (dPv < 0.12) {
        setSample(s, T_VESSEL, -min(dPv, 0.12 - dPv), vec3(0.0, -1.0, 0.0), p, 0.0, S_PVEIN);
        return true;
      }
    }
    // coronary sinus
    {
      float gy = -(BEPI + 0.4);
      float dCs = sdCapsule(p, vec3(2.2, gy * 0.85, zAnn + 0.35), vec3(ra.x + rar.x * 0.4, gy * 0.7, zAnn + 0.1), 0.33);
      if (dCs < 0.0) {
        setSample(s, T_BLOOD, dCs, vec3(0.0, -1.0, 0.0), p, 0.0, S_CS);
        return true;
      }
      if (dCs < 0.1) {
        setSample(s, T_VESSEL, -min(dCs, 0.1 - dCs), vec3(0.0, -1.0, 0.0), p, 0.0, S_CS);
        return true;
      }
    }
  }

  // ---------- RV ----------
  vec3 rvc = rvCrescent(p, az, apexThick);
  float dRv = rvc.x;
  {
    float sc = CONTRACTION;
    float fw = RV_FW * (1.0 + 0.35 * sc);
    vec3 rvotA = vec3(RVOT_AX, RVOT_AY, RVOT_AZ);
    vec3 rvotB = vec3(RVOT_BX, RVOT_BY, RVOT_BZ);
    vec3 paEnd = vec3(PA_EX, PA_EY, PA_EZ);
    vec3 paDir = vec3(PA_DX, PA_DY, PA_DZ);
    float dRvot = sdCapsule(p, rvotA, rvotB, RVOT_R * (0.85 + 0.15 * (1.0 - sc)));
    float dPa = sdCapsule(p, rvotB, paEnd, PA_R);
    float dCavRv = min(dRv, min(dRvot, dPa));
    if (dPa < 0.0 && dRvot > -0.02) {
      vec3 v = p - rvotB;
      float along = dot(v, paDir);
      if (abs(along) < 0.08 && !(PV_OPEN > 0.3)) {
        setSample(s, T_VALVE, -0.05, paDir, p, 0.0, S_PV);
        return true;
      }
      if (dPa > -0.2) {
        setSample(s, T_VESSEL, dPa, v, p, 0.0, S_RVOT);
        return true;
      }
    }
    float sc3 = 1.0 - 0.3 * sc;
    if (dCavRv < 0.0) {
      if (dRv < 0.0) {
        float L = LV_LEN;
        float rIn = rvc.y, rOut = rvc.z;
        vec3 b0 = vec3(-(rIn + 0.12), -0.2, L * 0.56);
        float rB = rOut - fw * 1.2;
        vec3 b1 = vec3(rB * cos(2.75), rB * sin(2.75), L * 0.66);
        float dBand = sdCapsule(p, b0, b1, 0.28);
        if (dBand < 0.0) {
          setSample(s, T_MYO, dBand, vec3(0.0, 0.0, 1.0), p, 0.0, S_MOD_BAND);
          return true;
        }
      }
      float rr = length(p.xy); if (rr == 0.0) rr = 1.0;
      setSample(s, T_BLOOD, dCavRv, vec3(x / rr, y / rr, 0.0), vec3(x / sc3, y / sc3, z), 0.0, (dRvot < dRv || dPa < dRv) ? S_RVOT : S_RV_CAV);
      return true;
    }
    if (dCavRv < fw) {
      float rr = length(p.xy); if (rr == 0.0) rr = 1.0;
      setSample(s, T_MYO, -min(dCavRv, fw - dCavRv), vec3(x / rr, y / rr, 0.0), vec3(x / sc3, y / sc3, z), 0.0, S_RV_WALL);
      return true;
    }
  }

  // ---------- pericardium & effusion ----------
  {
    float dLvEpi = sdEllipsoid(p, vec3(0.0, 0.0, ZCCAV), vec3(AEPI, BEPI, CCAV + apexThick * 0.7));
    float fw = RV_FW;
    float dRvEpi = dRv - fw;
    float dLaEpi = sdEllipsoid(p, la, lr + 0.25);
    float dRaEpi = sdEllipsoid(p, ra, rar + 0.22);
    vec3 rvotA = vec3(RVOT_AX, RVOT_AY, RVOT_AZ);
    vec3 rvotB = vec3(RVOT_BX, RVOT_BY, RVOT_BZ);
    vec3 paEnd = vec3(PA_EX, PA_EY, PA_EZ);
    float dRvotEpi = sdCapsule(p, rvotA, rvotB, RVOT_R + fw);
    float dPaEpi = sdCapsule(p, rvotB, paEnd, PA_R + 0.2);
    float dEpi = min(min(dLvEpi, dRvEpi), min(min(dLaEpi, dRaEpi), min(dRvotEpi, dPaEpi)));
    float eff = EFFUSION;
    vec3 nEpi = vec3(x / AEPI, y / BEPI, (z - ZCCAV) / CCAV);
    if (dEpi < 0.12) {
      float de = max(dEpi, 0.0);
      setSample(s, T_PERI, -min(de, 0.12 - de), nEpi, p, 0.0, S_PERI);
      return true;
    }
    if (eff > 0.0 && dEpi < 0.12 + eff) {
      setSample(s, T_FLUID, dEpi - 0.12 - eff, nEpi, p, 0.0, S_EFFUSION);
      return true;
    }
    if (eff > 0.0 && dEpi < 0.12 + eff + 0.12) {
      setSample(s, T_PERI, 0.0, nEpi, p, 0.0, S_PERI);
      return true;
    }
  }
  return false;
}
`;
