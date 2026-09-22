import type { BeamFrame } from '@/simulator/probe/pose';
import type {
  AcquisitionSettings,
  ColorPresentSettings,
  DisplayConsole,
  PolarFrame,
  PolarFrameSpec,
  RenderHints,
  RendererBackend,
  Scene,
} from '../types';
import { TISSUE_PROPS } from '@/simulator/anatomy/tissue';
import { noiseLattice } from '@/core/noise';
import { GLSL_COMMON } from './glslCommon';
import { GLSL_HEART } from './glslHeart';
import { GLSL_THORAX } from './glslThorax';
import {
  GLSL_PASS_A_MAIN,
  GLSL_PASS_B_MAIN,
  GLSL_PASS_C_MAIN,
  GLSL_PASS_L_MAIN,
  GLSL_PASS_P_MAIN,
  GLSL_PASS_D_MAIN,
  GLSL_VERT,
} from './glslPasses';
import { allocPacked, packScene, PARAM_TEXELS, type PackedScene } from './paramLayout';
import {
  buildNoiseKernels,
  buildPsfKernels,
  LATERAL_TAPS,
  MAX_LATERAL_RADIUS,
  psfKey,
  type PsfKernels,
} from '../acoustic/psf';
import {
  GLSL_CONSOLE_FRAG,
  GLSL_NOISE_AXIAL_FRAG,
  GLSL_NOISE_LATERAL_FRAG,
  GLSL_PRESENT_FRAG,
} from './glslImage';
import { consoleCompensation, type ConsoleState } from '../postprocess/consolePipeline';
import { TRANS_DECODE } from '../transmissionCode';
import { packScanLutTexels, type ScanLut } from '../scanConvert';

/** Colour field blended by the present pass: velocity per polar sample (NaN = no colour) and variance. */
export interface PresentColor {
  vel: Float32Array;
  variance: Float32Array;
  /** Changes whenever the field is recomputed, so an unchanged field is not uploaded again. */
  version: number;
  settings: ColorPresentSettings;
}

export interface PresentRequest {
  lut: ScanLut;
  width: number;
  height: number;
  color: PresentColor | null;
  /** Equivalence checks: read the drawn RGBA (top row first) into this array instead of returning an ImageBitmap. */
  readback?: Uint8Array;
}

const CONSOLE_UNIFORMS = [
  'uEnv',
  'uIds',
  'uComp',
  'uHist',
  'uNoise',
  'uSamples',
  'uDynRange',
  'uEdge',
  'uPersist',
  'uGrayMap',
] as const;
const NOISE_AXIAL_UNIFORMS = ['uKernels', 'uSamples', 'uSeed', 'uFrameIndex'] as const;
const NOISE_LATERAL_UNIFORMS = ['uNoiseAx', 'uKernels', 'uLines'] as const;
const PRESENT_UNIFORMS = [
  'uPacked',
  'uLut',
  'uColor',
  'uPolar',
  'uHeightPx',
  'uLines',
  'uSamples',
  'uColorOn',
  'uBox',
  'uColorMap',
] as const;
type Locations<T extends readonly string[]> = Record<T[number], WebGLUniformLocation | null>;
function uniformLocations<T extends readonly string[]>(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  names: T,
): Locations<T> {
  const o: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) o[n] = gl.getUniformLocation(prog, n);
  return o as Locations<T>;
}
/** Texture unit used only to upload data, never sampled. */
const UPLOAD_UNIT = 9;

let noiseKernelMemo: PsfKernels | null = null;
/** The noise response of a frame geometry, rebuilt only when the geometry or the probe settings change. */
function buildNoiseKernelsCached(spec: PolarFrameSpec, settings: AcquisitionSettings): PsfKernels {
  const key = `noise|${psfKey(spec, settings.frequencyMHz, settings.harmonics, 0)}`;
  if (noiseKernelMemo?.key !== key)
    noiseKernelMemo = buildNoiseKernels(spec, settings.frequencyMHz, settings.harmonics);
  return noiseKernelMemo;
}

/**
 * WebGL2 procedural renderer: the same scanline model and image formation as ProceduralSliceRenderer,
 * evaluated in four fragment passes — classification and local acoustics in parallel (A), per-line
 * transmission march into a complex signal (B), axial PSF (C), lateral PSF and envelope (D) — and read back
 * into the CPU PolarFrame (`render`), or continued on the GPU through the console into a packed display that is
 * the only read-back and a present pass that scan-converts it into the canvas (`renderDisplay`, `present`,
 * decision 54). Deterministic given the same lattices (a 3D texture), parameters and PSF kernel table.
 * Requires WebGL2 with EXT_color_buffer_float; `createWebgl2Renderer` returns null otherwise.
 */
