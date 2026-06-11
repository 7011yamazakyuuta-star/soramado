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
uniform float uTime;          // wall seconds (twinkle/shimmer/drift)
uniform float uCloudTime;     // weather seconds: simulation-time driven, so
                              // demo mode shows a timelapse and the manual
                              // slider scrubs the cloud field too
uniform ivec2 uNoiseOffset;   // temporal blue-noise offset
uniform sampler2D uBlueNoise; // 64x64 R8 blue noise, tiled

uniform mat3 uCamBasis;       // columns: right, up, forward (world space)
uniform float uTanHalfFov;    // tan(vertical fov / 2)

uniform vec3 uSunDir;         // unit vector toward the sun (x=E, y=up, z=N)
uniform vec3 uBetaR;          // Rayleigh scattering coeff (lambda^-4), 1/m
uniform vec3 uSunIrradiance;  // top-of-atmosphere irradiance (renderer units)
uniform float uExposure;

uniform vec3 uMoonDir;          // unit vector toward the moon
uniform vec3 uMoonIrr;          // moonlight irradiance (phase- & gate-scaled)
uniform float uMoonDiscOn;      // 0/1 moon disc rendering
uniform float uMoonAngularRadius; // rad (varies with lunar distance)

uniform int uSamples;         // view-ray march steps (quality scaled)
uniform int uLightSamples;    // sun-ray march steps

uniform float uAuroraStrength; // 0..1, geomagnetic-latitude & night gated
uniform float uSunDiscOn;     // 0/1 (default 0: no identifiable light source)
uniform float uCloudsOn;      // 0/1 layered cloud system
// Per-layer coverage 0..1 (low cumulus / mid sheet / high cirrus). Driven by
// the manual slider+diurnal model, or by live Open-Meteo data.
uniform vec3 uCloudCovers;
uniform float uSynopticAmp;   // synoptic noise amplitude (small in live mode)
uniform float uVisibility;    // 0..1 (1 = crystal clear) scales the haze
// Contrail: spawn origin/direction [km, wind frame of the 11 km sheet],
// seconds since spawn, and on/off.
uniform vec2 uContrailOrigin;
uniform vec2 uContrailDir;
uniform float uContrailT;
uniform float uContrailOn;
uniform float uHazeOn;        // 0/1 boundary-layer haze
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
// Returns in-scattered radiance toward the camera per unit light-source
// irradiance (multiply by the sun's or moon's irradiance outside), and the
// total view-path optical depth (for star/sun extinction) via `viewOd`.
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
  return sumR * uBetaR * phaseRayleigh(mu) +
         sumM * kMieScattering * phaseMieHG(mu, kMieG);
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
  // Radiance is per unit light-source irradiance (works for sun and moon).
  float deepTwilightFade = smoothstep(-0.31, -0.2, muS);
  return texture(uScatteringLut, c).rgb * deepTwilightFade;
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

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0));
  float n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1));
  float n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1));
  float n111 = hash13(i + vec3(1, 1, 1));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}

// Turbulence-like spectrum: rotated octaves of value noise.
float fbm3(vec3 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise3(p);
    p = vec3(0.8 * p.x + 0.6 * p.y, -0.6 * p.x + 0.8 * p.y, p.z + 9.7) * 2.13;
    amp *= 0.5;
  }
  return v;
}

float fbm3lo(vec3 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * vnoise3(p);
    p = vec3(0.8 * p.x + 0.6 * p.y, -0.6 * p.x + 0.8 * p.y, p.z + 9.7) * 2.13;
    amp *= 0.5;
  }
  return v;
}

