import vertSrc from '../shaders/sky.vert.glsl?raw';
import fragSrc from '../shaders/sky.frag.glsl?raw';
import starsVertSrc from '../shaders/stars.vert.glsl?raw';
import starsFragSrc from '../shaders/stars.frag.glsl?raw';
import { BLUE_NOISE_SIZE, generateBlueNoise } from './bluenoise';
import { BRIGHT_STARS } from '../sky/brightstars';
import type { SkyLut } from '../atmosphere/lut';

export interface RenderParams {
  timeSec: number;
  /** Weather clock [s]: follows *simulation* time (capped timelapse in demo). */
  cloudTimeSec: number;
  frame: number;
  camBasis: Float32Array; // 9 elements, columns: right, up, forward
  tanHalfFov: number;
  sunDir: [number, number, number];
  betaR: [number, number, number];
  sunIrradiance: [number, number, number];
  exposure: number;
  samples: number;
  lightSamples: number;
  sunDisc: boolean;
  clouds: boolean;
  cloudCover: number;
  haze: boolean;
  stars: boolean;
  starMat: Float32Array; // 9 elements, column-major
  moonDir: [number, number, number];
  /** Moonlight irradiance, already phase- and twilight-gated (0 in daylight). */
  moonIrr: [number, number, number];
  moonDisc: boolean;
  moonAngularRadius: number;
  /** 0..1, geomagnetic-latitude & night gated. */
  auroraStrength: number;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile error:\n${log}`);
  }
  return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram failed');
  const v = compileShader(gl, gl.VERTEX_SHADER, vs);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program link error:\n${log}`);
  }
  return prog;
}

const VERT_HEADER = '#version 300 es\nprecision highp float;\n';

function fragHeader(useLut: boolean): string {
  return (
    '#version 300 es\n' +
    'precision highp float;\nprecision highp int;\nprecision highp sampler3D;\n' +
    `#define USE_LUT ${useLut ? 1 : 0}\n`
  );
}

interface ProgramInfo {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
}

export class SkyRenderer {
  readonly gl: WebGL2RenderingContext;
  private programs: { single: ProgramInfo; lut: ProgramInfo | null } = {
    single: null as unknown as ProgramInfo,
    lut: null,
  };
  private blueNoiseTex: WebGLTexture;
  private transTex: WebGLTexture | null = null;
  private scatTex: WebGLTexture | null = null;
  private lut: SkyLut | null = null;
  private vao: WebGLVertexArrayObject;
  private starProgram: ProgramInfo;
  private starVao: WebGLVertexArrayObject;
  private starCount: number;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.programs.single = this.buildProgram(false);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    this.vao = vao;

    // --- catalogue star point pass (real constellations) ---
    const header = '#version 300 es\nprecision highp float;\n';
    const starProg = linkProgram(gl, header + starsVertSrc, header + starsFragSrc);
    const starUniforms = new Map<string, WebGLUniformLocation>();
    const nU = gl.getProgramParameter(starProg, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < nU; i++) {
      const info = gl.getActiveUniform(starProg, i);
      const l = info && gl.getUniformLocation(starProg, info.name);
      if (info && l) starUniforms.set(info.name, l);
    }
    this.starProgram = { program: starProg, uniforms: starUniforms };

    // Sky-fixed equatorial frame convention (matches uStarMat, verified):
    // eqDir = (cos d cos a, -cos d sin a, sin d) for RA a, Dec d.
    const RAD = Math.PI / 180;
    this.starCount = BRIGHT_STARS.length;
    const starData = new Float32Array(this.starCount * 4);
    BRIGHT_STARS.forEach(([raDeg, decDeg, mag], i) => {
      const ra = raDeg * RAD;
      const dec = decDeg * RAD;
      starData[i * 4 + 0] = Math.cos(dec) * Math.cos(ra);
      starData[i * 4 + 1] = -Math.cos(dec) * Math.sin(ra);
      starData[i * 4 + 2] = Math.sin(dec);
      starData[i * 4 + 3] = mag;
    });
    const starVao = gl.createVertexArray();
    const starBuf = gl.createBuffer();
    if (!starVao || !starBuf) throw new Error('star buffer alloc failed');
    this.starVao = starVao;
    gl.bindVertexArray(starVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
    gl.bufferData(gl.ARRAY_BUFFER, starData, gl.STATIC_DRAW);
    const aEqDir = gl.getAttribLocation(starProg, 'aEqDir');
    const aMag = gl.getAttribLocation(starProg, 'aMag');
    gl.enableVertexAttribArray(aEqDir);
    gl.vertexAttribPointer(aEqDir, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aMag);
    gl.vertexAttribPointer(aMag, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);

    // Blue-noise dither mask (generated procedurally, cached).
    const noise = generateBlueNoise();
    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture failed');
    this.blueNoiseTex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      BLUE_NOISE_SIZE,
      BLUE_NOISE_SIZE,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      noise,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  private buildProgram(useLut: boolean): ProgramInfo {
    const gl = this.gl;
    const program = linkProgram(gl, VERT_HEADER + vertSrc, fragHeader(useLut) + fragSrc);
    const uniforms = new Map<string, WebGLUniformLocation>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const loc = gl.getUniformLocation(program, info.name);
      if (loc) uniforms.set(info.name.replace(/\[0\]$/, ''), loc);
    }
    return { program, uniforms };
  }

