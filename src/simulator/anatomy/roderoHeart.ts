/**
 * What the simulator core loads on demand for the experimental anatomy (decisions 352 and 353): the shipped volume's
 * loader, the volume heart and its GPU side. A chunk of its own, so the simulation worker does not carry either while the analytic heart is in use.
 */
export { loadRoderoVolume } from './roderoAsset';
export { volumeHeart } from './volumeHeart';
export { volumeHeartGpu } from '@/simulator/renderer/gpu/volumeHeartGpu';
