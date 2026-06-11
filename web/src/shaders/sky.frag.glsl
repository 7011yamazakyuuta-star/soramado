/*
 * soramado sky shader — physically based single-scattering atmosphere
 * (Bruneton & Neyret 2008 formulation; parameters after Hillaire 2020).
 *
 * Everything you see is derived from the radiative transfer integral:
 * no colour ramps, no gradient textures, no images.
 *
 * Pipeline: HDR radiance -> auto exposure -> ACES tone map -> gamma ->
 * blue-noise dither (mandatory: an 8-bit display would otherwise band
 * on the sky's extremely smooth gradients and reveal itself as a screen).
 *
 * When USE_LUT == 1 a precomputed multiple-scattering LUT (built in
 * /colab/multi_scattering_lut.ipynb) replaces the realtime single-scatter
 * integral. The parameterisation here and in the notebook MUST match.
 */

in vec2 vNdc;
out vec4 outColor;

// ---------------------------------------------------------------- uniforms
uniform vec2 uResolution;
uniform float uTime;          // seconds since app start (drift/twinkle/clouds)
uniform ivec2 uNoiseOffset;   // temporal blue-noise offset
uniform sampler2D uBlueNoise; // 64x64 R8 blue noise, tiled

uniform mat3 uCamBasis;       // columns: right, up, forward (world space)
uniform float uTanHalfFov;    // tan(vertical fov / 2)

uniform vec3 uSunDir;         // unit vector toward the sun (x=E, y=up, z=N)
uniform vec3 uBetaR;          // Rayleigh scattering coeff (lambda^-4), 1/m
uniform vec3 uSunIrradiance;  // top-of-atmosphere irradiance (renderer units)
uniform float uExposure;

uniform int uSamples;         // view-ray march steps (quality scaled)
uniform int uLightSamples;    // sun-ray march steps

uniform float uSunDiscOn;     // 0/1 (default 0: no identifiable light source)
uniform float uCloudsOn;      // 0/1 thin cirrus layer
uniform float uCloudCover;    // 0..1
uniform float uStarsOn;       // 0/1
uniform mat3 uStarMat;        // horizon frame -> sky-fixed equatorial frame

#if USE_LUT
uniform sampler2D uTransmittanceLut; // 256 x 64 (mu, altitude)
uniform highp sampler3D uScatteringLut; // 128(mu) x 64(muS) x 32(nu)
uniform vec3 uScatLutSize;
uniform vec2 uTransLutSize;
#endif

// ---------------------------------------------------------------- constants
const float PI = 3.14159265358979;

const float Rg = 6360.0e3; // ground radius [m]
const float Rt = 6460.0e3; // atmosphere top radius [m]
const float Hr = 8500.0;   // Rayleigh scale height [m]
const float Hm = 1200.0;   // Mie scale height [m]

const float kMieScattering = 3.996e-6;
const float kMieExtinction = 4.440e-6;
const float kMieG = 0.8;

// Ozone: absorption only; gives twilight its deep indigo zenith.
const vec3 kBetaOzone = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float kOzoneCenter = 25.0e3;
const float kOzoneHalfWidth = 15.0e3;

const float kSunAngularRadius = 0.004651; // ~0.2665 deg

// ---------------------------------------------------------------- helpers
float saturate1(float x) { return clamp(x, 0.0, 1.0); }

// Distance to the sphere of radius `radius` centred on the planet centre,
// from origin `ro` (planet-centre coordinates) along `rd`. Returns the far
// intersection (we are always inside the atmosphere). -1 if none.
float raySphereFar(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b + sqrt(disc);
}

// Near intersection (for ground hit tests). -1 if none or behind.
float raySphereNear(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float t = -b - sqrt(disc);
  return t > 0.0 ? t : -1.0;
}

vec3 densitiesAt(float h) {
  float dR = exp(-h / Hr);
  float dM = exp(-h / Hm);
  float dO = max(0.0, 1.0 - abs(h - kOzoneCenter) / kOzoneHalfWidth);
  return vec3(dR, dM, dO);
}

float phaseRayleigh(float mu) {
  return 3.0 / (16.0 * PI) * (1.0 + mu * mu);
}

float phaseMieHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

