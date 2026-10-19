/**
 * What the simulator core loads on demand for the experimental anatomy (decision 352): the shipped volume's loader and
 * the volume heart. A chunk of its own, so the simulation worker does not carry either while the analytic heart is in use.
 */
export { loadRoderoVolume } from './roderoAsset';
export { volumeHeart } from './volumeHeart';
