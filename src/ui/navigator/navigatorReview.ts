import * as THREE from 'three';
import { groupLabel, markerLabel, type ReviewMarker } from '@/app/review';
import { textSprite } from './navigatorBody';

/**
 * The review markers on the 3D navigator (decision 135): a sphere and a label per marker put on the model, a small
 * diamond per marker put on the image once the worker has placed it in the torso, and a line from each secondary to its
 * primary. Rebuilt when the markers or the selection change.
 */
export interface ReviewMarkerLayer {
  readonly group: THREE.Group;
  /** Rebuilds the markers if `markers` or `selected` differ from those shown. */
  sync: (markers: ReviewMarker[], selected: string | null) => void;
}

export function createReviewMarkers(scene: THREE.Scene): ReviewMarkerLayer {
  const group = new THREE.Group();
  scene.add(group);
  let shown: ReviewMarker[] | null = null;
  let selectedShown: string | null = null;
  const rebuild = (markers: ReviewMarker[], selected: string | null) => {
    for (const o of group.children) {
      const mesh = o as THREE.Mesh | THREE.Sprite;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material & { map?: THREE.Texture | null };
      mat.map?.dispose();
      mat.dispose();
    }
    group.clear();
    const pos = (mk: ReviewMarker) => (mk.space === 'model' ? mk.torso : (mk.point?.torso ?? null));
    for (const mk of markers) {
      const at = pos(mk);
      if (!at) continue;
      const on = mk.id === selected;
      const color = on ? 0xffffff : 0xff6ad5;
      const size = mk.parentId ? 0.7 : 1;
      const ball = new THREE.Mesh(
        mk.space === 'model'
          ? new THREE.SphereGeometry((on ? 0.5 : 0.35) * size, 16, 12)
          : new THREE.OctahedronGeometry((on ? 0.42 : 0.3) * size),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        }),
      );
      ball.position.set(at.x, at.y, at.z);
      ball.renderOrder = 30;
      group.add(ball);
      const label = markerLabel(mk, markers);
      const tag = textSprite(
        mk.space === 'model' ? `${label} · ${groupLabel(mk.group)}` : label,
        color,
      );
      tag.position.set(at.x, at.y + 1.1, at.z + 0.6);
      tag.renderOrder = 31;
      group.add(tag);
      if (mk.parentId) {
        const parent = markers.find((x) => x.id === mk.parentId);
        const from = parent ? pos(parent) : null;
        if (from) {
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(from.x, from.y, from.z),
              new THREE.Vector3(at.x, at.y, at.z),
            ]),
            new THREE.LineBasicMaterial({
              color: 0xff6ad5,
              transparent: true,
              opacity: 0.8,
              depthTest: false,
            }),
          );
          line.renderOrder = 29;
          group.add(line);
        }
      }
    }
  };
  return {
    group,
    sync: (markers, selected) => {
      if (markers === shown && selected === selectedShown) return;
      rebuild(markers, selected);
      shown = markers;
      selectedShown = selected;
    },
  };
}