// Optical depth (Rayleigh, Mie, ozone) from point p toward the sun.
// Returns a large depth if the sun ray is blocked by the planet.
vec3 sunOpticalDepth(vec3 p, vec3 sunDir) {
  if (raySphereNear(p, sunDir, Rg) > 0.0) {
    return vec3(1e9); // geometric shadow of the Earth
  }
  float tTop = raySphereFar(p, sunDir, Rt);
  float n = float(uLightSamples);
  float dt = tTop / n;
  vec3 od = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= uLightSamples) break;
    vec3 q = p + sunDir * ((float(i) + 0.5) * dt);
    float h = length(q) - Rg;
    od += densitiesAt(h) * dt;
  }
  return od;
}

vec3 extinctionFromOd(vec3 od) {
  // od = (rayleigh, mie, ozone) depths in metres of reference density
  vec3 tau = uBetaR * od.x + vec3(kMieExtinction) * od.y + kBetaOzone * od.z;
  return exp(-tau);
}

// ------------------------------------------------- realtime single scatter
// Returns in-scattered radiance toward the camera, and the total view-path
// optical depth (for star/sun extinction) via `viewOd`.
vec3 singleScattering(vec3 ro, vec3 rd, vec3 sunDir, out vec3 viewOd) {
  float tTop = raySphereFar(ro, rd, Rt);
  float n = float(uSamples);
  float dt = tTop / n;

  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  vec3 od = vec3(0.0);

  for (int i = 0; i < 96; i++) {
    if (i >= uSamples) break;
    float t = (float(i) + 0.5) * dt;
    vec3 p = ro + rd * t;
    float h = length(p) - Rg;
    vec3 d = densitiesAt(h) * dt;
    od += d;

    vec3 odSun = sunOpticalDepth(p, sunDir);
    vec3 attn = extinctionFromOd(od + odSun);
    sumR += attn * d.x;
    sumM += attn * d.y;
  }

  viewOd = od;
  float mu = dot(rd, sunDir);
  vec3 radiance =
    sumR * uBetaR * phaseRayleigh(mu) +
    sumM * kMieScattering * phaseMieHG(mu, kMieG);
  return uSunIrradiance * radiance;
}

#if USE_LUT
// ------------------------------------------------- precomputed LUT lookup
// Parameterisation (must match colab/multi_scattering_lut.ipynb):
//   u_mu  = pow(clamp(mu, 0, 1), 1/3)            mu  = cos(view zenith)
//   u_muS = (1 - exp(-3*muS - 0.6)) / (1 - exp(-3.6))   muS in [-0.2, 1]
//   u_nu  = (1 + nu) / 2                          nu  = dot(view, sun)
// Texture stores radiance (per unit solar irradiance) with phase applied,
// all scattering orders combined, viewer at ground level.
float lutCoord(float u, float n) { return u * (n - 1.0) / n + 0.5 / n; }

vec3 lutRadiance(vec3 rd, vec3 sunDir) {
  float mu = saturate1(rd.y);
  float muS = sunDir.y;
  float nu = clamp(dot(rd, sunDir), -1.0, 1.0);

  float uMu = pow(mu, 1.0 / 3.0);
  float uMuS = saturate1((1.0 - exp(-3.0 * muS - 0.6)) / (1.0 - exp(-3.6)));
  float uNu = (1.0 + nu) * 0.5;

  vec3 c = vec3(
    lutCoord(uMu, uScatLutSize.x),
    lutCoord(uMuS, uScatLutSize.y),
    lutCoord(uNu, uScatLutSize.z));
  // The LUT muS axis ends at -0.2 (sun ~11.5 deg below horizon); fade the
  // residual glow to zero through astronomical twilight (muS ~ -0.31).
  float deepTwilightFade = smoothstep(-0.31, -0.2, muS);
  return uSunIrradiance * texture(uScatteringLut, c).rgb * deepTwilightFade;
}

// Transmittance LUT: x = mu in [-0.3, 1] (linear), y = altitude (sqrt scale).
vec3 lutTransmittance(float mu, float h) {
  float uMu = saturate1((mu + 0.3) / 1.3);
  float uH = sqrt(saturate1(h / (Rt - Rg)));
  vec2 c = vec2(lutCoord(uMu, uTransLutSize.x), lutCoord(uH, uTransLutSize.y));
  return texture(uTransmittanceLut, c).rgb;
}
#endif

