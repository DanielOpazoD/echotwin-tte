import type { BeamFrame } from '@/simulator/probe/pose';
import type { PolarFrame, PolarFrameSpec, RendererBackend, Scene } from '../types';
import { TISSUE_PROPS } from '@/simulator/anatomy/tissue';
import { noiseLattice } from '@/core/noise';
import { GLSL_COMMON } from './glslCommon';
import { GLSL_HEART } from './glslHeart';
import { GLSL_THORAX } from './glslThorax';
import { GLSL_PASS_A_MAIN, GLSL_PASS_B_MAIN, GLSL_PASS_C_MAIN, GLSL_PASS_D_MAIN, GLSL_VERT } from './glslPasses';
import { allocPacked, packScene, PARAM_TEXELS, type PackedScene } from './paramLayout';
import { buildPsfKernels, LATERAL_TAPS, MAX_LATERAL_RADIUS, psfKey, type PsfKernels } from '../acoustic/psf';

/**
 * WebGL2 procedural renderer: the same scanline model and image formation as ProceduralSliceRenderer,
 * evaluated in four fragment passes — classification and local acoustics in parallel (A), per-line
 * transmission march into a complex signal (B), axial PSF (C), lateral PSF and envelope (D) — and read back
 * into the CPU PolarFrame so console, scan conversion, Doppler masks and view analysis are untouched.
 * Deterministic given the same lattices (uploaded as a 3D texture), parameters and PSF kernel table.
 * Requires WebGL2 with EXT_color_buffer_float; `createWebgl2Renderer` returns null otherwise.
 */