// Procedural star field, evaluated in a sky-fixed (equatorial) frame so the
// stars rise and set with the sidereal rotation of the Earth. `elevY` is the
// world-frame sin(elevation) used for horizon-dependent scintillation.
vec3 starField(vec3 dirEq, float elevY) {
  // ~0.9 deg cells; only some cells hold a star -> mean spacing ~2 deg,
  // comparable to the real naked-eye star count (~4-5k per hemisphere).
  const float kCells = 64.0;
  vec3 p = dirEq * kCells;
  vec3 cell = floor(p);
  vec3 rnd = hash33(cell);
  if (rnd.x > 0.18) return vec3(0.0);

  vec3 starDir = normalize(cell + 0.5 + (rnd - 0.5));
  float d = distance(dirEq, starDir);

  // Faint background population only — the bright anchors come from the
  // real star catalogue rendered as a separate point pass.
  float u = hash13(cell + 17.0);
  float brightness = 0.02 + 0.5 * pow(u, 16.0);

  // Sharp point spread (~0.9 px sigma, resolution-aware).
  float pxAngle = uTanHalfFov * 2.0 / uResolution.y;
  float sigma = max(0.9 * pxAngle, 0.0004);
  float psf = exp(-d * d / (2.0 * sigma * sigma));
  if (psf < 0.002) return vec3(0.0);

  // Scintillation strengthens toward the horizon (longer turbulent path).
  float twAmp = 0.10 + 0.25 * pow(1.0 - clamp(elevY, 0.0, 1.0), 2.0);
  float tw = 1.0 - twAmp + twAmp * sin(uTime * (1.5 + 3.0 * rnd.x) + rnd.y * 6.2831);

  // Colour temperature variation (cool blue-white to warm orange).
  vec3 tint = mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.82, 1.0), rnd.z);
  tint = mix(vec3(1.0), tint, 0.55);

  const float kStarRadiance = 3.0e-4; // brightest-star radiance (HDR units)
  return kStarRadiance * brightness * psf * tw * tint;
}

// The Milky Way: our own galaxy's disc as a patchy band of unresolved
// starlight with a brighter bulge toward Sagittarius and dark dust rifts.
// Evaluated in the sky-fixed equatorial frame -> it rises, crosses and
// sets with the real sidereal motion, exactly where it should be.
vec3 milkyWay(vec3 dirEq) {
  // J2000 unit vectors: north galactic pole and galactic centre.
  const vec3 gp = vec3(-0.8677, -0.1981, 0.4560);
  const vec3 gc = vec3(-0.0548, -0.8734, -0.4839);
  vec3 gy = cross(gp, gc);
  float sb = clamp(dot(dirEq, gp), -1.0, 1.0); // sin(galactic latitude)
  float b = asin(sb);
  float l = atan(dot(dirEq, gy), dot(dirEq, gc));

  float band = exp(-(b * b) / (2.0 * 0.21 * 0.21)); // sigma ~12 deg
  float bulge = 0.55 + 0.85 * exp(-(l * l) / (2.0 * 1.1 * 1.1));
  float pat = fbm3lo(vec3(l * 2.6, b * 8.0, 3.7));
  float rift = smoothstep(0.25, 0.62, fbm3lo(vec3(l * 4.2 + 9.0, b * 13.0, 7.7))) *
               smoothstep(0.18, 0.02, abs(b));
  float bright = band * bulge * (0.5 + 0.9 * pat) * (1.0 - 0.55 * rift);
  return vec3(1.0, 0.96, 0.90) * 8.5e-6 * bright;
}

// Airglow: faint emission layer at ~87 km; van Rhijn brightening toward the
// horizon. Keeps the night sky from being a dead black void.
vec3 airglow(vec3 rd) {
  float sinZ = length(rd.xz);
  float a = Rg / (Rg + 87.0e3);
  float vr = 1.0 / sqrt(max(1.0 - a * a * sinZ * sinZ, 1e-3));
  return vec3(0.9, 1.8, 1.3) * 0.5e-6 * vr;
}

// ---------------------------------------------------------------- clouds
// Display-only realism budget: a true fluid simulation is out of reach at
// 60 fps on phones, so we reproduce the *physical structure* instead —
//  - sheets live at real altitudes and advect with realistic layer winds;
//    two layers moving at different angular speeds give motion parallax
//  - cirrus fibres are stretched along the wind (shear anisotropy)
//  - shapes genuinely evolve: the noise field has a slow time dimension
//  - lighting is exact: the same ray-marched transmittance as the sky,
//    so sheets redden at sunset and keep catching afterglow while the
//    ground below is already inside the Earth's shadow.

