import type { BeamFrame } from '@/simulator/probe/pose';
import type { PolarFrame, PolarFrameSpec, RendererBackend, Scene } from '../types';
import { TISSUE_PROPS } from '@/simulator/anatomy/tissue';
import { noiseLattice } from '@/core/noise';
import { GLSL_COMMON } from './glslCommon';
import { GLSL_HEART } from './glslHeart';
import { GLSL_THORAX } from './glslThorax';
import { GLSL_PASS_A_MAIN, GLSL_PASS_B_MAIN, GLSL_VERT } from './glslPasses';
import { allocPacked, packScene, PARAM_TEXELS, type PackedScene } from './paramLayout';

/**
 * WebGL2 procedural renderer: the same scanline model as ProceduralSliceRenderer, evaluated in two
 * fragment passes (classification + local echo in parallel, then per-line attenuation march) and
 * read back into the CPU PolarFrame so console, scan conversion, Doppler masks and view analysis
 * are untouched. Deterministic given the same lattices (uploaded as a 3D texture) and parameters.
 * Requires WebGL2 with EXT_color_buffer_float; `createWebgl2Renderer` returns null otherwise.
 */
export class Webgl2Renderer implements RendererBackend {
  readonly id = 'webgl2-procedural' as const;
  private gl: WebGL2RenderingContext;
  private progA: WebGLProgram;
  private progB: WebGLProgram;
  private paramsTex: WebGLTexture;
  private noiseTex: WebGLTexture;
  private noiseSeed = NaN;
  private texA0: WebGLTexture | null = null;
  private texA1: WebGLTexture | null = null;
  private texB0: WebGLTexture | null = null;
  private texB1: WebGLTexture | null = null;
  /** Side elevation planes of pass A (slice thickness) and a scratch id target for those passes. */
  private texS0: WebGLTexture | null = null;
  private texS1: WebGLTexture | null = null;
  private texSIds: WebGLTexture | null = null;
  private fbA: WebGLFramebuffer | null = null;
  private fbB: WebGLFramebuffer | null = null;
  private fbS0: WebGLFramebuffer | null = null;
  private fbS1: WebGLFramebuffer | null = null;
  private fbW = 0;
  private fbH = 0;
  private packed: PackedScene = allocPacked();
  private readAmp = new Float32Array(0);
  private readIds = new Uint8Array(0);
  private lastMs = 0;
  private uTissueA: WebGLUniformLocation | null;
  private uElevK: WebGLUniformLocation | null;
  private vao: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('EXT_color_buffer_float unavailable');
    const common = `#version 300 es\n${GLSL_COMMON}${GLSL_HEART}${GLSL_THORAX}`;
    this.progA = buildProgram(gl, GLSL_VERT, common + GLSL_PASS_A_MAIN);
    this.progB = buildProgram(gl, GLSL_VERT, `#version 300 es\n${GLSL_COMMON}${GLSL_PASS_B_MAIN}`);
    this.vao = gl.createVertexArray()!;
    this.paramsTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.paramsTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, PARAM_TEXELS, 1, 0, gl.RGBA, gl.FLOAT, null);
    this.noiseTex = gl.createTexture()!;
    this.uTissueA = gl.getUniformLocation(this.progA, 'uTissue');
    this.uElevK = gl.getUniformLocation(this.progA, 'uElevK');
    gl.useProgram(this.progA);
    const tp = new Float32Array(20 * 4);
    for (let t = 0; t < 20; t++) {
      const p = TISSUE_PROPS[t];
      if (!p) continue;
      tp[t * 4] = p.reflect;
      tp[t * 4 + 1] = p.specular;
      tp[t * 4 + 2] = p.attenuation;
      tp[t * 4 + 3] = p.grain;
    }
    gl.uniform4fv(this.uTissueA, tp);
    gl.uniform1i(gl.getUniformLocation(this.progA, 'uParams'), 0);
    gl.uniform1i(gl.getUniformLocation(this.progA, 'uNoise'), 1);
    gl.useProgram(this.progB);
    gl.uniform1i(gl.getUniformLocation(this.progB, 'uParams'), 0);
    gl.uniform1i(gl.getUniformLocation(this.progB, 'uNoise'), 1);
    gl.uniform1i(gl.getUniformLocation(this.progB, 'uPassA'), 2);
    gl.uniform1i(gl.getUniformLocation(this.progB, 'uPassB'), 3);
    gl.uniform1i(gl.getUniformLocation(this.progB, 'uSideA'), 4);
    gl.uniform1i(gl.getUniformLocation(this.progB, 'uSideB'), 5);
  }

  stats(): Record<string, number | string> {
    return { renderMs: Number(this.lastMs.toFixed(2)), gpu: 'webgl2' };
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.progA);
    gl.deleteProgram(this.progB);
    gl.deleteTexture(this.paramsTex);
    gl.deleteTexture(this.noiseTex);
    this.disposeTargets();
  }

  private disposeTargets(): void {
    const gl = this.gl;
    for (const t of [this.texA0, this.texA1, this.texB0, this.texB1, this.texS0, this.texS1, this.texSIds]) if (t) gl.deleteTexture(t);
    for (const f of [this.fbA, this.fbB, this.fbS0, this.fbS1]) if (f) gl.deleteFramebuffer(f);
    this.texA0 = this.texA1 = this.texB0 = this.texB1 = this.texS0 = this.texS1 = this.texSIds = null;
    this.fbA = this.fbB = this.fbS0 = this.fbS1 = null;
  }

  private ensureNoise(seed: number): void {
    if (this.noiseSeed === seed) return;
    const gl = this.gl;
    const a = noiseLattice(seed),
      b = noiseLattice(seed ^ 0x2545f491),
      c = noiseLattice(seed ^ 0x51),
      w = noiseLattice(seed ^ 0x5157);
    const n = 128 * 128 * 128;
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      data[i * 4] = a[i]!;
      data[i * 4 + 1] = b[i]!;
      data[i * 4 + 2] = c[i]!;
      data[i * 4 + 3] = w[i]!;
    }
    gl.bindTexture(gl.TEXTURE_3D, this.noiseTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 128, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    this.noiseSeed = seed;
  }

  private ensureTargets(w: number, h: number): void {
    if (this.fbW === w && this.fbH === h && this.fbA) return;
    this.disposeTargets();
    const gl = this.gl;
    const mk = (internal: number, format: number, type: number): WebGLTexture => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      return t;
    };
    this.texA0 = mk(gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.texA1 = mk(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texB0 = mk(gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.texB1 = mk(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    const mkFb = (t0: WebGLTexture, t1: WebGLTexture): WebGLFramebuffer => {
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t1, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: ${status}`);
      return fb;
    };
    this.texS0 = mk(gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.texS1 = mk(gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.texSIds = mk(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.fbA = mkFb(this.texA0, this.texA1);
    this.fbB = mkFb(this.texB0, this.texB1);
    this.fbS0 = mkFb(this.texS0, this.texSIds);
    this.fbS1 = mkFb(this.texS1, this.texSIds);
    this.fbW = w;
    this.fbH = h;
    this.readAmp = new Float32Array(w * h * 4);
    this.readIds = new Uint8Array(w * h * 4);
  }

  render(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec, _phase: number, out: PolarFrame): void {
    const t0 = performance.now();
    const gl = this.gl;
    const w = spec.samples,
      h = spec.lines;
    this.ensureNoise(scene.physics.seed);
    this.ensureTargets(w, h);
    packScene(scene, beam, spec, this.packed);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paramsTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PARAM_TEXELS, 1, gl.RGBA, gl.FLOAT, this.packed.data);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.noiseTex);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    // pass A: the side elevation planes first (slice thickness, high tier; one classifier call per shader,
    // because a shader with two inlined copies of the classifier silently fails under SwiftShader), then the
    // central plane whose ids, attenuation and lung entry are the ones kept
    gl.useProgram(this.progA);
    if (spec.elevationSamples > 1) {
      gl.uniform1f(this.uElevK, -1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbS0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.uniform1f(this.uElevK, 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbS1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.uniform1f(this.uElevK, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // pass B
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
    gl.useProgram(this.progB);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texA0);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.texA1);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.texS0);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.texS1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // read back
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, this.readAmp);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.readIds);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const n = w * h;
    const amp = out.amplitude,
      tr = out.transmission,
      st = out.structure,
      ti = out.tissue;
    const ra = this.readAmp,
      ri = this.readIds;
    for (let i = 0; i < n; i++) {
      amp[i] = ra[i * 4]!;
      tr[i] = ra[i * 4 + 1]!;
      st[i] = ri[i * 4]!;
      ti[i] = ri[i * 4 + 1]!;
    }
    this.lastMs = performance.now() - t0;
  }
}

function buildProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) ?? '';
      gl.deleteShader(sh);
      throw new Error(`shader compile error: ${log}`);
    }
    return sh;
  };
  const v = compile(gl.VERTEX_SHADER, vs);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? '';
    gl.deleteProgram(prog);
    throw new Error(`program link error: ${log}`);
  }
  return prog;
}

/**
 * Create the GPU renderer on an OffscreenCanvas (worker) or a canvas element (main thread).
 * Returns null when WebGL2 or float render targets are unavailable; the reason is reported.
 */
export function createWebgl2Renderer(canvas?: OffscreenCanvas | HTMLCanvasElement): { renderer: Webgl2Renderer | null; reason: string } {
  try {
    const c = canvas ?? (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : typeof document !== 'undefined' ? document.createElement('canvas') : null);
    if (!c) return { renderer: null, reason: 'no canvas available' };
    const gl = c.getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: false }) as WebGL2RenderingContext | null;
    if (!gl) return { renderer: null, reason: 'WebGL2 unavailable' };
    return { renderer: new Webgl2Renderer(gl), reason: 'ok' };
  } catch (e) {
    return { renderer: null, reason: e instanceof Error ? e.message : String(e) };
  }
}
