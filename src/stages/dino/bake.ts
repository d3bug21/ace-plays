import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat, type Face } from '../../kit/kit';

// Draw-call savers for Dino Valley. Creatures and props are modelled from the
// shared kit primitives (each with its own soft matte colour), then each rigid
// piece is collapsed into ONE vertex-coloured mesh. A chirper is ~7 draw calls
// instead of ~30, which keeps a valley full of dinosaurs well under budget.

/** Shared vertex-colour matte material. */
export function vcMat(rough = 0.85, doubleSide = false): THREE.MeshStandardMaterial {
  return mat(0xffffff, { vertexColors: true, rough, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide });
}

const tmpC = new THREE.Color();
const tmpM = new THREE.Matrix4();
const inv = new THREE.Matrix4();

function underKeep(o: THREE.Object3D, root: THREE.Object3D, keep: Set<THREE.Object3D>): boolean {
  let p: THREE.Object3D | null = o;
  while (p && p !== root) {
    if (keep.has(p)) return true;
    p = p.parent;
  }
  return false;
}

/** Prepare one mesh's geometry for merging: non-indexed, position/normal/color only, in `space`. */
function prepGeometry(m: THREE.Mesh, toSpace: THREE.Matrix4): THREE.BufferGeometry {
  const src = m.geometry;
  let g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.color) {
    const mm = m.material as THREE.MeshStandardMaterial;
    tmpC.copy(mm.color ?? new THREE.Color(1, 1, 1));
    if (mm.emissive && mm.emissiveIntensity > 0) {
      tmpC.r += mm.emissive.r * mm.emissiveIntensity * 0.45;
      tmpC.g += mm.emissive.g * mm.emissiveIntensity * 0.45;
      tmpC.b += mm.emissive.b * mm.emissiveIntensity * 0.45;
    }
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpC.r;
      col[i * 3 + 1] = tmpC.g;
      col[i * 3 + 2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g = g.index ? g.toNonIndexed() : g;
  tmpM.multiplyMatrices(toSpace, m.matrixWorld);
  g.applyMatrix4(tmpM);
  return g;
}

/**
 * Merge every mesh under `root` (except those under `keep` objects) into one
 * vertex-coloured mesh that replaces them, in root's local space.
 */
export function collapse(
  root: THREE.Object3D,
  o: { keep?: THREE.Object3D[]; rough?: number; shadow?: boolean; receive?: boolean; doubleSide?: boolean } = {},
): THREE.Mesh | null {
  const keep = new Set(o.keep ?? []);
  root.updateMatrixWorld(true);
  inv.copy(root.matrixWorld).invert();
  const meshes: THREE.Mesh[] = [];
  root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    if (underKeep(m, root, keep)) return;
    meshes.push(m);
  });
  if (!meshes.length) return null;
  const geos = meshes.map((m) => prepGeometry(m, inv));
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  for (const m of meshes) m.removeFromParent();
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, vcMat(o.rough ?? 0.85, o.doubleSide));
  mesh.castShadow = o.shadow ?? false;
  mesh.receiveShadow = o.receive ?? false;
  root.add(mesh);
  return mesh;
}

/** Merge a whole (static, world-placed) group into a single geometry in world space. */
export function bakeWorldGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const id = new THREE.Matrix4();
  const geos: THREE.BufferGeometry[] = [];
  root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    geos.push(prepGeometry(m, id));
  });
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

/** Bake a model group into a standalone geometry in the group's local space (for instancing). */
export function bakeLocalGeometry(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  inv.copy(root.matrixWorld).invert();
  const geos: THREE.BufferGeometry[] = [];
  root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    geos.push(prepGeometry(m, inv));
  });
  const merged = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  return merged;
}

/**
 * Collapse a kit Face into 2 eye meshes (blink still works by squashing each
 * eye) and leave the smile + blush for the head collapse. Returns the eye
 * groups to pass as `keep` when collapsing the head.
 */
export function slimFace(face: Face): THREE.Object3D[] {
  const keep: THREE.Object3D[] = [];
  for (const e of face.eyes) {
    collapse(e.group, { rough: 0.35 });
    e.pupil = new THREE.Object3D();
    keep.push(e.group);
  }
  // The smile is now static (baked into the head).
  face.smile = null;
  return keep;
}