// One thin cloud sheet.
//   alt       sheet altitude [m]
//   featureKm dominant feature size [km]
//   windDir/windSpd  layer wind (real m/s; drives both drift and fibres)
//   stretch   anisotropy along the wind (cirrus uncinus combing)
//   morphRate evolution speed of the shapes themselves
vec4 cloudLayer(vec3 ro, vec3 rd, vec3 skyAmbient, vec3 sunDir,
                float alt, float featureKm, vec2 windDir, float windSpd,
                float stretch, float morphRate, float sharp, float opacity,
                float coverIn) {
  float t = raySphereFar(ro, rd, Rg + alt);
  if (t <= 0.0) return vec4(0.0);
  vec3 pc = ro + rd * t;

  // Wind-aligned coordinates [km]; advect, then stretch fibres along wind.
  vec2 w = normalize(windDir);
  vec2 q = vec2(dot(pc.xz, w), dot(pc.xz, vec2(-w.y, w.x))) * 1e-3;
  q.x -= windSpd * uCloudTime * 1e-3;
  q.x /= stretch;

  // Slowly morphing, domain-warped turbulence.
  vec3 np = vec3(q / featureKm, uCloudTime * morphRate);
  vec2 warp = vec2(fbm3lo(np * 2.6 + 7.3), fbm3lo(np * 2.6 - 3.1)) - vec2(0.5);
  float n = fbm3(np + vec3(warp * 0.6, 0.0));

  // Weather evolution: a synoptic-scale coverage field rides the same wind,
  // so fronts genuinely arrive, thicken and clear instead of one frozen
  // pattern fading at dusk. (Live-weather mode keeps this small: data wins.)
  float synoptic = fbm3lo(vec3(q / 220.0, uCloudTime * 1.2e-4 + 31.7));
  float cover = mix(0.74, 0.40, coverIn) + uSynopticAmp * (synoptic - 0.5);
  float d = smoothstep(cover, cover + 0.30, n);
  d = pow(d, sharp);
  d *= smoothstep(0.015, 0.06, rd.y); // stay clear of the horizon clamp band
  if (d <= 0.002) return vec4(0.0);

  // Exact sun transmittance at the cloud point (same ray march as the sky):
  // handles reddening AND the Earth's shadow, so high sheets keep glowing
  // after ground sunset (afterglow) and go dark when the shadow climbs.
  vec3 sunT = extinctionFromOd(sunOpticalDepth(pc, sunDir));
  float mu = dot(rd, sunDir);
  // Dual-lobe phase: strong forward silver lining + slight back scatter.
  float ph = 0.72 * phaseMieHG(mu, 0.62) + 0.28 * phaseMieHG(mu, -0.18);
  // Powder term: optically thin edges stay translucent, cores fill in.
  float powder = 1.0 - exp(-3.5 * d);
  vec3 light = uSunIrradiance * sunT * ph * 2.6 * (0.55 + 0.45 * powder)
             + skyAmbient * 0.85;
  // Moonlit clouds: the same lighting path with the moon as the source.
  if (uMoonIrr.g > 1e-9) {
    vec3 moonT = extinctionFromOd(sunOpticalDepth(pc, uMoonDir));
    float mum = dot(rd, uMoonDir);
    float phm = 0.72 * phaseMieHG(mum, 0.62) + 0.28 * phaseMieHG(mum, -0.18);
    light += uMoonIrr * moonT * phm * 2.6 * (0.55 + 0.45 * powder);
  }
  return vec4(light, d * opacity);
}