// ---------------------------------------------------------------- stars
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Procedural star field, evaluated in a sky-fixed (equatorial) frame so the
// stars rise and set with the sidereal rotation of the Earth.
vec3 starField(vec3 dirEq) {
  // ~0.9 deg cells; only some cells hold a star -> mean spacing ~2 deg,
  // comparable to the real naked-eye star count (~4-5k per hemisphere).
  const float kCells = 64.0;
  vec3 p = dirEq * kCells;
  vec3 cell = floor(p);
  vec3 rnd = hash33(cell);
  if (rnd.x > 0.18) return vec3(0.0);

  vec3 starDir = normalize(cell + 0.5 + (rnd - 0.5));
  float d = distance(dirEq, starDir);

  // Apparent-magnitude-like distribution: almost all faint, very few bright.
  float u = hash13(cell + 17.0);
  float brightness = 0.025 + 0.975 * pow(u, 16.0);

  // Sharp point spread (~0.9 px sigma, resolution-aware).
  float pxAngle = uTanHalfFov * 2.0 / uResolution.y;
  float sigma = max(0.9 * pxAngle, 0.0004);
  float psf = exp(-d * d / (2.0 * sigma * sigma));
  if (psf < 0.002) return vec3(0.0);

  // Subtle scintillation
  float tw = 0.84 + 0.16 * sin(uTime * (1.5 + 3.0 * rnd.x) + rnd.y * 6.2831);

  // Colour temperature variation (cool blue-white to warm orange).
  vec3 tint = mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.82, 1.0), rnd.z);
  tint = mix(vec3(1.0), tint, 0.55);

  const float kStarRadiance = 3.0e-4; // brightest-star radiance (HDR units)
  return kStarRadiance * brightness * psf * tw * tint;
}

// Airglow: faint emission layer at ~87 km; van Rhijn brightening toward the
// horizon. Keeps the night sky from being a dead black void.
vec3 airglow(vec3 rd) {
  float sinZ = length(rd.xz);
  float a = Rg / (Rg + 87.0e3);
  float vr = 1.0 / sqrt(max(1.0 - a * a * sinZ * sinZ, 1e-3));
  return vec3(0.9, 1.8, 1.3) * 0.5e-6 * vr;
}

// ---------------------------------------------------------------- cirrus
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(vec3(i, 13.7));
  float b = hash13(vec3(i + vec2(1, 0), 13.7));
  float c = hash13(vec3(i + vec2(0, 1), 13.7));
  float d = hash13(vec3(i + vec2(1, 1), 13.7));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise(p);
    p = rot * p * 2.13;
    amp *= 0.5;
  }
  return v;
}

// Kasten–Young relative air mass (cheap sun transmittance for the cloud
// layer only; the sky itself uses the full ray march).
float airMass(float cosZenith) {
  float zDeg = degrees(acos(clamp(cosZenith, -1.0, 1.0)));
  if (zDeg > 95.0) return 40.0;
  return 1.0 / (cosZenith + 0.50572 * pow(96.07995 - zDeg, -1.6364));
}

vec3 sunTransmittanceAnalytic(float h, float cosZenith) {
  float am = airMass(cosZenith);
  vec3 vertical =
    uBetaR * (Hr * exp(-h / Hr)) +
    vec3(kMieExtinction) * (Hm * exp(-h / Hm)) +
    kBetaOzone * (kOzoneHalfWidth * max(0.0, 1.0 - abs(h - kOzoneCenter) / kOzoneHalfWidth + 0.35));
  return exp(-vertical * am);
}

