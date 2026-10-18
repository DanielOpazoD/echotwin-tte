import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  ribCenterY,
  ribDepth,
  ribRadiusAt,
  skinNormal,
  skinZ,
  type ThoraxModel,
} from '@/simulator/anatomy/thoraxModel';
import { heartToTorso } from '@/simulator/anatomy/heartFrame';
import type { NavigatorModel, WindowMark } from '@/workers/heartMesh.worker';

/**
 * The body of the 3D navigator, built once per case from the navigator model the mesh worker sends: the skin, the rib
 * cage, the acoustic windows and the schematic heart that stands in until the surfaces arrive.
 */

/** Superellipse cross-section point at angle θ (0 = front centre), scaled inward by `inset` cm. */
function crossSection(
  t: ThoraxModel,
  theta: number,
  y: number,
  inset: number,
): { x: number; z: number } {
  const n = t.n;
  const aw = t.aw - inset;
  const b = t.bDepth - inset;
  const s = Math.sin(theta),
    c = Math.cos(theta);
  const x = aw * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  let z = -t.bDepth + b * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  if (y > 8) z -= 0.12 * (y - 8) * (y - 8);
  if (y < -8) z -= 0.18 * (-8 - y);
  return { x, z };
}

export function buildSkin(t: ThoraxModel): THREE.Mesh {
  const nT = 64,
    nY = 44;
  const thMax = 1.45; // ~83° each side: anterior and lateral chest
  const ys = -19,
    ye = 13;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nY; j++) {
    const y = ys + ((ye - ys) * j) / nY;
    const taper = 1 - 0.06 * Math.max(0, (-y - 6) / 10) - 0.03 * Math.max(0, (y - 9) / 4); // waist / shoulder slope (cosmetic)
    for (let i = 0; i <= nT; i++) {
      const th = -thMax + (2 * thMax * i) / nT;
      const p = crossSection(t, th, y, 0);
      pos.push(p.x * taper, y, p.z);
    }
  }
  for (let j = 0; j < nY; j++)
    for (let i = 0; i < nT; i++) {
      const a = j * (nT + 1) + i;
      idx.push(a, a + 1, a + nT + 1, a + 1, a + nT + 2, a + nT + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // skin with a soft sheen (decision 202): the rim light catches the shoulders and the flanks
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xd9b59a,
    roughness: 0.62,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0xffd3b8),
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 2;
  // neck + shoulders (cosmetic landmarks: suprasternal notch sits between them)
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(5.2, 6.2, 9, 24),
    new THREE.MeshStandardMaterial({ color: 0xd9b59a, roughness: 0.8 }),
  );
  neck.position.set(0, 16.5, -t.bDepth * 0.55);
  mesh.add(neck);
  for (const side of [-1, 1]) {
    const sh = new THREE.Mesh(
      new THREE.SphereGeometry(5.5, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xd9b59a, roughness: 0.8 }),
    );
    sh.scale.set(1.35, 0.85, 1);
    sh.position.set(side * (t.aw + 1.5), 10.5, -t.bDepth * 0.6);
    mesh.add(sh);
  }
  return mesh;
}

/** Colour of each acoustic window's marks: the same family the console uses for the view presets. */
const WINDOW_COLORS: Record<WindowMark['window'], number> = {
  parasternal: 0xf59e0b,
  apical: 0x0ea5e9,
  subcostal: 0x10b981,
  suprasternal: 0xec4899,
};

const WINDOW_LABELS: Record<WindowMark['window'], string> = {
  parasternal: 'Paraesternal',
  apical: 'Apical',
  subcostal: 'Subcostal',
  suprasternal: 'Supraesternal',
};

/**
 * Rings on the skin where the canonical views are acquired for this patient (decision 132): one ring per distinct
 * position (several short-axis presets share the parasternal window to the millimetre) and one label per window.
 * The positions come from the same window solver that scores the views, so the marks and the guidance agree.
 */
