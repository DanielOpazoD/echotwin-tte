/**
 * The voxelised mean heart (rodero-voxelize.ts) read from `ANATOMY2_OUT`, outside the repository, as the CPU tracer's
 * heart (decision 346, `src/simulator/anatomy/volumeHeart.ts`). One volume per folder and one alignment per heart model.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HeartModel, HeartPose } from '@/simulator/anatomy/heartModel';
import {
  volumeHeart,
  type LabelVolume,
  type LabelVolumeHeader,
  type VolumeHeart,
} from '@/simulator/anatomy/volumeHeart';

const volumes = new Map<string, LabelVolume>();
const hearts = new WeakMap<HeartModel, Map<string, VolumeHeart>>();

export function loadVolumeHeart(
  dir: string,
  heart: HeartModel,
  endDiastole: HeartPose,
): VolumeHeart {
  const cached = hearts.get(heart)?.get(dir);
  if (cached) return cached;
  const vol = volumes.get(dir) ?? {
    header: JSON.parse(
      readFileSync(join(dir, 'rodero-mean-labels.json'), 'utf8'),
    ) as LabelVolumeHeader,
    labels: new Uint8Array(readFileSync(join(dir, 'rodero-mean-labels.bin'))),
  };
  volumes.set(dir, vol);
  const v = volumeHeart(vol, heart, endDiastole);
  hearts.set(heart, (hearts.get(heart) ?? new Map<string, VolumeHeart>()).set(dir, v));
  return v;
}
