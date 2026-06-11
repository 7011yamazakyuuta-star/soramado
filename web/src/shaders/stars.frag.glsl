in float vRadiance;
in vec3 vExtinction;
in float vSeed;
in float vTwAmp;

uniform float uTime;
uniform float uExposure;

out vec4 outColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  // Gaussian point spread with a faint diffraction-ish halo.
  float psf = exp(-r2 * 4.2) + 0.07 * exp(-r2 * 1.2);

  float tw = 1.0 - vTwAmp + vTwAmp * sin(uTime * (1.1 + fract(vSeed) * 2.8) + vSeed);

  vec3 L = vRadiance * vExtinction * psf * tw;
  // Tone-mapped in display space and blended additively over the sky pass:
  // exact for these tiny bright points, and avoids an HDR framebuffer.
  vec3 c = pow(aces(L * uExposure), vec3(1.0 / 2.2));
  outColor = vec4(c, 1.0);
}