// ---------------------------------------------------------------- aurora
// Auroral curtains, ray-marched through the real emission band (95-260 km).
// Structure follows the physics: sheets of field-aligned emission folded on
// km scales, green atomic-oxygen line (~557.7 nm) peaking near 110 km, red
// (630 nm) high above 200 km, a faint N2 purple fringe at the bottom edge.
// The folds drift, the curtains wave slowly and the vertical striations
// shimmer — three time scales, like the real thing.
vec3 aurora(vec3 ro, vec3 rd) {
  if (uAuroraStrength < 0.004 || rd.y < 0.03) return vec3(0.0);

  const int N = 18;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < N; i++) {
    float h = mix(95.0e3, 260.0e3, (float(i) + 0.5) / float(N));
    float t = raySphereFar(ro, rd, Rg + h);
    vec2 q = (ro + rd * t).xz * 1.0e-3; // km at emission altitude

    // Folded curtain coordinate: slow large-scale waving + drifting folds.
    float wave = 0.8 * fbm3lo(vec3(q * 0.004, uCloudTime * 0.013));
    float u = q.y * 0.016 + wave; // sheets run roughly east-west
    float ribbon = fbm3lo(vec3(u * 2.2, u * 0.35 + 11.0, uCloudTime * 0.045));
    float curtain = pow(smoothstep(0.45, 0.85, ribbon), 2.2);

    // Vertical striations (fast shimmer along the sheet).
    float stri = 0.55 + 0.45 * vnoise3(vec3(q.x * 0.12, q.y * 0.5, uTime * 0.55));

    // Emission profile vs altitude.
    float hk = h * 1.0e-3;
    float green = exp(-pow((hk - 112.0) / 38.0, 2.0));
    float red = 0.40 * smoothstep(160.0, 250.0, hk);
    float purple = 0.30 * exp(-pow((hk - 97.0) / 9.0, 2.0));
    vec3 emit = green * vec3(0.16, 1.0, 0.42) +
                red * vec3(1.0, 0.22, 0.34) +
                purple * vec3(0.45, 0.30, 1.0);

    // Wide diffuse glow component + sharp curtain core.
    float glow = 0.30 * smoothstep(0.25, 0.75, ribbon);
    sum += emit * (curtain * stri + glow);
  }
  // Slow breathing of overall activity.
  float breathe = 0.75 + 0.25 * sin(uTime * 0.05 + 1.3);
  return sum * (5.5e-5 / float(N)) * uAuroraStrength * breathe;
}

// Fair-weather cumulus (~1.5 km): puffy convective cells with pseudo-3D sun
// shading (density gradient toward the sun brightens lit flanks). Coverage
// follows the diurnal convection cycle in manual mode, or live data.
vec4 cumulusLayer(vec3 ro, vec3 rd, vec3 skyAmbient, vec3 sunDir, float coverIn) {
  if (coverIn < 0.02) return vec4(0.0);
  float t = raySphereFar(ro, rd, Rg + 1500.0);
  if (t <= 0.0) return vec4(0.0);
  vec3 pc = ro + rd * t;
  vec2 w = normalize(vec2(0.66, 0.75));
  vec2 q = vec2(dot(pc.xz, w), dot(pc.xz, vec2(-w.y, w.x))) * 1e-3;
  q.x -= 7.0 * uCloudTime * 1e-3; // gentle boundary-layer wind

  vec3 np = vec3(q / 1.3, uCloudTime * 0.008);
  float cells = smoothstep(0.62 - 0.34 * coverIn, 0.80 - 0.30 * coverIn,
                           fbm3lo(np * 0.33 + 5.0));
  float n = fbm3(np);
  float d = cells * smoothstep(0.52, 0.80, n);
  d *= smoothstep(0.025, 0.09, rd.y);
  if (d <= 0.004) return vec4(0.0);

  vec2 sunQ = vec2(dot(sunDir.xz, w), dot(sunDir.xz, vec2(-w.y, w.x)));
  float nSun = fbm3(np + vec3(normalize(sunQ + vec2(1e-4)) * 0.25, 0.0));
  float relief = clamp(0.62 + 1.5 * (n - nSun), 0.30, 1.25);

  vec3 sunT = extinctionFromOd(sunOpticalDepth(pc, sunDir));
  float mu = dot(rd, sunDir);
  float ph = 0.5 * phaseMieHG(mu, 0.45) + 0.5 / (4.0 * PI);
  float powder = 1.0 - exp(-5.0 * d);
  vec3 light = uSunIrradiance * sunT * ph * 3.1 * relief * (0.5 + 0.5 * powder)
             + skyAmbient * 0.9;
  if (uMoonIrr.g > 1e-9) {
    vec3 moonT = extinctionFromOd(sunOpticalDepth(pc, uMoonDir));
    light += uMoonIrr * moonT * ph * 3.1 * relief;
  }
  return vec4(light, min(d * 1.4, 1.0) * 0.9);
}