export function buildWindowMarks(t: ThoraxModel, marks: WindowMark[]): THREE.Group {
  const g = new THREE.Group();
  const placed: { window: WindowMark['window']; u: number; v: number }[] = [];
  for (const m of marks) {
    if (placed.some((p) => p.window === m.window && Math.hypot(p.u - m.u, p.v - m.v) < 0.35))
      continue;
    placed.push({ window: m.window, u: m.u, v: m.v });
    // a thin ring with a faint halo (decision 202) instead of the thick band
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.47, 0.56, 40),
      new THREE.MeshBasicMaterial({
        color: WINDOW_COLORS[m.window],
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.7, 40),
      new THREE.MeshBasicMaterial({
        color: WINDOW_COLORS[m.window],
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.renderOrder = 3;
    ring.add(halo);
    const n = skinNormal(t, m.u, m.v);
    const z = skinZ(t, m.u, m.v);
    ring.position.set(m.u + n.x * 0.06, m.v + n.y * 0.06, z + n.z * 0.06);
    ring.lookAt(m.u + n.x, m.v + n.y, z + n.z);
    ring.renderOrder = 3;
    g.add(ring);
  }
  // one label per window, above the centroid of its rings
  const byWindow = new Map<WindowMark['window'], { u: number; v: number; n: number }>();
  for (const p of placed) {
    const acc = byWindow.get(p.window) ?? { u: 0, v: 0, n: 0 };
    acc.u += p.u;
    acc.v += p.v;
    acc.n++;
    byWindow.set(p.window, acc);
  }
  for (const [w, acc] of byWindow) {
    const u = acc.u / acc.n,
      v = acc.v / acc.n;
    const n = skinNormal(t, u, v);
    const sprite = textSprite(WINDOW_LABELS[w], WINDOW_COLORS[w]);
    sprite.position.set(u + n.x * 1.2, v + n.y * 1.2 + 1.1, skinZ(t, u, v) + n.z * 1.2);
    sprite.renderOrder = 3;
    g.add(sprite);
  }
  return g;
}

/** A small text label that always faces the camera (canvas texture on a sprite). */
export function textSprite(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const scale = 2;
  const font = `600 ${11 * scale}px system-ui, -apple-system, sans-serif`;
  const ctx = canvas.getContext('2d');
  const textW = ctx ? ((ctx.font = font), ctx.measureText(text).width) : 80;
  const dotR = 3 * scale;
  const dotX = 7 * scale + dotR;
  const textX = dotX + dotR + 4 * scale;
  const w = Math.ceil(textX + textW + 7 * scale);
  const h = 20 * scale;
  canvas.width = w;
  canvas.height = h;
  if (ctx) {
    ctx.font = font;
    const r = 5 * scale;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(0, 0, w, h, r);
    } else {
      ctx.rect(0, 0, w, h);
    }
    ctx.fill();
    ctx.lineWidth = 1.2 * scale;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.42)';
    ctx.stroke();

    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.beginPath();
    ctx.arc(dotX, h / 2, dotR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, textX, h / 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    }),
  );
  sprite.scale.set((canvas.width / canvas.height) * 1.1, 1.1, 1);
  return sprite;
}

