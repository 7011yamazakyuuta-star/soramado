// Catalogue star points: equatorial direction + magnitude per vertex.
in vec3 aEqDir;
in float aMag;

uniform mat3 uStarMat;     // world -> sky-fixed equatorial (orthonormal)
uniform mat3 uCamBasis;    // columns: right, up, forward
uniform vec2 uResolution;
uniform float uTanHalfFov;
uniform vec3 uBetaR;

out float vRadiance;
out vec3 vExtinction;
out float vSeed;
out float vTwAmp;

void main() {
  // transpose(uStarMat) * eq == eq * uStarMat: equatorial -> world.
  vec3 world = aEqDir * uStarMat;
  vec3 view = world * uCamBasis; // (right.w, up.w, fwd.w)
  if (view.z <= 0.001 || world.y < -0.02) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0); // clipped away
    gl_PointSize = 0.0;
    vRadiance = 0.0;
    vExtinction = vec3(0.0);
    vSeed = 0.0;
    vTwAmp = 0.0;
    return;
  }
  float aspect = uResolution.x / uResolution.y;
  gl_Position = vec4(
    view.x / (view.z * uTanHalfFov * aspect),
    view.y / (view.z * uTanHalfFov),
    0.0, 1.0);

  // Pogson's law: radiance ratio 10^(-0.4 m), anchored to the procedural
  // field's brightest-star level.
  vRadiance = 3.4e-4 * pow(10.0, -0.4 * aMag);

  // Atmospheric extinction (Kasten-Young air mass): stars dim AND redden
  // toward the horizon, exactly like the real thing.
  float cosz = clamp(world.y, 0.0, 1.0);
  float zDeg = degrees(acos(cosz));
  float am = zDeg > 95.0 ? 40.0 : 1.0 / (cosz + 0.50572 * pow(96.07995 - zDeg, -1.6364));
  vec3 tauV = uBetaR * 8500.0 + vec3(4.44e-6 * 1200.0) +
              vec3(0.650e-6, 1.881e-6, 0.085e-6) * 15000.0;
  vExtinction = exp(-tauV * am);

  // Scintillation grows with air mass (turbulent path length).
  vTwAmp = clamp(0.06 + 0.05 * am, 0.06, 0.45);
  vSeed = fract(aEqDir.x * 137.31 + aEqDir.z * 71.7) * 6.2831 + aMag;

  float px = uResolution.y / 540.0;
  gl_PointSize = clamp((3.4 - 0.5 * aMag) * px, 2.0, 9.0);
}