export class Webgl2Renderer implements RendererBackend {
  readonly id = 'webgl2-procedural' as const;
  private gl: WebGL2RenderingContext;
  private progA: WebGLProgram;
  private progB: WebGLProgram;
  private progC: WebGLProgram;
  private progD: WebGLProgram;
  private paramsTex: WebGLTexture;
  private noiseTex: WebGLTexture;
  private psfTex: WebGLTexture;
  private psfKeyUploaded = '';
  private noiseSeed = NaN;
  /** Pass A on the central plane: σ/attenuation (0), ids (1), specular/phasor (2). */
  private texA0: WebGLTexture | null = null;
  private texA1: WebGLTexture | null = null;
  private texA2: WebGLTexture | null = null;
  /** Pass A on the side elevation planes (slice thickness) and a scratch id target for those passes. */
  private texS0: WebGLTexture | null = null;
  private texS1: WebGLTexture | null = null;
  private texSC0: WebGLTexture | null = null;
  private texSC1: WebGLTexture | null = null;
  private texSIds: WebGLTexture | null = null;
  /** Pass B complex signal and ids; pass C axial; pass D envelope. */
  private texB0: WebGLTexture | null = null;
  private texB1: WebGLTexture | null = null;
  private texC0: WebGLTexture | null = null;
  private texD0: WebGLTexture | null = null;
  private fbA: WebGLFramebuffer | null = null;
  private fbS0: WebGLFramebuffer | null = null;
  private fbS1: WebGLFramebuffer | null = null;
  private fbB: WebGLFramebuffer | null = null;
  private fbC: WebGLFramebuffer | null = null;
  private fbD: WebGLFramebuffer | null = null;
  private fbW = 0;
  private fbH = 0;
  private packed: PackedScene = allocPacked();
  private readAmp = new Float32Array(0);
  private readIds = new Uint8Array(0);
  private lastMs = 0;
  private uElevK: WebGLUniformLocation | null;
  private vao: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('EXT_color_buffer_float unavailable');
    const common = `#version 300 es\n${GLSL_COMMON}`;
    this.progA = buildProgram(gl, GLSL_VERT, `${common}${GLSL_HEART}${GLSL_THORAX}${GLSL_PASS_A_MAIN}`);
    this.progB = buildProgram(gl, GLSL_VERT, `${common}${GLSL_PASS_B_MAIN}`);
    this.progC = buildProgram(gl, GLSL_VERT, `${common}${GLSL_PASS_C_MAIN}`);
    this.progD = buildProgram(gl, GLSL_VERT, `${common}${GLSL_PASS_D_MAIN}`);
    this.vao = gl.createVertexArray()!;
    this.paramsTex = makeTexture2D(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, PARAM_TEXELS, 1, 0, gl.RGBA, gl.FLOAT, null);
    this.noiseTex = gl.createTexture()!;
    this.psfTex = makeTexture2D(gl);
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
    gl.uniform4fv(gl.getUniformLocation(this.progA, 'uTissue'), tp);
    for (const prog of [this.progA, this.progB, this.progC, this.progD]) {
      gl.useProgram(prog);
      gl.uniform1i(gl.getUniformLocation(prog, 'uParams'), 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'uNoise'), 1);
    }
    gl.useProgram(this.progB);
    const unitsB: [string, number][] = [
      ['uPassA', 2],
      ['uPassB', 3],
      ['uSideA', 4],
      ['uSideB', 5],
      ['uPassC', 6],
      ['uSideCA', 7],
      ['uSideCB', 8],
    ];
    for (const [name, unit] of unitsB) gl.uniform1i(gl.getUniformLocation(this.progB, name), unit);
    gl.useProgram(this.progC);
    gl.uniform1i(gl.getUniformLocation(this.progC, 'uSig'), 2);
    gl.uniform1i(gl.getUniformLocation(this.progC, 'uPsf'), 3);
    gl.useProgram(this.progD);
    gl.uniform1i(gl.getUniformLocation(this.progD, 'uAx'), 2);
    gl.uniform1i(gl.getUniformLocation(this.progD, 'uPsf'), 3);
  }

  stats(): Record<string, number | string> {
    return { renderMs: Number(this.lastMs.toFixed(2)), gpu: 'webgl2' };
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of [this.progA, this.progB, this.progC, this.progD]) gl.deleteProgram(p);
    gl.deleteTexture(this.paramsTex);
    gl.deleteTexture(this.noiseTex);
    gl.deleteTexture(this.psfTex);
    this.disposeTargets();
  }

  private disposeTargets(): void {
    const gl = this.gl;
    for (const t of [this.texA0, this.texA1, this.texA2, this.texS0, this.texS1, this.texSC0, this.texSC1, this.texSIds, this.texB0, this.texB1, this.texC0, this.texD0]) if (t) gl.deleteTexture(t);
    for (const f of [this.fbA, this.fbS0, this.fbS1, this.fbB, this.fbC, this.fbD]) if (f) gl.deleteFramebuffer(f);
    this.texA0 = this.texA1 = this.texA2 = this.texS0 = this.texS1 = this.texSC0 = this.texSC1 = this.texSIds = null;
    this.texB0 = this.texB1 = this.texC0 = this.texD0 = null;
    this.fbA = this.fbS0 = this.fbS1 = this.fbB = this.fbC = this.fbD = null;
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

  /** Upload the PSF kernel table: row 0 axial taps, row 1 + sample lateral taps, centred on MAX_LATERAL_RADIUS; radius in .g of the centre. */
  private ensurePsf(scene: Scene, spec: PolarFrameSpec): void {
    const { frequencyMHz, harmonics } = scene.physics;
    const bw = scene.physics.beamWidth ?? 0;
    const key = psfKey(spec, frequencyMHz, harmonics, bw);
    if (this.psfKeyUploaded === key) return;
    const k: PsfKernels = buildPsfKernels(spec, frequencyMHz, harmonics, bw);
    const rows = spec.samples + 1;
    const data = new Float32Array(LATERAL_TAPS * rows * 4);
    const c = MAX_LATERAL_RADIUS;
    for (let j = -k.axialRadius; j <= k.axialRadius; j++) data[(c + j) * 4] = k.axial[j + k.axialRadius]!;
    data[c * 4 + 1] = k.axialRadius;
    for (let si = 0; si < spec.samples; si++) {
      const row = (si + 1) * LATERAL_TAPS;
      for (let t = 0; t < LATERAL_TAPS; t++) data[(row + t) * 4] = k.lateral[si * LATERAL_TAPS + t]!;
      data[(row + c) * 4 + 1] = k.lateralRadius[si]!;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.psfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LATERAL_TAPS, rows, 0, gl.RGBA, gl.FLOAT, data);
    this.psfKeyUploaded = key;
  }

  private ensureTargets(w: number, h: number): void {
    if (this.fbW === w && this.fbH === h && this.fbA) return;
    this.disposeTargets();
    const gl = this.gl;
    const mk = (internal: number, format: number, type: number): WebGLTexture => {
      const t = makeTexture2D(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      return t;
    };
    const mkFb = (...targets: WebGLTexture[]): WebGLFramebuffer => {
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      const attachments = targets.map((t, i) => {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
        return gl.COLOR_ATTACHMENT0 + i;
      });
      gl.drawBuffers(attachments);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: ${status}`);
      return fb;
    };
    const f32 = (): WebGLTexture => mk(gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.texA0 = f32();
    this.texA1 = mk(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texA2 = f32();
    this.texS0 = f32();
    this.texS1 = f32();
    this.texSC0 = f32();
    this.texSC1 = f32();
    this.texSIds = mk(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texB0 = f32();
    this.texB1 = mk(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texC0 = f32();
    this.texD0 = f32();
    this.fbA = mkFb(this.texA0, this.texA1, this.texA2);
    this.fbS0 = mkFb(this.texS0, this.texSIds, this.texSC0);
    this.fbS1 = mkFb(this.texS1, this.texSIds, this.texSC1);
    this.fbB = mkFb(this.texB0, this.texB1);
    this.fbC = mkFb(this.texC0);
    this.fbD = mkFb(this.texD0);
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
    this.ensurePsf(scene, spec);
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
    // central plane whose ids, attenuation, phasor and lung entry are the ones kept
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
    // pass B: transmission march → complex signal
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
    gl.useProgram(this.progB);
    const bindAt = (unit: number, tex: WebGLTexture | null): void => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    };
    bindAt(2, this.texA0);
    bindAt(3, this.texA1);
    bindAt(4, this.texS0);
    bindAt(5, this.texS1);
    bindAt(6, this.texA2);
    bindAt(7, this.texSC0);
    bindAt(8, this.texSC1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // pass C: axial PSF
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbC);
    gl.useProgram(this.progC);
    bindAt(2, this.texB0);
    bindAt(3, this.psfTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // pass D: lateral PSF and envelope
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbD);
    gl.useProgram(this.progD);
    bindAt(2, this.texC0);
    bindAt(3, this.psfTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // read back: amplitude + transmission from D, ids from B
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, this.readAmp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.readIds);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let u = 2; u <= 8; u++) bindAt(u, null);
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

function makeTexture2D(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
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

/** Renderer string of a WebGL context, unmasked when the browser exposes it. */
export function webglRendererName(gl: WebGL2RenderingContext): string {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
  const name: unknown = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return typeof name === 'string' ? name : '';
}

/** Software rasterisers behind WebGL (Chromium without GPU, virtual machines, remote desktops, Playwright). */
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * Create the GPU renderer on an OffscreenCanvas (worker) or a canvas element (main thread).
 * Returns null when WebGL2 or float render targets are unavailable, and also on software WebGL unless
 * `allowSoftware` is set: a software rasteriser compiles the classifier in 20–60 s and needs hundreds of
 * milliseconds per frame, so the CPU tracer is faster there (decision 53). The reason is reported.
 */
export function createWebgl2Renderer(canvas?: OffscreenCanvas | HTMLCanvasElement, options: { allowSoftware?: boolean } = {}): { renderer: Webgl2Renderer | null; reason: string } {
  try {
    const c = canvas ?? (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : typeof document !== 'undefined' ? document.createElement('canvas') : null);
    if (!c) return { renderer: null, reason: 'no canvas available' };
    const gl = c.getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: false }) as WebGL2RenderingContext | null;
    if (!gl) return { renderer: null, reason: 'WebGL2 unavailable' };
    const name = webglRendererName(gl);
    if (!options.allowSoftware && SOFTWARE_GL.test(name)) {
      (gl.getExtension('WEBGL_lose_context') as { loseContext: () => void } | null)?.loseContext();
      return { renderer: null, reason: `software WebGL (${name.slice(0, 60)}): CPU tracer` };
    }
    return { renderer: new Webgl2Renderer(gl), reason: 'ok' };
  } catch (e) {
    return { renderer: null, reason: e instanceof Error ? e.message : String(e) };
  }
}