  /** Install (or remove) the precomputed multiple-scattering LUT. */
  setLut(lut: SkyLut | null): void {
    const gl = this.gl;
    this.lut = lut;
    if (!lut) return;

    if (!this.programs.lut) this.programs.lut = this.buildProgram(true);

    const t = lut.manifest.transmittance;
    this.transTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.transTex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA16F, t.width, t.height, 0,
      gl.RGBA, gl.HALF_FLOAT, lut.transmittance,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const s = lut.manifest.scattering;
    this.scatTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.scatTex);
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.RGBA16F, s.muSize, s.muSSize, s.nuSize, 0,
      gl.RGBA, gl.HALF_FLOAT, lut.scattering,
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }

  get usingLut(): boolean {
    return this.lut !== null && this.programs.lut !== null;
  }

  /** Resize the drawing buffer; returns true if it changed. */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number, scale: number): boolean {
    const w = Math.max(1, Math.round(cssWidth * pixelRatio * scale));
    const h = Math.max(1, Math.round(cssHeight * pixelRatio * scale));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  render(p: RenderParams): void {
    const gl = this.gl;
    const info = this.usingLut ? this.programs.lut! : this.programs.single;
    const u = info.uniforms;
    const loc = (name: string) => u.get(name) ?? null;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(info.program);
    gl.bindVertexArray(this.vao);

    gl.uniform2f(loc('uResolution'), this.canvas.width, this.canvas.height);
    gl.uniform1f(loc('uTime'), p.timeSec);
    gl.uniform1f(loc('uCloudTime'), p.cloudTimeSec);

    // Temporal blue-noise offset: R2 low-discrepancy sequence.
    const ox = Math.floor((p.frame * 0.7548776662) % 1 * BLUE_NOISE_SIZE);
    const oy = Math.floor((p.frame * 0.5698402909) % 1 * BLUE_NOISE_SIZE);
    gl.uniform2i(loc('uNoiseOffset'), ox, oy);

    gl.uniformMatrix3fv(loc('uCamBasis'), false, p.camBasis);
    gl.uniform1f(loc('uTanHalfFov'), p.tanHalfFov);
    gl.uniform3f(loc('uSunDir'), ...p.sunDir);
    gl.uniform3f(loc('uBetaR'), ...p.betaR);
    gl.uniform3f(loc('uSunIrradiance'), ...p.sunIrradiance);
    gl.uniform1f(loc('uExposure'), p.exposure);
    gl.uniform1i(loc('uSamples'), p.samples);
    gl.uniform1i(loc('uLightSamples'), p.lightSamples);
    gl.uniform1f(loc('uSunDiscOn'), p.sunDisc ? 1 : 0);
    gl.uniform1f(loc('uCloudsOn'), p.clouds ? 1 : 0);
    gl.uniform1f(loc('uCloudCover'), p.cloudCover);
    gl.uniform1f(loc('uHazeOn'), p.haze ? 1 : 0);
    gl.uniform1f(loc('uStarsOn'), p.stars ? 1 : 0);
    gl.uniformMatrix3fv(loc('uStarMat'), false, p.starMat);
    gl.uniform3f(loc('uMoonDir'), ...p.moonDir);
    gl.uniform3f(loc('uMoonIrr'), ...p.moonIrr);
    gl.uniform1f(loc('uMoonDiscOn'), p.moonDisc ? 1 : 0);
    gl.uniform1f(loc('uMoonAngularRadius'), p.moonAngularRadius);
    gl.uniform1f(loc('uAuroraStrength'), p.auroraStrength);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.blueNoiseTex);
    gl.uniform1i(loc('uBlueNoise'), 0);

    if (this.usingLut && this.lut) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.transTex);
      gl.uniform1i(loc('uTransmittanceLut'), 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_3D, this.scatTex);
      gl.uniform1i(loc('uScatteringLut'), 2);
      const s = this.lut.manifest.scattering;
      const t = this.lut.manifest.transmittance;
      gl.uniform3f(loc('uScatLutSize'), s.muSize, s.muSSize, s.nuSize);
      gl.uniform2f(loc('uTransLutSize'), t.width, t.height);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Catalogue stars: additive points over the sky pass.
    if (p.stars) {
      const sp = this.starProgram;
      const su = (name: string) => sp.uniforms.get(name) ?? null;
      gl.useProgram(sp.program);
      gl.bindVertexArray(this.starVao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniformMatrix3fv(su('uStarMat'), false, p.starMat);
      gl.uniformMatrix3fv(su('uCamBasis'), false, p.camBasis);
      gl.uniform2f(su('uResolution'), this.canvas.width, this.canvas.height);
      gl.uniform1f(su('uTanHalfFov'), p.tanHalfFov);
      gl.uniform3f(su('uBetaR'), ...p.betaR);
      gl.uniform1f(su('uTime'), p.timeSec);
      gl.uniform1f(su('uExposure'), p.exposure);
      gl.drawArrays(gl.POINTS, 0, this.starCount);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.vao);
    }
  }
}