export function buildSkeleton(t: ThoraxModel): THREE.Group {
  const g = new THREE.Group();
  const bone = new THREE.MeshStandardMaterial({ color: 0xebe6da, roughness: 0.5 });
  const cartilage = new THREE.MeshStandardMaterial({
    color: 0xcfd9e6,
    roughness: 0.5,
    transparent: true,
    opacity: 0.85,
  });
  const depth = ribDepth(t);
  const thMax = 1.4;
  // ribs 1–10, both sides; ribs run posterior-superior to anterior-inferior; 8–10 stop short of the sternum
  for (let k = 1; k <= 10; k++) {
    for (const side of [-1, 1]) {
      const yFront = ribCenterY(t, k, 1.8);
      const xEnd = k <= 7 ? 1.8 : 3.2 + (k - 7) * 1.4; // anterior end (sternum or costal margin)
      const pts: THREE.Vector3[] = [];
      const cart: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) {
        const th = (thMax * i) / 40;
        const p = crossSection(t, side * th, yFront, depth);
        if (Math.abs(p.x) < xEnd) continue;
        const y = yFront + 3.8 * Math.pow(th / thMax, 1.3);
        const v = new THREE.Vector3(p.x, y, p.z);
        pts.push(v);
        if (Math.abs(p.x) < 5.5 && k <= 7) cart.push(v);
      }
      if (pts.length < 3) continue;
      const r = ribRadiusAt(t, 5) * 0.9;
      g.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 8, false),
          k <= 7 && cart.length >= 3 ? bone : bone,
        ),
      );
      if (cart.length >= 3)
        g.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cart), 12, r * 1.05, 8, false),
            cartilage,
          ),
        );
    }
  }
  // sternum: manubrium, body, xiphoid
  const sz = (y: number) => skinZ(t, 0, y) - t.chestWall * 0.3 - 0.45;
  const manubrium = new THREE.Mesh(new RoundedBoxGeometry(5.0, 4.4, 0.9, 3, 0.4), bone);
  manubrium.position.set(0, 8.4, sz(8.4));
  const body = new THREE.Mesh(new RoundedBoxGeometry(3.0, 10.4, 0.8, 3, 0.4), bone);
  body.position.set(0, 1.2, sz(1.2));
  const xiphoid = new THREE.Mesh(new RoundedBoxGeometry(1.5, 2.6, 0.5, 3, 0.3), cartilage);
  xiphoid.position.set(0, -5.3, sz(-5.3));
  g.add(manubrium, body, xiphoid);
  // clavicles
  for (const side of [-1, 1]) {
    const pts = [
      new THREE.Vector3(side * 1.9, 10.6, sz(10.6) + 0.6),
      new THREE.Vector3(side * 7, 11.6, sz(10.6) - 0.6),
      new THREE.Vector3(side * 13.5, 12.4, sz(10.6) - 3.6),
    ];
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.45, 8, false),
        bone,
      ),
    );
  }
  return g;
}

export function buildHeartGhost(model: NavigatorModel): THREE.Group {
  const g = new THREE.Group();
  const f = model.frame;
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(f.ex.x, f.ex.y, f.ex.z),
    new THREE.Vector3(f.ey.x, f.ey.y, f.ey.z),
    new THREE.Vector3(f.ez.x, f.ez.y, f.ez.z),
  );
  for (const p of model.ghost) {
    const mat = new THREE.MeshStandardMaterial({
      color: p.color,
      transparent: true,
      opacity: p.opacity,
      roughness: 0.6,
      depthWrite: false,
    });
    if (p.kind === 'ellipsoid') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
      const c = heartToTorso(f, p.center);
      m.position.set(c.x, c.y, c.z);
      m.quaternion.setFromRotationMatrix(basis);
      m.scale.set(p.radii.x, p.radii.y, p.radii.z);
      g.add(m);
    } else if (p.end) {
      const a = heartToTorso(f, p.center),
        b = heartToTorso(f, p.end);
      const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
      const len = dir.length();
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(p.radii.x, p.radii.x * 0.9, len, 16),
        mat,
      );
      m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      g.add(m);
    }
  }
  // LV long axis hint
  const apex = heartToTorso(f, { x: 0, y: 0, z: model.lvLengthCm });
  const base = heartToTorso(f, { x: 0, y: 0, z: 0 });
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(base.x, base.y, base.z),
      new THREE.Vector3(apex.x, apex.y, apex.z),
    ]),
    new THREE.LineDashedMaterial({
      color: 0xffc857,
      dashSize: 0.5,
      gapSize: 0.3,
      transparent: true,
      opacity: 0.7,
    }),
  );
  line.computeLineDistances();
  g.add(line);
  g.renderOrder = 1;
  return g;
}
