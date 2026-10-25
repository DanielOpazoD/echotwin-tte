/**
 * The bound volume heart for the GPU port (decision 353): uploads the volume, its fields and slice tables as textures,
 * sets the geometry, the label map and the constants as uniforms, and each frame's motion from the CPU's
 * `motionParams`. Lives with the volume's code (`core/roderoHeart.ts`), outside the WebGL2 chunk.
 */
import { PERICARDIUM_CM } from '@/simulator/anatomy/classify/pericardium';
import type { HeartPose } from '@/simulator/anatomy/heartModel';
import {
  APEX_SHARE,
  APPARATUS_HOSTS,
  ATRIAL_BAND_CM,
  ATRIAL_TISSUE,
  FAT,
  GPU_SLICE_COLUMNS,
  AORTIC_CUSP_REACH_CM,
  LEFT_HOSTS,
  MITRAL_FADE_CM,
  LABELS,
  ROOT_BLOOD,
  TRUNK_BLOOD,
  LV_BAND_CM,
  LV_FADE_CM,
  RV_DESCENT_FROM_CM,
  RV_DESCENT_TO_CM,
  RV_REACH,
  SECTORS,
  SLICE_CM,
  TWIST_APEX_DEG,
  TWIST_BASE_DEG,
  type VolumeHeart,
} from '@/simulator/anatomy/volumeHeart';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import type { HeartVolumeGpu } from '../types';
import { GLSL_VOLUME_HEART } from './glslVolumeHeart';

let nextKey = 0;

/** A set of labels (< 64) as two 32-bit masks. */
function mask(labels: Iterable<number>): [number, number] {
  let x = 0,
    y = 0;
  for (const l of labels) {
    if (l < 32) x |= 1 << l;
    else if (l < 64) y |= 1 << (l - 32);
  }
  return [x >>> 0, y >>> 0];
}

