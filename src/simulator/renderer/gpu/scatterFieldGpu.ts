/**
 * An image formation with point scatterers for the GPU port (decision 354): pass A's GLSL of the scatterers, the
 * formation's kernels for the PSF table and its number of looks, and each frame's wavenumber and seed as uniforms. Lives
 * with the formation's code (`core/coleImage.ts`), outside the WebGL2 chunk.
 */
import { ELEVATION_SIGMA_PER_HALF_WIDTH } from '../acoustic/acoustics';
import {
  ELEVATION_REACH_SIGMAS,
  SCATTERER_CELL_CM,
  STRONG_SCATTERER_FRACTION,
  STRONG_SCATTERER_GAIN,
} from '../acoustic/scatterers';
import type { ImageFormation, ScatterFieldGpu } from '../types';
import { GLSL_SCATTERERS } from './glslScatterers';

/** The GPU side of a formation that brings scatterers and kernels. */
export function scatterFieldGpu(formation: ImageFormation, key: string): ScatterFieldGpu {
  const { scatterers, kernels } = formation;
  if (!scatterers || !kernels)
    throw new Error('scatterFieldGpu: the formation brings no scatterers or kernels');
  const loc = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const u = (gl: WebGL2RenderingContext, prog: WebGLProgram, name: string) => {
    let m = loc.get(prog);
    if (!m) loc.set(prog, (m = new Map<string, WebGLUniformLocation | null>()));
    if (!m.has(name)) m.set(name, gl.getUniformLocation(prog, name));
    return m.get(name)!;
  };
  return {
    key,
    glsl: GLSL_SCATTERERS,
    looks: formation.looks,
    kernels,
    frame(gl, prog, physics) {
      gl.uniform1f(
        u(gl, prog, 'uScatK'),
        scatterers.wavenumber(physics.frequencyMHz, physics.harmonics),
      );
      gl.uniform1ui(u(gl, prog, 'uScatSeed'), physics.seed >>> 0);
      gl.uniform1f(u(gl, prog, 'uScatCell'), SCATTERER_CELL_CM);
      gl.uniform1f(u(gl, prog, 'uScatReach'), ELEVATION_REACH_SIGMAS);
      gl.uniform1f(u(gl, prog, 'uScatElev'), ELEVATION_SIGMA_PER_HALF_WIDTH);
      gl.uniform1f(u(gl, prog, 'uScatStrong'), STRONG_SCATTERER_FRACTION);
      gl.uniform1f(u(gl, prog, 'uScatStrongGain'), STRONG_SCATTERER_GAIN);
    },
  };
}
