/**
 * What the simulator core loads on demand for the experimental anatomy (decisions 352 and 353): the shipped volume's
 * loader, the volume heart and its GPU side, in the core's layer, which may import both the anatomy and the renderer. A
 * chunk of its own, so the simulation worker does not carry them while the analytic heart is in use.
 */
export { loadRoderoVolume } from '@/simulator/anatomy/roderoAsset';
export { volumeHeart } from '@/simulator/anatomy/volumeHeart';
export { volumeHeartGpu } from '@/simulator/renderer/gpu/volumeHeartGpu';