/** The GPU side of a bound volume heart, moved from `endDiastole` by each frame's pose. */
export function volumeHeartGpu(vh: VolumeHeart, endDiastole: HeartPose): HeartVolumeGpu {
  const key = `volume-heart-${nextKey++}`;
  let tex: { label: WebGLTexture; field: WebGLTexture; slices: WebGLTexture } | null = null;
  const loc = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const u = (gl: WebGL2RenderingContext, prog: WebGLProgram, name: string) => {
    let m = loc.get(prog);
    if (!m) loc.set(prog, (m = new Map<string, WebGLUniformLocation | null>()));
    if (!m.has(name)) m.set(name, gl.getUniformLocation(prog, name));
    return m.get(name)!;
  };
  return {
    key,
    glsl: GLSL_VOLUME_HEART,
    upload(gl) {
      if (tex) return;
      const d = vh.gpu();
      const [nx, ny, nz] = d.dims;
      const make3d = (internal: number, format: number, type: number, data: ArrayBufferView) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, t);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage3D(gl.TEXTURE_3D, 0, internal, nx, ny, nz, 0, format, type, data);
        return t;
      };
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const label = make3d(gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, d.labels);
      const field = make3d(gl.RGBA16F, gl.RGBA, gl.FLOAT, d.fields);
      const slices = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, slices);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        GPU_SLICE_COLUMNS,
        d.nSlices,
        0,
        gl.RED,
        gl.FLOAT,
        d.slices,
      );
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      tex = { label, field, slices };
    },
    bind(gl, prog, firstUnit) {
      if (!tex) this.upload(gl);
      const t = tex!;
      const d = vh.gpu();
      const units: [string, number, WebGLTexture][] = [
        ['uVolLabel', gl.TEXTURE_3D, t.label],
        ['uVolField', gl.TEXTURE_3D, t.field],
        ['uVolSlices', gl.TEXTURE_2D, t.slices],
      ];
      units.forEach(([name, target, texture], i) => {
        gl.activeTexture(gl.TEXTURE0 + firstUnit + i);
        gl.bindTexture(target, texture);
        gl.uniform1i(u(gl, prog, name), firstUnit + i);
      });
      // labels 0–63: tissue and structure (tissue −1 where the label is not heart)
      const map = new Int32Array(128).fill(-1);
      for (let l = 0; l < 64; l++) {
        const ts = LABELS[l];
        if (ts) {
          map[2 * l] = ts[0];
          map[2 * l + 1] = ts[1];
        }
      }
      gl.uniform2iv(u(gl, prog, 'uVolMap'), map);
      gl.uniform2i(u(gl, prog, 'uVolFat'), Tissue.Fat, Structure.EpicardialFat);
      gl.uniform1i(u(gl, prog, 'uVolFatLabel'), FAT);
      gl.uniform2ui(u(gl, prog, 'uVolHosts'), ...mask(APPARATUS_HOSTS));
      gl.uniform2ui(u(gl, prog, 'uVolLeftHosts'), ...mask(LEFT_HOSTS));
      gl.uniform2f(u(gl, prog, 'uVolMvFade'), MITRAL_FADE_CM[0], MITRAL_FADE_CM[1]);
      gl.uniform2ui(u(gl, prog, 'uVolLeftAtrium'), ...mask(ATRIAL_TISSUE[0]!));
      gl.uniform2ui(u(gl, prog, 'uVolRightAtrium'), ...mask(ATRIAL_TISSUE[1]!));
      gl.uniform3i(u(gl, prog, 'uVolDims'), d.dims[0], d.dims[1], d.dims[2]);
      gl.uniform3fv(u(gl, prog, 'uVolGridO'), d.gridOrigin);
      gl.uniform1f(u(gl, prog, 'uVolVox'), d.voxelMm);
      gl.uniform3fv(u(gl, prog, 'uVolMO'), d.mesh.o);
      gl.uniform3fv(u(gl, prog, 'uVolMX'), d.mesh.ex);
      gl.uniform3fv(u(gl, prog, 'uVolMY'), d.mesh.ey);
      gl.uniform3fv(u(gl, prog, 'uVolMZ'), d.mesh.ez);
      gl.uniform1f(u(gl, prog, 'uVolFar'), d.mesh.far);
      gl.uniform3fv(u(gl, prog, 'uVolFO'), d.frame.origin);
      gl.uniform3fv(u(gl, prog, 'uVolFX'), d.frame.ex);
      gl.uniform3fv(u(gl, prog, 'uVolFY'), d.frame.ey);
      gl.uniform3fv(u(gl, prog, 'uVolFZ'), d.frame.ez);
      gl.uniform1f(u(gl, prog, 'uVolK'), d.k);
      gl.uniform1f(u(gl, prog, 'uVolL'), d.lvLength);
      gl.uniform2f(u(gl, prog, 'uVolApicalRamp'), d.apicalRamp[0], d.apicalRamp[1]);
      gl.uniform1f(u(gl, prog, 'uVolHand'), d.hand);
      gl.uniform1i(u(gl, prog, 'uVolNSlices'), d.nSlices);
      gl.uniform1i(u(gl, prog, 'uVolSectors'), SECTORS);
      gl.uniform1f(u(gl, prog, 'uVolSliceCm'), SLICE_CM);
      gl.uniform4fv(u(gl, prog, 'uVolAtria'), d.atria);
      gl.uniform1f(u(gl, prog, 'uVolPeri'), PERICARDIUM_CM);
      gl.uniform4f(
        u(gl, prog, 'uVolTwistProfile'),
        TWIST_BASE_DEG,
        TWIST_APEX_DEG,
        LV_FADE_CM,
        APEX_SHARE,
      );
      gl.uniform4f(
        u(gl, prog, 'uVolRvShape'),
        RV_DESCENT_FROM_CM,
        RV_DESCENT_TO_CM,
        RV_REACH[0],
        RV_REACH[1],
      );
      gl.uniform4f(
        u(gl, prog, 'uVolBand'),
        LV_BAND_CM[0],
        LV_BAND_CM[1],
        ATRIAL_BAND_CM[0],
        ATRIAL_BAND_CM[1],
      );
    },
    frame(gl, prog, pose) {
      const m = vh.motionParams(pose, endDiastole);
      gl.uniform1i(u(gl, prog, 'uVolMotion'), 1);
      gl.uniform1i(u(gl, prog, 'uVolApparatus'), 1);
      gl.uniform1f(u(gl, prog, 'uVolSL'), m.sL);
      gl.uniform1f(u(gl, prog, 'uVolSR'), m.sR);
      gl.uniform1f(u(gl, prog, 'uVolCapLambda'), m.capLambda);
      gl.uniform1f(u(gl, prog, 'uVolAlpha'), m.alpha);
      gl.uniform1f(u(gl, prog, 'uVolTwist'), m.twist);
      gl.uniform1f(u(gl, prog, 'uVolRoof'), m.roof);
      gl.uniform1f(u(gl, prog, 'uVolRvRatio'), m.rvRatio);
      gl.uniform2f(u(gl, prog, 'uVolAtrialScale'), m.atrialScales[0] ?? 1, m.atrialScales[1] ?? 1);
      // the analytic cusps over the CT's annulus (decision 373)
      const w = vh.aorticWarp(pose);
      gl.uniform1i(u(gl, prog, 'uVolAoLabel'), w ? ROOT_BLOOD : -1);
      if (w) {
        gl.uniform3f(u(gl, prog, 'uVolAoC'), w.centre[0], w.centre[1], w.centre[2]);
        gl.uniform3f(u(gl, prog, 'uVolAoN'), w.axis[0], w.axis[1], w.axis[2]);
        gl.uniform3f(u(gl, prog, 'uVolAoO'), w.o[0], w.o[1], w.o[2]);
        gl.uniformMatrix3fv(u(gl, prog, 'uVolAoM'), true, w.m);
        gl.uniform2f(u(gl, prog, 'uVolAoReach'), AORTIC_CUSP_REACH_CM[0], AORTIC_CUSP_REACH_CM[1]);
      }
      // the analytic pulmonary cusps over the CT's pulmonary valve plane (decision 375)
      const pw = vh.pulmonaryWarp(pose);
      gl.uniform1i(u(gl, prog, 'uVolPvLabel'), pw ? TRUNK_BLOOD : -1);
      if (pw) {
        gl.uniform3f(u(gl, prog, 'uVolPvC'), pw.centre[0], pw.centre[1], pw.centre[2]);
        gl.uniform3f(u(gl, prog, 'uVolPvN'), pw.axis[0], pw.axis[1], pw.axis[2]);
        gl.uniform3f(u(gl, prog, 'uVolPvO'), pw.o[0], pw.o[1], pw.o[2]);
        gl.uniformMatrix3fv(u(gl, prog, 'uVolPvM'), true, pw.m);
      }
      // the mitral leaflets carried onto the CT's annulus (decision 374)
      const mw = vh.mitralWarp(pose);
      gl.uniform1i(u(gl, prog, 'uVolMvOn'), mw ? 1 : 0);
      if (mw) {
        gl.uniform4fv(u(gl, prog, 'uVolMv'), Float32Array.from(mw.sectors));
        gl.uniform4f(u(gl, prog, 'uVolMvC'), ...mw.centre);
      }
    },
  };
}