// Thin cirrus sheet at ~8 km. Returns (rgb radiance, alpha).
vec4 cirrus(vec3 ro, vec3 rd, vec3 sunDir) {
  float t = raySphereFar(ro, rd, Rg + 8000.0);
  if (t <= 0.0) return vec4(0.0);
  vec3 p = ro + rd * t;
  vec2 uv = p.xz * (1.0 / 250.0e3);
  uv += uTime * vec2(2.4e-5, 0.9e-5); // slow wind drift

  float n = fbm(uv * 4.0 + 1.7 * fbm(uv * 7.0)); // domain-warped FBM
  float cover = mix(0.78, 0.45, uCloudCover);
  float dens = smoothstep(cover, cover + 0.32, n);

  // Fade near the horizon (long slant path) for a natural thinning.
  float horizonFade = smoothstep(0.02, 0.12, rd.y);
  dens *= horizonFade * 0.55;
  if (dens <= 0.0001) return vec4(0.0);

  vec3 sunT = sunTransmittanceAnalytic(8000.0, sunDir.y);
  float mu = dot(rd, sunDir);
  float ph = mix(phaseMieHG(mu, 0.55), 1.0 / (4.0 * PI), 0.35);
  vec3 light = uSunIrradiance * sunT * ph * 2.4;
  return vec4(light, dens);
}

// ------------------------------------------------------------- tone map
// Narkowicz ACES filmic approximation.
vec3 acesToneMap(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// ---------------------------------------------------------------- main
void main() {
  // ----- view ray
  float aspect = uResolution.x / uResolution.y;
  vec3 rd = normalize(
    uCamBasis * vec3(vNdc.x * aspect * uTanHalfFov, vNdc.y * uTanHalfFov, 1.0));

  // The app renders sky only: rays are smoothly clamped just above the
  // horizon so the view extends into haze instead of hitting ground.
  {
    float e = asin(clamp(rd.y, -1.0, 1.0));
    float eMin = 0.0035; // ~0.2 deg
    float soft = 0.012;
    float ec = eMin + 0.5 * ((e - eMin) + sqrt((e - eMin) * (e - eMin) + soft * soft));
    vec2 azim = rd.xz / max(length(rd.xz), 1e-5);
    rd = normalize(vec3(azim.x * cos(ec), sin(ec), azim.y * cos(ec)));
  }

  vec3 ro = vec3(0.0, Rg + 2.0, 0.0); // observer 2 m above sea level
  vec3 sunDir = normalize(uSunDir);

  // ----- atmosphere
  vec3 viewOd;
  vec3 sky;
#if USE_LUT
  sky = lutRadiance(rd, sunDir);
  vec3 viewTrans = lutTransmittance(rd.y, 2.0);
  viewOd = vec3(0.0); // unused on the LUT path
#else
  sky = singleScattering(ro, rd, sunDir, viewOd);
  vec3 viewTrans = extinctionFromOd(viewOd);
#endif

  // ----- celestial additions, attenuated by the atmosphere
  if (uStarsOn > 0.5) {
    vec3 dirEq = uStarMat * rd;
    sky += starField(dirEq) * viewTrans;
  }
  sky += airglow(rd) * viewTrans;

  // Solar disc (off by default: the sky must not reveal a light source).
  if (uSunDiscOn > 0.5) {
    float cosView = dot(rd, sunDir);
    float cosR = cos(kSunAngularRadius);
    if (cosView > cosR - 0.0002) {
      float edge = smoothstep(cosR - 0.0002, cosR + 0.00004, cosView);
      // Limb darkening
      float r = saturate1(acos(min(cosView, 1.0)) / kSunAngularRadius);
      float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - r * r)));
      const float kSunSolidAngle = 6.8e-5;
      sky += (uSunIrradiance / kSunSolidAngle) * viewTrans * edge * limb;
    }
  }

  // ----- thin cirrus (optional)
  if (uCloudsOn > 0.5) {
    vec4 cl = cirrus(ro, rd, sunDir);
    sky = mix(sky, cl.rgb, cl.a * 0.85);
  }

  // ----- HDR -> display
  vec3 color = acesToneMap(sky * uExposure);
  color = pow(color, vec3(1.0 / 2.2));

  // Mandatory blue-noise dither: breaks up 8-bit banding on the very smooth
  // sky gradient (a visible band instantly reveals "this is a screen").
  ivec2 noiseCoord = (ivec2(gl_FragCoord.xy) + uNoiseOffset) % ivec2(64);
  float bn = texelFetch(uBlueNoise, noiseCoord, 0).r;
  // Triangular-ish remap of the uniform noise for cleaner quantisation.
  float tpdf = bn * 2.0 - 1.0;
  tpdf = sign(tpdf) * (1.0 - sqrt(max(0.0, 1.0 - abs(tpdf))));
  color += tpdf * (0.75 / 255.0);

  outColor = vec4(color, 1.0);
}
