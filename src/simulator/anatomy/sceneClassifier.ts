import { classifyHeart } from '@/simulator/anatomy/heartModel';
import { classifyThorax, descAortaScale, isAnteriorLung } from '@/simulator/anatomy/thoraxModel';
import { Structure, Tissue, type TissueSample } from '@/simulator/anatomy/tissue';
import type { HeartModel, HeartPose } from './heartModel';
import type { ThoraxModel } from './thoraxModel';
import type { HeartClassifier } from '@/simulator/renderer/types';

/** Same precedence for imaging and Doppler propagation: anterior lung, heart, surrounding thorax. */
export function sceneClassifier(scene: {
  heart: HeartModel;
  heartPose: HeartPose;
  thorax: ThoraxModel;
  heartClassifier?: HeartClassifier;
}) {
  const { heart, heartPose, thorax, heartClassifier } = scene;
  const hf = heart.frame;
  const daScale = descAortaScale(thorax, heartPose.state.aorticPressure);
  return (px: number, py: number, pz: number, q: TissueSample): number => {
    if (isAnteriorLung(thorax, px, py, pz)) {
      q.tissue = Tissue.Lung;
      q.structure = Structure.Lung;
      q.sdf = -1;
      q.nx = 0;
      q.ny = 0;
      q.nz = 1;
      q.mx = px;
      q.my = py;
      q.mz = pz;
      q.extraReflect = 0;
      q.segment = 0;
      return 1;
    }
    const hx =
      (px - hf.origin.x) * hf.ex.x + (py - hf.origin.y) * hf.ex.y + (pz - hf.origin.z) * hf.ex.z;
    const hy =
      (px - hf.origin.x) * hf.ey.x + (py - hf.origin.y) * hf.ey.y + (pz - hf.origin.z) * hf.ey.z;
    const hz =
      (px - hf.origin.x) * hf.ez.x + (py - hf.origin.y) * hf.ez.y + (pz - hf.origin.z) * hf.ez.z;
    if (
      heartClassifier
        ? heartClassifier(hx, hy, hz, q)
        : classifyHeart(heart, heartPose, hx, hy, hz, q)
    )
      return 2;
    return classifyThorax(thorax, px, py, pz, q, q.sdf, daScale) ? 1 : 0;
  };
}