// Boundary-layer haze (~1.6 km): a faintly irregular veil that hugs the
// horizon. Its slow unevenness removes the sterile, mathematically perfect
// gradient that reads as "computer graphics".
vec4 hazeLayer(vec3 ro, vec3 rd, vec3 skyAmbient, vec3 sunDir) {
  float t = raySphereFar(ro, rd, Rg + 1600.0);
  if (t <= 0.0) return vec4(0.0);
  vec3 pc = ro + rd * t;
  vec2 q = (pc.xz - vec2(4.0, 1.5) * uCloudTime) * 1e-3;
  float n = fbm3lo(vec3(q * (1.0 / 14.0), uCloudTime * 0.0012));
  float band = exp(-max(rd.y, 0.0) * 11.0);
  float a = 0.14 * band * smoothstep(0.2, 0.8, n + 0.25);
  if (a <= 0.002) return vec4(0.0);
  vec3 sunT = extinctionFromOd(sunOpticalDepth(pc, sunDir));
  float mu = dot(rd, sunDir);
  vec3 light = uSunIrradiance * sunT * phaseMieHG(mu, 0.5) * 1.3 + skyAmbient * 0.9;
  return vec4(light, a);
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
  sky = uSunIrradiance * lutRadiance(rd, sunDir);
  vec3 viewTrans = lutTransmittance(rd.y, 2.0);
  viewOd = vec3(0.0); // unused on the LUT path
#else
  sky = uSunIrradiance * singleScattering(ro, rd, sunDir, viewOd);
  vec3 viewTrans = extinctionFromOd(viewOd);
#endif

  // Moonlight scatters in the very same atmosphere: a bright moon turns the
  // night sky a deep Rayleigh blue and washes out stars around it.
  // (uMoonIrr is zeroed by the app in daylight, skipping the extra work.)
  if (uMoonIrr.g > 1e-9) {
#if USE_LUT
    sky += uMoonIrr * lutRadiance(rd, uMoonDir);
#else
    vec3 moonOd;
    sky += uMoonIrr * singleScattering(ro, rd, uMoonDir, moonOd);
#endif
  }

  // Pure air-light along the view ray: what still glows *in front of* any
  // celestial body (a daytime crescent's dark side melts into this).
  vec3 atmos = sky;

  // ----- celestial additions, attenuated by the atmosphere
  if (uStarsOn > 0.5) {
    vec3 dirEq = uStarMat * rd;
    sky += (starField(dirEq, rd.y) + milkyWay(dirEq)) * viewTrans;
  }
  sky += (airglow(rd) + aurora(ro, rd)) * viewTrans;

  // ----- moon disc: correct phase (terminator faces the sun), earthshine,
  // simple maria mottling, limb darkening; extinction reddens it when low.
  if (uMoonDiscOn > 0.5 && uMoonDir.y > -0.05) {
    float cosV = dot(rd, uMoonDir);
    float cosR = cos(uMoonAngularRadius);
    if (cosV > cosR - 0.0008) {
      vec3 mz = uMoonDir;
      vec3 mx = normalize(cross(vec3(0.0, 1.0, 0.0), mz));
      vec3 my = cross(mz, mx);
      vec2 duv = vec2(dot(rd, mx), dot(rd, my)) / uMoonAngularRadius;
      float rr = dot(duv, duv);
      float edge = 1.0 - smoothstep(0.92, 1.0, sqrt(rr));
      if (edge > 0.001) {
        // Sphere normal of the visible hemisphere (faces the viewer: -mz).
        vec3 n = vec3(duv, sqrt(max(0.0, 1.0 - rr)));
        vec3 nW = mx * n.x + my * n.y - mz * n.z;
        float sunlit = max(dot(nW, sunDir), 0.0);
        float limb = 0.82 + 0.18 * n.z;
        float mottle = 0.78 + 0.44 * (fbm3lo(nW * 5.2 + 2.7) - 0.5);
        const float kMoonAlbedo = 0.12;
        const float kEarthshine = 0.013;
        vec3 Lm = uSunIrradiance * (kMoonAlbedo / PI) *
                  (sunlit + kEarthshine) * limb * mottle;
        // Surface radiance through the air, plus the air-light in front:
        // by day the dark limb fades into the blue, exactly like reality.
        sky = mix(sky, Lm * viewTrans + atmos, edge);
      }
    }
  }

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

  // ----- clouds & haze, far to near (relative drift = motion parallax)
  if (uCloudsOn > 0.5) {
    // Cirrus at 10.5 km: long fibres combed by a ~26 m/s jet-level wind.
    vec4 ch = cloudLayer(ro, rd, sky, sunDir,
                         10500.0, 7.0, vec2(0.92, 0.25), 26.0, 4.5, 0.0022, 1.6, 0.5,
                         uCloudCovers.z);
    float cirrusA = ch.a;
    sky = mix(sky, ch.rgb, ch.a);

    // Contrail at ~11 km: razor sharp behind the (unseen) aircraft, then
    // spreading and fading into a cirrus wisp; drifts with the layer wind.
    if (uContrailOn > 0.5) {
      float tc = raySphereFar(ro, rd, Rg + 11000.0);
      vec2 qc = (ro + rd * tc).xz * 1e-3 -
                normalize(vec2(0.92, 0.25)) * (26.0 * uCloudTime * 1e-3);
      vec2 rel = qc - uContrailOrigin;
      float s = dot(rel, uContrailDir);
      float behind = 0.25 * uContrailT - s; // plane flies at 250 m/s
      if (s > 0.0 && behind > 0.0) {
        float age = behind / 0.25;
        float dd = abs(dot(rel, vec2(-uContrailDir.y, uContrailDir.x)));
        float wdt = 0.05 + 0.0016 * age;
        float dens = exp(-(dd * dd) / (2.0 * wdt * wdt)) * exp(-age / 650.0) *
                     smoothstep(0.0, 0.5, behind) * smoothstep(0.03, 0.07, rd.y);
        if (dens > 0.004) {
          vec3 Tc = extinctionFromOd(sunOpticalDepth(ro + rd * tc, sunDir));
          float phc = 0.7 * phaseMieHG(dot(rd, sunDir), 0.5) + 0.3 / (4.0 * PI);
          vec3 Lc = uSunIrradiance * Tc * phc * 3.4 + sky * 0.8;
          sky = mix(sky, Lc, min(dens * 1.1, 0.85));
        }
      }
    }

    // Mid-level sheet at 4 km: smaller puffs, different wind direction;
    // being closer it sweeps by faster, which is what sells the depth.
    vec4 cm = cloudLayer(ro, rd, sky, sunDir,
                         4000.0, 2.6, vec2(0.5, 0.6), 11.0, 1.3, 0.005, 1.2, 0.62,
                         uCloudCovers.y);
    sky = mix(sky, cm.rgb, cm.a);

    // Low cumulus at 1.5 km (diurnal convection / live low cloud).
    vec4 cu = cumulusLayer(ro, rd, sky, sunDir, uCloudCovers.x);
    sky = mix(sky, cu.rgb, cu.a);

    // 22-degree halo and sundogs: ice-crystal optics, only where the cirrus
    // sheet actually is. The ring has the real sharp inner edge (minimum
    // deviation) with red inside, and parhelia flank a low sun.
    if (cirrusA > 0.01 && sunDir.y > -0.05) {
      float theta = degrees(acos(clamp(dot(rd, sunDir), -1.0, 1.0)));
      float x = theta - 22.0;
      if (abs(x) < 6.0) {
        float th = raySphereFar(ro, rd, Rg + 10500.0);
        vec3 Th = extinctionFromOd(sunOpticalDepth(ro + rd * th, sunDir));
        float ring = smoothstep(-0.5, 0.3, x) * exp(-x * x / 8.0);
        vec3 tint = mix(vec3(1.0, 0.55, 0.45), vec3(0.85, 0.92, 1.0),
                        smoothstep(-0.2, 1.6, x));
        sky += uSunIrradiance * Th * tint * ring * cirrusA * 0.045;

        float sunElevDeg = degrees(asin(clamp(sunDir.y, -1.0, 1.0)));
        float dElev = degrees(asin(clamp(rd.y, -1.0, 1.0))) - sunElevDeg;
        float dogs = exp(-dElev * dElev / 4.5) * exp(-x * x / 2.4) *
                     smoothstep(32.0, 8.0, sunElevDeg);
        sky += uSunIrradiance * Th * vec3(1.0, 0.62, 0.42) * dogs * cirrusA * 0.16;
      }
    }
  }
  if (uHazeOn > 0.5) {
    vec4 hz = hazeLayer(ro, rd, sky, sunDir);
    // Live visibility scales the veil (10 km murk vs crystal-clear day).
    sky = mix(sky, hz.rgb, hz.a * mix(1.7, 0.6, uVisibility));
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