export class Webgl2Renderer implements RendererBackend {
  readonly id = 'webgl2-procedural' as const;
  private gl: WebGL2RenderingContext;
  private progA: WebGLProgram;
  private progB: WebGLProgram;
  private progL: WebGLProgram;
  private progP: WebGLProgram;
  private progC: WebGLProgram;
  private progD: WebGLProgram;
  private progConsole: WebGLProgram;
  private progPresent: WebGLProgram;
  /** Receiver noise passes (decision 91): white noise filtered along the beam, then across lines. */
  private progNoiseA: WebGLProgram;
  private progNoiseL: WebGLProgram;
  private una: Locations<typeof NOISE_AXIAL_UNIFORMS>;
  private unl: Locations<typeof NOISE_LATERAL_UNIFORMS>;
  private noiseKernelTex: WebGLTexture;
  private noiseKernelKey = '';
  private uc: Locations<typeof CONSOLE_UNIFORMS>;
  private up: Locations<typeof PRESENT_UNIFORMS>;
  private compTex: WebGLTexture;
  private compKey = '';
  private compData = new Float32Array(0);
  private lutTex: WebGLTexture;
  private lutKeyUploaded = '';
  private lutTexels = new Uint16Array(0);
  private colorTex: WebGLTexture;
  private colorKey = '';
  /** Polar coordinates of every pixel (the LUT's r and theta) for the colour box test, uploaded when colour is shown. */
  private polarTex: WebGLTexture;
  private polarKeyUploaded = '';
  private polarTexels = new Float32Array(0);
  private colorTexels = new Float32Array(0);
  /** Console: history ping-pong (float, before the grey map) and the packed RGBA8 output. */
  private texHist: [WebGLTexture | null, WebGLTexture | null] = [null, null];
  private fbConsole: [WebGLFramebuffer | null, WebGLFramebuffer | null] = [null, null];
  private texPacked: WebGLTexture | null = null;
  private histCurrent: 0 | 1 = 0;
  private histUpload = new Float32Array(0);
  private disposed = false;
  private histValid = false;
  /** True when texPacked holds the display of the last rendered frame (present shows nothing older). */
  private packedFresh = false;
  private readPacked = new Uint8Array(0);
  private probe8 = new Uint8Array(4);
  private lastPresentMs = 0;
  private lastOutput: 'float' | 'display' = 'float';
  private paramsTex: WebGLTexture;
  private noiseTex: WebGLTexture;
  private psfTex: WebGLTexture;
  private psfKeyUploaded = '';
  private noiseSeed = NaN;
  /** Pass A on the central plane: σ/attenuation (0), ids (1), specular/phasor (2). */
  private texA0: WebGLTexture | null = null;
  private texA1: WebGLTexture | null = null;
  private texA2: WebGLTexture | null = null;
  private texA3: WebGLTexture | null = null;
  private texSD: WebGLTexture | null = null;
  /** Pass A on the side elevation planes (slice thickness) and a scratch id target for those passes. */
  private texS0: WebGLTexture | null = null;
  private texS1: WebGLTexture | null = null;
  private texSC0: WebGLTexture | null = null;
  private texSC1: WebGLTexture | null = null;
  private texSIds: WebGLTexture | null = null;
  /** Pass B complex signal and ids; pass C axial; pass D envelope. */
  private texB0: WebGLTexture | null = null;
  private texB1: WebGLTexture | null = null;
  private texB2: WebGLTexture | null = null;
  private texL0: WebGLTexture | null = null;
  private texP0: WebGLTexture | null = null;
  private texC0: WebGLTexture | null = null;
  private texC1: WebGLTexture | null = null;
  private texD0: WebGLTexture | null = null;
  /** Receiver noise after the axial and after the lateral pass (re, 0, im). */
  private texNA: WebGLTexture | null = null;
  private texNL: WebGLTexture | null = null;
  private fbA: WebGLFramebuffer | null = null;
  private fbS0: WebGLFramebuffer | null = null;
  private fbS1: WebGLFramebuffer | null = null;
  private fbB: WebGLFramebuffer | null = null;
  private fbL: WebGLFramebuffer | null = null;
  private fbP: WebGLFramebuffer | null = null;
  private fbC: WebGLFramebuffer | null = null;
  private fbD: WebGLFramebuffer | null = null;
  private fbNA: WebGLFramebuffer | null = null;
  private fbNL: WebGLFramebuffer | null = null;
  private fbW = 0;
  private fbH = 0;
  private packed: PackedScene = allocPacked();
  private readAmp = new Float32Array(0);
  private readIds = new Uint8Array(0);
  private lastMs = 0;
  private lastGpuMs = 0;
  private lastReadMs = 0;
  private probe = new Float32Array(4);
  private uElevK: WebGLUniformLocation | null;
  private vao: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('EXT_color_buffer_float unavailable');
    const common = `#version 300 es\n${GLSL_COMMON}`;
    this.progA = buildProgram(
      gl,
      GLSL_VERT,
      `${common}${GLSL_HEART}${GLSL_THORAX}${GLSL_PASS_A_MAIN}`,
    );
    this.progB = buildProgram(gl, GLSL_VERT, `${common}${GLSL_PASS_B_MAIN}`);
    this.progL = buildProgram(gl, GLSL_VERT, `${common}${GLSL_PASS_L_MAIN}`);
    this.progP = buildProgram(gl, GLSL_VERT, `${common}${GLSL_PASS_P_MAIN}`);
    this.progC = buildProgram(gl, GLSL_VERT, `${common}${GLSL_PASS_C_MAIN}`);
    this.progD = buildProgram(gl, GLSL_VERT, `${common}${GLSL_PASS_D_MAIN}`);
    this.progConsole = buildProgram(gl, GLSL_VERT, GLSL_CONSOLE_FRAG);
    this.progPresent = buildProgram(gl, GLSL_VERT, GLSL_PRESENT_FRAG);
    this.progNoiseA = buildProgram(gl, GLSL_VERT, GLSL_NOISE_AXIAL_FRAG);
    this.progNoiseL = buildProgram(gl, GLSL_VERT, GLSL_NOISE_LATERAL_FRAG);
    this.una = uniformLocations(gl, this.progNoiseA, NOISE_AXIAL_UNIFORMS);
    this.unl = uniformLocations(gl, this.progNoiseL, NOISE_LATERAL_UNIFORMS);
    this.noiseKernelTex = makeTexture2D(gl);
    this.uc = uniformLocations(gl, this.progConsole, CONSOLE_UNIFORMS);
    this.up = uniformLocations(gl, this.progPresent, PRESENT_UNIFORMS);
    this.compTex = makeTexture2D(gl);
    this.lutTex = makeTexture2D(gl);
    this.colorTex = makeTexture2D(gl);
    this.polarTex = makeTexture2D(gl);
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
    for (const prog of [this.progA, this.progL, this.progP, this.progB, this.progC, this.progD]) {
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
      ['uPassD', 9],
    ];
    for (const [name, unit] of unitsB) gl.uniform1i(gl.getUniformLocation(this.progB, name), unit);
    gl.useProgram(this.progL);
    gl.uniform1i(gl.getUniformLocation(this.progL, 'uPassA'), 2);
    gl.useProgram(this.progP);
    gl.uniform1i(gl.getUniformLocation(this.progP, 'uPassA'), 2);
    gl.uniform1i(gl.getUniformLocation(this.progP, 'uDead'), 3);
    gl.useProgram(this.progC);
    gl.uniform1i(gl.getUniformLocation(this.progC, 'uSig'), 2);
    gl.uniform1i(gl.getUniformLocation(this.progC, 'uPsf'), 3);
    gl.uniform1i(gl.getUniformLocation(this.progC, 'uSig2'), 4);
    gl.useProgram(this.progD);
    gl.uniform1i(gl.getUniformLocation(this.progD, 'uAx'), 2);
    gl.uniform1i(gl.getUniformLocation(this.progD, 'uPsf'), 3);
    gl.uniform1i(gl.getUniformLocation(this.progD, 'uAx2'), 4);
    gl.useProgram(this.progConsole);
    gl.uniform1i(this.uc.uEnv, 2);
    gl.uniform1i(this.uc.uIds, 3);
    gl.uniform1i(this.uc.uComp, 4);
    gl.uniform1i(this.uc.uHist, 5);
    gl.uniform1i(this.uc.uNoise, 6);
    gl.useProgram(this.progNoiseA);
    gl.uniform1i(this.una.uKernels, 2);
    gl.useProgram(this.progNoiseL);
    gl.uniform1i(this.unl.uNoiseAx, 2);
    gl.uniform1i(this.unl.uKernels, 3);
    gl.useProgram(this.progPresent);
    gl.uniform1i(this.up.uPacked, 2);
    gl.uniform1i(this.up.uLut, 3);
    gl.uniform1i(this.up.uColor, 4);
    gl.uniform1i(this.up.uPolar, 5);
  }

  /** True once the WebGL context is lost (GPU reset, driver update): the caller must fall back to the CPU. */
  get contextLost(): boolean {
    return this.disposed || this.gl.isContextLost();
  }

  stats(): Record<string, number | string> {
    return {
      renderMs: Number(this.lastMs.toFixed(2)),
      gpuMs: Number(this.lastGpuMs.toFixed(2)),
      readMs: Number(this.lastReadMs.toFixed(2)),
      presentMs: Number(this.lastPresentMs.toFixed(2)),
      output: this.lastOutput,
      gpu: 'webgl2',
    };
  }

  /** Frees every GL object and the context itself; afterwards `render` throws and the other entry points decline. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    for (const p of [
      this.progA,
      this.progL,
      this.progP,
      this.progB,
      this.progC,
      this.progD,
      this.progConsole,
      this.progPresent,
      this.progNoiseA,
      this.progNoiseL,
    ])
      gl.deleteProgram(p);
    for (const t of [this.compTex, this.lutTex, this.colorTex, this.polarTex]) gl.deleteTexture(t);
    gl.deleteTexture(this.paramsTex);
    gl.deleteTexture(this.noiseTex);
    gl.deleteTexture(this.psfTex);
    gl.deleteTexture(this.noiseKernelTex);
    this.disposeTargets();
    this.compKey =
      this.lutKeyUploaded =
      this.colorKey =
      this.polarKeyUploaded =
      this.psfKeyUploaded =
      this.noiseKernelKey =
        '';
    this.noiseSeed = NaN;
    (gl.getExtension('WEBGL_lose_context') as { loseContext: () => void } | null)?.loseContext();
  }

  private disposeTargets(): void {
    const gl = this.gl;
    for (const t of [
      this.texA0,
      this.texA1,
      this.texA2,
      this.texA3,
      this.texSD,
      this.texS0,
      this.texS1,
      this.texSC0,
      this.texSC1,
      this.texSIds,
      this.texB0,
      this.texL0,
      this.texP0,
      this.texB1,
      this.texB2,
      this.texC0,
      this.texC1,
      this.texD0,
      this.texNA,
      this.texNL,
      ...this.texHist,
      this.texPacked,
    ])
      if (t) gl.deleteTexture(t);
    for (const f of [
      this.fbA,
      this.fbS0,
      this.fbS1,
      this.fbL,
      this.fbP,
      this.fbB,
      this.fbC,
      this.fbD,
      this.fbNA,
      this.fbNL,
      ...this.fbConsole,
    ])
      if (f) gl.deleteFramebuffer(f);
    this.texHist = [null, null];
    this.fbConsole = [null, null];
    this.texPacked = null;
    this.histValid = false;
    this.packedFresh = false;
    this.texA0 =
      this.texA1 =
      this.texA2 =
      this.texA3 =
      this.texSD =
      this.texS0 =
      this.texS1 =
      this.texSC0 =
      this.texSC1 =
      this.texSIds =
        null;
    this.texL0 =
      this.texP0 =
      this.texB0 =
      this.texB1 =
      this.texB2 =
      this.texC0 =
      this.texC1 =
      this.texD0 =
      this.texNA =
      this.texNL =
        null;
    this.fbA =
      this.fbS0 =
      this.fbS1 =
      this.fbL =
      this.fbP =
      this.fbB =
      this.fbC =
      this.fbD =
      this.fbNA =
      this.fbNL =
        null;
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
    this.uploadKernels(this.psfTex, buildPsfKernels(spec, frequencyMHz, harmonics, bw), spec);
    this.psfKeyUploaded = key;
  }

  /** Upload the receive response of the receiver noise (decision 91) in the PSF table layout. */
  private ensureNoiseKernels(spec: PolarFrameSpec, settings: AcquisitionSettings): void {
    const k = buildNoiseKernelsCached(spec, settings);
    if (this.noiseKernelKey === k.key) return;
    this.uploadKernels(this.noiseKernelTex, k, spec);
    this.noiseKernelKey = k.key;
  }

  private uploadKernels(tex: WebGLTexture, k: PsfKernels, spec: PolarFrameSpec): void {
    const rows = spec.samples + 1;
    const data = new Float32Array(LATERAL_TAPS * rows * 4);
    const c = MAX_LATERAL_RADIUS;
    for (let j = -k.axialRadius; j <= k.axialRadius; j++)
      data[(c + j) * 4] = k.axial[j + k.axialRadius]!;
    data[c * 4 + 1] = k.axialRadius;
    for (let si = 0; si < spec.samples; si++) {
      const row = (si + 1) * LATERAL_TAPS;
      for (let t = 0; t < LATERAL_TAPS; t++)
        data[(row + t) * 4] = k.lateral[si * LATERAL_TAPS + t]!;
      data[(row + c) * 4 + 1] = k.lateralRadius[si]!;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LATERAL_TAPS, rows, 0, gl.RGBA, gl.FLOAT, data);
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
      const fb = gl.createFramebuffer();
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
    this.texA3 = f32();
    this.texSD = f32(); // the side planes' fourth attachment (their second-look phasor is never read)
    this.texS0 = f32();
    this.texS1 = f32();
    this.texSC0 = f32();
    this.texSC1 = f32();
    this.texSIds = mk(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texB0 = f32();
    this.texB1 = mk(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texB2 = f32();
    this.texL0 = f32();
    this.texP0 = f32();
    this.texC0 = f32();
    this.texC1 = f32();
    this.texD0 = f32();
    this.texNA = f32();
    this.texNL = f32();
    this.fbA = mkFb(this.texA0, this.texA1, this.texA2, this.texA3);
    this.fbS0 = mkFb(this.texS0, this.texSIds, this.texSC0, this.texSD);
    this.fbS1 = mkFb(this.texS1, this.texSIds, this.texSC1, this.texSD);
    this.fbB = mkFb(this.texB0, this.texB1, this.texB2);
    this.fbL = mkFb(this.texL0);
    this.fbP = mkFb(this.texP0);
    this.fbC = mkFb(this.texC0, this.texC1);
    this.fbD = mkFb(this.texD0);
    this.fbNA = mkFb(this.texNA);
    this.fbNL = mkFb(this.texNL);
    const hist0 = f32(),
      hist1 = f32();
    const packed = mk(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texHist = [hist0, hist1];
    this.texPacked = packed;
    this.fbConsole = [mkFb(hist0, packed), mkFb(hist1, packed)];
    this.readPacked = new Uint8Array(w * h * 4);
    this.fbW = w;
    this.fbH = h;
    this.readAmp = new Float32Array(w * h * 4);
    this.readIds = new Uint8Array(w * h * 4);
  }

  /** Passes A–D: envelope amplitude and transmission in texD0, ids in texB1; fbD stays bound. */
  private formEnvelope(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec): void {
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
    const bindAt = (unit: number, tex: WebGLTexture | null): void => this.bindAt(unit, tex);
    // pass L: which samples lie behind a pleural entry on their own line (the CPU march never classifies them)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbL);
    gl.useProgram(this.progL);
    bindAt(2, this.texA0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // pass P: the attenuation increments averaged over the beam's width at each depth (decision 144)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbP);
    gl.useProgram(this.progP);
    bindAt(2, this.texA0);
    bindAt(3, this.texL0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // pass B: transmission march → complex signal (σ and flags of pass A come through pass P)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
    gl.useProgram(this.progB);
    bindAt(2, this.texP0);
    bindAt(3, this.texA1);
    bindAt(4, this.texS0);
    bindAt(5, this.texS1);
    bindAt(6, this.texA2);
    bindAt(7, this.texSC0);
    bindAt(8, this.texSC1);
    bindAt(9, this.texA3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // pass C: axial PSF, both compounding looks
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbC);
    gl.useProgram(this.progC);
    bindAt(2, this.texB0);
    bindAt(3, this.psfTex);
    bindAt(4, this.texB2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // pass D: lateral PSF and envelope, the looks averaged
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbD);
    gl.useProgram(this.progD);
    bindAt(2, this.texC0);
    bindAt(3, this.psfTex);
    bindAt(4, this.texC1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let u = 2; u <= 9; u++) bindAt(u, null);
  }

  private bindAt(unit: number, tex: WebGLTexture | null): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
  }

  render(
    scene: Scene,
    beam: BeamFrame,
    spec: PolarFrameSpec,
    _phase: number,
    out: PolarFrame,
  ): void {
    if (this.disposed) throw new Error('Webgl2Renderer used after dispose');
    const t0 = performance.now();
    const gl = this.gl;
    const w = spec.samples,
      h = spec.lines;
    this.formEnvelope(scene, beam, spec);
    // read back: amplitude + transmission from D, ids from B. A one-texel read first waits for the GPU, so the
    // stats separate GPU work (gpuMs) from the transfer of the frame (readMs).
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, this.probe);
    const tGpu = performance.now();
    this.lastGpuMs = tGpu - t0;
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, this.readAmp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
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
    this.packedFresh = false;
    this.lastOutput = 'float';
    this.lastMs = performance.now() - t0;
    this.lastReadMs = performance.now() - tGpu;
  }

  /**
   * Render and form the displayed polar image on the GPU (decision 54): passes A–D, then the console pass,
   * whose packed RGBA8 output (grey, structure, tissue, transmission code) is the only read-back. The envelope
   * amplitude stays on the GPU. Advances the console state exactly like `applyConsole`.
   */
  renderDisplay(
    scene: Scene,
    beam: BeamFrame,
    spec: PolarFrameSpec,
    _phase: number,
    out: PolarFrame,
    _hints: RenderHints | undefined,
    con: DisplayConsole,
    display: Uint8ClampedArray,
  ): boolean {
    const gl = this.gl;
    if (this.disposed || gl.isContextLost()) return false;
    const t0 = performance.now();
    const w = spec.samples,
      h = spec.lines;
    this.formEnvelope(scene, beam, spec);
    const s = con.settings;
    this.ensureCompensation(s, spec);
    let useHistory = con.state.gpuHistory && this.histValid && s.persistence > 0;
    if (!con.state.gpuHistory && s.persistence > 0 && con.state.prev?.length === w * h) {
      // the previous output of this state came from the CPU console: continue its persistence here
      this.uploadHistory(con.state.prev, w, h);
      useHistory = true;
    }
    // receiver noise (decision 91): white complex samples filtered along the beam, then across lines
    this.ensureNoiseKernels(spec, s);
    gl.viewport(0, 0, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbNA);
    gl.useProgram(this.progNoiseA);
    gl.uniform1i(this.una.uSamples, w);
    gl.uniform1ui(this.una.uSeed, con.state.seed >>> 0);
    gl.uniform1ui(this.una.uFrameIndex, con.state.frameIndex >>> 0);
    this.bindAt(2, this.noiseKernelTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbNL);
    gl.useProgram(this.progNoiseL);
    gl.uniform1i(this.unl.uLines, h);
    this.bindAt(2, this.texNA);
    this.bindAt(3, this.noiseKernelTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const next = this.histCurrent === 0 ? 1 : 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbConsole[next]);
    gl.useProgram(this.progConsole);
    const u = this.uc;
    gl.uniform1i(u.uSamples, w);
    gl.uniform1f(u.uDynRange, s.dynamicRangeDb);
    gl.uniform1f(u.uEdge, s.edgeEnhance > 0 ? s.edgeEnhance * 0.8 : 0);
    gl.uniform1f(u.uPersist, useHistory ? s.persistence : 0);
    gl.uniform1i(
      u.uGrayMap,
      s.grayMap === 's-curve'
        ? 1
        : s.grayMap === 'high-contrast'
          ? 2
          : s.grayMap === 'clinical'
            ? 3
            : 0,
    );
    this.bindAt(2, this.texD0);
    this.bindAt(3, this.texB1);
    this.bindAt(4, this.compTex);
    this.bindAt(5, this.texHist[this.histCurrent]);
    this.bindAt(6, this.texNL);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let unit = 2; unit <= 6; unit++) this.bindAt(unit, null);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.probe8);
    const tGpu = performance.now();
    this.lastGpuMs = tGpu - t0;
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.readPacked);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // a context lost during the frame reads nothing: decline before touching any state
    if (gl.isContextLost()) return false;
    this.histCurrent = next;
    this.histValid = true;
    this.packedFresh = true;
    con.state.gpuHistory = true;
    con.state.prev = null;
    con.state.frameIndex++;
    const n = w * h;
    const rp = this.readPacked;
    const st = out.structure,
      ti = out.tissue,
      tr = out.transmission;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      display[i] = rp[o]!;
      st[i] = rp[o + 1]!;
      ti[i] = rp[o + 2]!;
      tr[i] = TRANS_DECODE[rp[o + 3]!]!;
    }
    this.lastOutput = 'display';
    this.lastMs = performance.now() - t0;
    this.lastReadMs = performance.now() - tGpu;
    return true;
  }

  /**
   * Scan-convert the display of the last `renderDisplay` (and the colour field) into the canvas at
   * width × height and hand it over as an ImageBitmap (decision 54). Null when there is no fresh GPU display
   * or the canvas cannot transfer bitmaps; with `readback` the pixels are copied there instead.
   */
  present(req: PresentRequest): ImageBitmap | null {
    const gl = this.gl;
    if (this.disposed || !this.packedFresh || !this.texPacked || gl.isContextLost()) return null;
    const t0 = performance.now();
    const { lut, width: W, height: H, color } = req;
    const canvas = gl.canvas;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    this.ensureLut(lut, W, H);
    if (color) {
      this.ensureColor(color, lut.lines, lut.samples);
      this.ensurePolar(lut, W, H);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.bindVertexArray(this.vao);
    gl.useProgram(this.progPresent);
    const u = this.up;
    gl.uniform1i(u.uHeightPx, H);
    gl.uniform1i(u.uLines, lut.lines);
    gl.uniform1i(u.uSamples, lut.samples);
    gl.uniform1i(u.uColorOn, color ? 1 : 0);
    if (color) {
      const c = color.settings;
      gl.uniform4f(u.uBox, c.boxRMinCm, c.boxRMaxCm, c.boxThetaMinRad, c.boxThetaMaxRad);
      gl.uniform2f(u.uColorMap, c.scaleMps, c.showVariance ? 1 : 0);
    }
    this.bindAt(2, this.texPacked);
    this.bindAt(3, this.lutTex);
    this.bindAt(4, this.colorTex);
    this.bindAt(5, this.polarTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let unit = 2; unit <= 5; unit++) this.bindAt(unit, null);
    if (req.readback) {
      const tmp = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, tmp);
      for (let y = 0; y < H; y++)
        req.readback.set(tmp.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      this.lastPresentMs = performance.now() - t0;
      return null;
    }
    const bitmap =
      typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas
        ? canvas.transferToImageBitmap()
        : null;
    this.lastPresentMs = performance.now() - t0;
    return bitmap;
  }

  /**
   * Hand persistence back to the CPU console: when the last output of `state` was formed here, read the history
   * texture into `state.prev` (one float read of lines × samples, only when the console switches to the CPU).
   */
  restoreCpuHistory(state: ConsoleState, spec: PolarFrameSpec): void {
    if (!state.gpuHistory) return;
    state.gpuHistory = false;
    const gl = this.gl;
    const w = spec.samples,
      h = spec.lines;
    if (this.disposed || gl.isContextLost() || !this.histValid || this.fbW !== w || this.fbH !== h)
      return;
    const n = w * h;
    if (this.histUpload.length !== n * 4) this.histUpload = new Float32Array(n * 4);
    const t = this.histUpload;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbConsole[this.histCurrent]);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, t);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (gl.isContextLost()) return;
    const prev = new Float32Array(n);
    for (let i = 0; i < n; i++) prev[i] = t[i * 4]!;
    state.prev = prev;
  }

  /** Put a CPU persistence buffer (0..1 per sample) into the history texture the next console pass reads. */
  private uploadHistory(prev: Float32Array, w: number, h: number): void {
    const n = w * h;
    if (this.histUpload.length !== n * 4) this.histUpload = new Float32Array(n * 4);
    const t = this.histUpload;
    t.fill(0);
    for (let i = 0; i < n; i++) t[i * 4] = prev[i] ?? 0;
    const gl = this.gl;
    this.bindAt(UPLOAD_UNIT, this.texHist[this.histCurrent]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, t);
    this.bindAt(UPLOAD_UNIT, null);
    this.histValid = true;
  }

  private ensureCompensation(s: AcquisitionSettings, spec: PolarFrameSpec): void {
    const key = `${spec.samples}|${spec.depthCm}|${s.frequencyMHz}|${s.gainDb}|${s.tgcDb.join(',')}`;
    if (key === this.compKey) return;
    if (this.compData.length !== spec.samples) this.compData = new Float32Array(spec.samples);
    consoleCompensation(s, spec, this.compData);
    const gl = this.gl;
    this.bindAt(UPLOAD_UNIT, this.compTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, spec.samples, 1, 0, gl.RED, gl.FLOAT, this.compData);
    this.bindAt(UPLOAD_UNIT, null);
    this.compKey = key;
  }

  private ensureLut(lut: ScanLut, W: number, H: number): void {
    if (lut.key === this.lutKeyUploaded) return;
    this.lutTexels = packScanLutTexels(lut, this.lutTexels);
    const gl = this.gl;
    this.bindAt(UPLOAD_UNIT, this.lutTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16UI,
      W,
      H,
      0,
      gl.RGBA_INTEGER,
      gl.UNSIGNED_SHORT,
      this.lutTexels,
    );
    this.bindAt(UPLOAD_UNIT, null);
    this.lutKeyUploaded = lut.key;
  }

  /**
   * The colour box is tested against the LUT's own polar coordinates, not recomputed per pixel: GLSL `atan` is
   * approximate on some GPUs (on SwiftShader ~0.1 % of the sector's pixels landed on the other side of a box edge).
   */
  private ensurePolar(lut: ScanLut, W: number, H: number): void {
    if (lut.key === this.polarKeyUploaded) return;
    const n = W * H;
    if (this.polarTexels.length !== n * 2) this.polarTexels = new Float32Array(n * 2);
    const t = this.polarTexels;
    for (let p = 0; p < n; p++) {
      t[p * 2] = lut.rCm[p] ?? 0;
      t[p * 2 + 1] = lut.theta[p] ?? 0;
    }
    const gl = this.gl;
    this.bindAt(UPLOAD_UNIT, this.polarTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, W, H, 0, gl.RG, gl.FLOAT, t);
    this.bindAt(UPLOAD_UNIT, null);
    this.polarKeyUploaded = lut.key;
  }

  private ensureColor(c: PresentColor, lines: number, samples: number): void {
    const key = `${c.version}|${lines}x${samples}`;
    if (key === this.colorKey) return;
    const n = lines * samples;
    if (this.colorTexels.length !== n * 4) this.colorTexels = new Float32Array(n * 4);
    const t = this.colorTexels;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const v = c.vel[i] ?? NaN;
      const valid = !Number.isNaN(v);
      t[o] = valid ? v : 0;
      t[o + 1] = c.variance[i] ?? 0;
      t[o + 2] = valid ? 1 : 0;
      t[o + 3] = 1;
    }
    const gl = this.gl;
    this.bindAt(UPLOAD_UNIT, this.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, samples, lines, 0, gl.RGBA, gl.FLOAT, t);
    this.bindAt(UPLOAD_UNIT, null);
    this.colorKey = key;
  }
}

