import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BeamFrame } from '@/simulator/probe/pose';

/** The transducer of the 3D navigator and the imaging sector it casts. */

/**
 * Phased-array cardiac transducer. The footprint is taken from published probe specifications — 17×28 mm
 * on a GE M5S-D, 19×27 on a 3S-RS, 20×28 on an M4S-RS, 24×17 on an M3S — so the head is 2,85 cm along the
 * array (the imaging plane) by 1,90 cm in elevation, small enough to sit between two ribs. The length is
 * *not* a measured figure: no manufacturer sheet found gives it, so the 11,4 cm from the lens to the end of
 * the strain relief is plausible ergonomics (a barrel held like a thick pen), not a specification. Real probes also carry an index marker on
 * one side of the head and a tapered strain relief where the cable leaves the handle; here the marker is
 * also the pickable handle that rotates the probe, so it stays blue and grabbable on purpose.
 * Local frame: x lateral (marker side), y elevation, z ALONG THE BEAM, into the patient (the probe group's
 * third basis vector is beam.forward), so the lens sits at z = 0 and the whole body extends along −z.
 */
export function buildProbe(): { probe: THREE.Group; marker: THREE.Group } {
  const probe = new THREE.Group();
  // a clear-coated shell and lens (decision 202): the probe reads as moulded plastic under the room light
  const shell = new THREE.MeshPhysicalMaterial({
    color: 0xdadfe4,
    roughness: 0.45,
    metalness: 0.04,
    clearcoat: 0.55,
    clearcoatRoughness: 0.3,
  });
  const collar = new THREE.MeshStandardMaterial({
    color: 0x8b939c,
    roughness: 0.5,
    metalness: 0.3,
  });
  const lens = new THREE.MeshPhysicalMaterial({
    color: 0x1f2429,
    roughness: 0.2,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.8 });
  // head: 2,8 × 1,8 cm footprint, the array running along x
  const head = new THREE.Mesh(new RoundedBoxGeometry(2.85, 1.9, 1.5, 4, 0.3), shell);
  head.position.z = -0.76;
  // the acoustic lens is convex, not flat: a shallow spherical cap flattened in elevation
  const capR = 2.4;
  const lensMesh = new THREE.Mesh(
    new THREE.SphereGeometry(capR, 32, 12, 0, Math.PI * 2, 0, Math.asin(1.36 / capR)),
    lens,
  );
  lensMesh.rotation.x = Math.PI / 2; // the cap sits around +y: a positive turn points it at +z, into the patient
  lensMesh.scale.set(1, 1, 0.66); // scale is applied before the rotation, so local z becomes elevation: 1,8 cm
  lensMesh.position.z = -capR + 0.04; // cap apex ends up 0.4 mm proud of the contact face
  // shoulders: the head widens into the barrel instead of meeting it in a step
  const shoulder = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(1.4, 0),
        new THREE.Vector2(1.34, 0.3),
        new THREE.Vector2(1.2, 0.7),
        new THREE.Vector2(1.04, 1.15),
      ],
      28,
    ),
    shell,
  );
  shoulder.rotation.x = -Math.PI / 2; // lathe axis (+y) → −z, out of the patient
  shoulder.scale.set(1, 1, 0.72); // oval section, flattened in elevation
  shoulder.position.z = -1.5;
  // barrel with a waist where the fingers sit
  const rs = [1.04, 1.12, 1.1, 1.0, 0.93, 0.93, 1.0, 1.06, 1.02, 0.86];
  const profile = rs.map((r, i) => new THREE.Vector2(r, (i / (rs.length - 1)) * 7.4));
  // close the far end: a lathe has no caps, and seen end-on the barrel is a black hole where the cable leaves
  profile.push(new THREE.Vector2(0.6, 7.5), new THREE.Vector2(0, 7.56));
  const handle = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), shell);
  handle.rotation.x = -Math.PI / 2;
  handle.scale.set(1, 1, 0.74);
  handle.position.z = -2.65;
  // strain relief: the tapered, ribbed collar that takes the pull of the cable
  const relief = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.62 - t * 0.28, 0.12 - t * 0.04, 8, 20),
      rubber,
    );
    ring.position.z = -(10.15 + t * 1.15);
    relief.add(ring);
  }
  const reliefCone = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.68, 1.35, 20), rubber);
  reliefCone.rotation.x = -Math.PI / 2;
  reliefCone.position.z = -10.75;
  relief.add(reliefCone);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.86, 0.32, 24), collar);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1, 0.78);
  band.position.z = -9.95;
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, -11.4),
        new THREE.Vector3(0.2, 0.5, -13.2),
        new THREE.Vector3(0.7, 2.2, -15.4),
      ]),
      14,
      0.3,
      10,
      false,
    ),
    rubber,
  );
  // index marker: the ridge and dot on the +x (screen-right) side, and the handle the mouse grabs to rotate
  const marker = new THREE.Group();
  const ridge = new THREE.Mesh(
    new RoundedBoxGeometry(0.26, 0.62, 1.0, 2, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.45 }),
  );
  ridge.position.set(1.42, 0, -0.8);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x5cb0ee, emissive: 0x123c5e, roughness: 0.35 }),
  );
  dot.position.set(1.32, 0, -2.1);
  marker.add(ridge, dot);
  // the seam where the head meets the barrel, as on a moulded shell
  const seam = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.035, 8, 48), collar);
  seam.scale.set(1, 0.72, 1);
  seam.position.z = -1.5;
  probe.add(head, lensMesh, shoulder, handle, relief, band, cable, marker, seam);
  return { probe, marker };
}

export function updateFan(
  fan: THREE.Mesh,
  edges: THREE.LineSegments,
  beam: BeamFrame,
  depth: number,
  sectorDeg: number,
): void {
  const half = (sectorDeg * Math.PI) / 360;
  const verts: number[] = [];
  const o = beam.origin;
  const n = 16;
  const at = (a: number, r: number) => {
    const c = Math.cos(a),
      s = Math.sin(a);
    return [
      o.x + (beam.forward.x * c + beam.lateral.x * s) * r,
      o.y + (beam.forward.y * c + beam.lateral.y * s) * r,
      o.z + (beam.forward.z * c + beam.lateral.z * s) * r,
    ] as const;
  };
  for (let i = 0; i < n; i++) {
    const p0 = at(-half + (2 * half * i) / n, depth),
      p1 = at(-half + (2 * half * (i + 1)) / n, depth);
    verts.push(o.x, o.y, o.z, ...p0, ...p1);
  }
  fan.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  fan.geometry = g;
  const ev: number[] = [];
  const l = at(-half, depth),
    r = at(half, depth);
  ev.push(o.x, o.y, o.z, ...l, o.x, o.y, o.z, ...r);
  for (let i = 0; i < n; i++) {
    const p0 = at(-half + (2 * half * i) / n, depth),
      p1 = at(-half + (2 * half * (i + 1)) / n, depth);
    ev.push(...p0, ...p1);
  }
  edges.geometry.dispose();
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(ev, 3));
  edges.geometry = eg;
}
