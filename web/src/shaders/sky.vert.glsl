// Fullscreen triangle, no vertex buffers needed (gl_VertexID trick).
out vec2 vNdc;

void main() {
  // (-1,-1), (3,-1), (-1,3) covers the whole screen with one triangle.
  vec2 p = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  vNdc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}
