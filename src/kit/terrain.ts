import * as THREE from 'three';

/** Height-field terrain mesh with per-vertex colours (soft, matte). */
export function makeTerrain(opts: {
  size: number;
  segments: number;
  height: (x: number, z: number) => number;
  color: (x: number, z: number, h: number, out: THREE.Color) => void;
  material?: THREE.MeshStandardMaterial;
  center?: [number, number];
}): THREE.Mesh {
  const g = new THREE.PlaneGeometry(opts.size, opts.size, opts.segments, opts.segments);
  g.rotateX(-Math.PI / 2);
  const cx = opts.center?.[0] ?? 0;
  const cz = opts.center?.[1] ?? 0;
  g.translate(cx, 0, cz);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = opts.height(x, z);
    pos.setY(i, h);
    opts.color(x, z, h, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = opts.material ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.vertexColors = true;
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Scatter many copies of a small mesh with one draw call.
 * `place` returns false to skip an instance, otherwise fills the dummy transform (and optional colour).
 */
export function scatter(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  place: (i: number, dummy: THREE.Object3D, color: THREE.Color) => boolean,
  castShadow = false,
): THREE.InstancedMesh {
  const inst = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color(1, 1, 1);
  let n = 0;
  let useColor = false;
  for (let i = 0; i < count; i++) {
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    color.setRGB(1, 1, 1);
    if (!place(i, dummy, color)) continue;
    dummy.updateMatrix();
    inst.setMatrixAt(n, dummy.matrix);
    if (color.r !== 1 || color.g !== 1 || color.b !== 1) useColor = true;
    inst.setColorAt(n, color);
    n++;
  }
  inst.count = n;
  if (!useColor) inst.instanceColor = null;
  inst.castShadow = castShadow;
  inst.receiveShadow = true;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.computeBoundingSphere();
  return inst;
}

/** Distance from point to a polyline in XZ. */
export function distToPath(x: number, z: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}