function makeTexture2D(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture();
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
  const prog = gl.createProgram();
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
  const dbg = gl.getExtension('WEBGL_debug_renderer_info') as {
    UNMASKED_RENDERER_WEBGL: number;
  } | null;
  const name: unknown = dbg
    ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
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
export function createWebgl2Renderer(
  canvas?: OffscreenCanvas | HTMLCanvasElement,
  options: { allowSoftware?: boolean } = {},
): { renderer: Webgl2Renderer | null; reason: string } {
  try {
    const c =
      canvas ??
      (typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(4, 4)
        : typeof document !== 'undefined'
          ? document.createElement('canvas')
          : null);
    if (!c) return { renderer: null, reason: 'no canvas available' };
    const gl = c.getContext('webgl2', {
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
    });
    if (!gl) return { renderer: null, reason: 'WebGL2 unavailable' };
    const name = webglRendererName(gl);
    if (!options.allowSoftware && SOFTWARE_GL.test(name)) {
      // lib.dom types this extension and tsc accepts the call; the linter's program resolves the overload only
      // on some runs and reports an unsafe call on the others, so the directive is kept and its «unused» warning
      // is silenced for this file in eslint.config.js
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { renderer: null, reason: `software WebGL (${name.slice(0, 60)}): CPU tracer` };
    }
    return { renderer: new Webgl2Renderer(gl), reason: 'ok' };
  } catch (e) {
    return { renderer: null, reason: e instanceof Error ? e.message : String(e) };
  }
}
