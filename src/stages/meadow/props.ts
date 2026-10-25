import * as THREE from 'three';
import { geo, mat, part } from '../../kit/kit';
import type { Rng } from '../../core/math';

export const P = {
  grass: 0xa9c48f,
  grassDeep: 0x93b37c,
  grassLight: 0xbccf9c,
  path: 0xe4d4b2,
  trunk: 0x9a7656,
  leafA: 0x86ad7c,
  leafB: 0x9dbd8d,
  leafC: 0xb3c88f,
  fence: 0xf1e8d6,
  wood: 0xc9a982,
  woodDark: 0xa98a66,
  water: 0x9fc8cf,
  stone: 0xc9c4b8,
  coral: 0xe39a85,
  butter: 0xefcf7b,
  teal: 0x7fb8b4,
  lilac: 0xc7b7d9,
  cream: 0xf6efe2,
};

export function tree(rng: Rng, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const trunkH = rng.range(2.2, 3.2);
  g.add(part(geo.cyl(0.7, 1, 10), mat(P.trunk, { rough: 0.95 }), [0, trunkH / 2, 0], [0.3, trunkH, 0.3]));
  const leaves = [mat(P.leafA, { rough: 0.95 }), mat(P.leafB, { rough: 0.95 }), mat(P.leafC, { rough: 0.95 })];
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(0, 1);
    const r = i === 0 ? 0 : rng.range(0.6, 1.1);
    const s = i === 0 ? rng.range(1.5, 1.9) : rng.range(0.9, 1.3);
    g.add(part(geo.ico(1), leaves[i % 3], [Math.cos(a) * r, trunkH + 0.6 + (i === 0 ? 0.5 : rng.range(-0.2, 0.4)), Math.sin(a) * r], [s, s * 0.85, s]));
  }
  g.scale.setScalar(scale);
  return g;
}

export function bush(rng: Rng, s = 1): THREE.Group {
  const g = new THREE.Group();
  const m = mat(rng.chance(0.5) ? P.leafA : P.leafB, { rough: 0.95 });
  for (let i = 0; i < 3; i++) g.add(part(geo.ico(1), m, [rng.range(-0.4, 0.4), 0.35 + rng.range(0, 0.2), rng.range(-0.4, 0.4)], rng.range(0.45, 0.7)));
  if (rng.chance(0.5)) {
    const berry = mat(rng.pick([P.coral, P.butter, P.cream]), { rough: 0.6 });
    for (let i = 0; i < 5; i++) g.add(part(geo.sphere(6), berry, [rng.range(-0.5, 0.5), rng.range(0.4, 0.9), rng.range(-0.5, 0.5)], 0.06, [0, 0, 0], false));
  }
  g.scale.setScalar(s);
  return g;
}

export function fenceSegment(len: number): THREE.Group {
  const g = new THREE.Group();
  const m = mat(P.fence, { rough: 0.8 });
  const posts = Math.max(2, Math.round(len / 1.2) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -len / 2 + (i / (posts - 1)) * len;
    g.add(part(geo.box(0.2), m, [x, 0.5, 0], [0.12, 1, 0.12]));
    g.add(part(geo.cone(4), m, [x, 1.06, 0], [0.09, 0.14, 0.09], [0, Math.PI / 4, 0]));
  }
  g.add(part(geo.box(0.2), m, [0, 0.75, 0], [len, 0.1, 0.06]));
  g.add(part(geo.box(0.2), m, [0, 0.38, 0], [len, 0.1, 0.06]));
  return g;
}

export function flag(color = P.coral): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.cyl(1, 1, 8), mat(P.cream), [0, 1.5, 0], [0.06, 3, 0.06]));
  g.add(part(geo.sphere(10), mat(P.butter, { emissive: P.butter, emissiveIntensity: 0.3 }), [0, 3.05, 0], 0.12));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7, 8, 2), mat(color, { side: THREE.DoubleSide, rough: 0.8 }));
  cloth.geometry.translate(0.55, 0, 0);
  cloth.position.set(0.05, 2.6, 0);
  cloth.name = 'cloth';
  cloth.castShadow = true;
  g.add(cloth);
  return g;
}

export function animateFlag(g: THREE.Group, t: number): void {
  const cloth = g.getObjectByName('cloth') as THREE.Mesh | undefined;
  if (!cloth) return;
  const pos = cloth.geometry.attributes.position as THREE.BufferAttribute;
  if (!cloth.userData.base) cloth.userData.base = Float32Array.from(pos.array as Float32Array);
  const base = cloth.userData.base as Float32Array;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    pos.setZ(i, Math.sin(t * 4 - x * 4) * 0.12 * x);
  }
  pos.needsUpdate = true;
  cloth.geometry.computeVertexNormals();
}

export function log(len: number): THREE.Group {
  const g = new THREE.Group();
  const bark = mat(P.woodDark, { rough: 0.95 });
  const ring = mat(0xe2cba5, { rough: 0.9 });
  g.add(part(geo.cyl(1, 1, 16), bark, [0, 0.38, 0], [0.38, len, 0.38], [0, 0, Math.PI / 2]));
  g.add(part(geo.cyl(1, 1, 16), ring, [len / 2 + 0.01, 0.38, 0], [0.33, 0.02, 0.33], [0, 0, Math.PI / 2]));
  g.add(part(geo.cyl(1, 1, 16), ring, [-len / 2 - 0.01, 0.38, 0], [0.33, 0.02, 0.33], [0, 0, Math.PI / 2]));
  // Moss tufts and a mushroom for charm.
  const moss = mat(P.leafA, { rough: 1 });
  for (let i = 0; i < 6; i++) g.add(part(geo.sphere(8), moss, [-len / 2 + 0.8 + i * (len - 1.6) / 5, 0.72, (i % 2 ? 0.1 : -0.12)], [0.22, 0.09, 0.18], [0, 0, 0], false));
  g.add(part(geo.cyl(1, 1, 8), mat(P.cream), [len / 2 - 0.9, 0.85, 0.15], [0.04, 0.2, 0.04]));
  g.add(part(geo.sphere(12), mat(P.coral), [len / 2 - 0.9, 0.96, 0.15], [0.14, 0.08, 0.14]));
  return g;
}

export function bellFrame(): { group: THREE.Group; bell: THREE.Group } {
  const g = new THREE.Group();
  const wood = mat(P.wood, { rough: 0.85 });
  for (const s of [-1, 1]) {
    g.add(part(geo.box(0.15), wood, [s * 1.3, 1.6, 0.35], [0.22, 3.4, 0.22], [0.2, 0, 0]));
    g.add(part(geo.box(0.15), wood, [s * 1.3, 1.6, -0.35], [0.22, 3.4, 0.22], [-0.2, 0, 0]));
  }
  g.add(part(geo.box(0.15), wood, [0, 3.25, 0], [3, 0.24, 0.24]));
  g.add(part(geo.cone(4), mat(P.coral, { rough: 0.7 }), [0, 3.75, 0], [2.0, 0.7, 0.9], [0, Math.PI / 4, 0]));
  const bell = new THREE.Group();
  bell.position.set(0, 3.1, 0);
  const brass = mat(0xd8b56b, { rough: 0.35, metal: 0.45 });
  const bellBody = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.08, 0), new THREE.Vector2(0.35, -0.08), new THREE.Vector2(0.45, -0.5), new THREE.Vector2(0.62, -0.95), new THREE.Vector2(0.68, -1.05), new THREE.Vector2(0.6, -1.05)], 24), brass);
  bellBody.castShadow = true;
  bell.add(bellBody);
  bell.add(part(geo.sphere(10), mat(P.woodDark), [0, -1.0, 0], 0.13));
  g.add(bell);
  return { group: g, bell };
}

export function picnic(): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f4ede0';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = 'rgba(224,144,124,.75)';
  for (let i = 0; i < 4; i++) {
    x.fillRect(i * 16, 0, 8, 64);
    x.fillRect(0, i * 16, 64, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  const blanket = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  blanket.rotation.x = -Math.PI / 2;
  blanket.position.y = 0.04;
  blanket.receiveShadow = true;
  g.add(blanket);
  const basket = mat(P.wood, { rough: 0.9 });
  g.add(part(geo.box(0.3), basket, [0.6, 0.25, 0.3], [0.7, 0.45, 0.5]));
  g.add(part(geo.torus(0.12, Math.PI, 12), basket, [0.6, 0.48, 0.3], [0.3, 0.3, 0.3]));
  g.add(part(geo.sphere(12), mat(0xd9675e, { rough: 0.5 }), [-0.5, 0.12, -0.3], 0.12));
  g.add(part(geo.sphere(12), mat(0x9dbd8d, { rough: 0.5 }), [-0.3, 0.12, -0.45], 0.11));
  g.add(part(geo.cyl(1, 1, 12), mat(P.cream), [-0.7, 0.03, 0.4], [0.25, 0.03, 0.25]));
  return g;
}

export function swingSet(): { group: THREE.Group; swings: THREE.Group[] } {
  const g = new THREE.Group();
  const frame = mat(P.teal, { rough: 0.6 });
  for (const s of [-1, 1]) {
    g.add(part(geo.cyl(1, 1, 10), frame, [s * 2.2, 1.4, 0.6], [0.08, 3.1, 0.08], [0.2, 0, 0]));
    g.add(part(geo.cyl(1, 1, 10), frame, [s * 2.2, 1.4, -0.6], [0.08, 3.1, 0.08], [-0.2, 0, 0]));
  }
  g.add(part(geo.cyl(1, 1, 10), frame, [0, 2.9, 0], [0.08, 4.6, 0.08], [0, 0, Math.PI / 2]));
  const swings: THREE.Group[] = [];
  for (const x of [-1, 1]) {
    const sw = new THREE.Group();
    sw.position.set(x, 2.9, 0);
    const rope = mat(P.cream, { rough: 0.9 });
    sw.add(part(geo.cyl(1, 1, 6), rope, [-0.25, -1.1, 0], [0.02, 2.2, 0.02]));
    sw.add(part(geo.cyl(1, 1, 6), rope, [0.25, -1.1, 0], [0.02, 2.2, 0.02]));
    sw.add(part(geo.box(0.3), mat(x < 0 ? P.coral : P.butter), [0, -2.2, 0], [0.65, 0.08, 0.32]));
    g.add(sw);
    swings.push(sw);
  }
  return { group: g, swings };
}

export function slide(): THREE.Group {
  const g = new THREE.Group();
  const frame = mat(P.cream, { rough: 0.7 });
  const chute = mat(P.butter, { rough: 0.45 });
  for (const s of [-1, 1]) g.add(part(geo.box(0.1), frame, [s * 0.4, 1.1, -1.2], [0.1, 2.2, 0.1]));
  for (let i = 0; i < 5; i++) g.add(part(geo.box(0.1), frame, [0, 0.35 + i * 0.4, -1.2], [0.8, 0.07, 0.07]));
  g.add(part(geo.box(0.1), frame, [0, 2.15, -0.9], [1, 0.1, 0.7]));
  const ch = part(geo.box(0.15), chute, [0, 1.15, 0.6], [0.8, 0.1, 3.4], [0.62, 0, 0]);
  g.add(ch);
  for (const s of [-1, 1]) g.add(part(geo.box(0.1), chute, [s * 0.42, 1.28, 0.6], [0.08, 0.22, 3.4], [0.62, 0, 0]));
  return g;
}

export function doghouse(): THREE.Group {
  const g = new THREE.Group();
  const wall = mat(0xe8d6b8, { rough: 0.9 });
  const roof = mat(P.coral, { rough: 0.8 });
  g.add(part(geo.box(0.15), wall, [0, 1.1, 0], [2.6, 2.2, 2.6]));
  const r1 = part(geo.box(0.1), roof, [0.75, 2.55, 0], [1.9, 0.18, 3], [0, 0, -0.62]);
  const r2 = part(geo.box(0.1), roof, [-0.75, 2.55, 0], [1.9, 0.18, 3], [0, 0, 0.62]);
  g.add(r1, r2);
  g.add(part(geo.cyl(1, 1, 20), mat(0x4e4448, { rough: 1 }), [0, 0.85, 1.31], [0.65, 0.02, 0.8], [Math.PI / 2, 0, 0], false));
  // Name plate.
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fbf6ec';
  x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#5b4a40';
  x.font = '600 40px Fredoka, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('BISCUIT', 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  plate.position.set(0, 1.85, 1.32);
  g.add(plate);
  // Food bowl.
  g.add(part(geo.cyl(0.8, 1, 16), mat(P.teal), [1.8, 0.12, 1.4], [0.35, 0.22, 0.35]));
  return g;
}

export function lamp(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.cyl(1, 1, 8), mat(0x56666b, { rough: 0.6 }), [0, 1.4, 0], [0.06, 2.8, 0.06]));
  g.add(part(geo.sphere(12), mat(0xfbf3dc, { emissive: 0xf8e6b8, emissiveIntensity: 0.6 }), [0, 2.95, 0], 0.22));
  g.add(part(geo.cone(10), mat(0x56666b, { rough: 0.6 }), [0, 3.2, 0], [0.3, 0.2, 0.3]));
  return g;
}

export function bench(): THREE.Group {
  const g = new THREE.Group();
  const w = mat(P.wood, { rough: 0.85 });
  for (let i = 0; i < 3; i++) g.add(part(geo.box(0.2), w, [0, 0.48, -0.2 + i * 0.2], [1.8, 0.07, 0.17]));
  for (let i = 0; i < 2; i++) g.add(part(geo.box(0.2), w, [0, 0.8 + i * 0.2, -0.35], [1.8, 0.12, 0.06]));
  const leg = mat(0x56666b, { rough: 0.6 });
  for (const s of [-1, 1]) g.add(part(geo.box(0.2), leg, [s * 0.75, 0.3, 0], [0.08, 0.6, 0.6]));
  return g;
}

export function acornModel(): THREE.Group {
  const g = new THREE.Group();
  const gold = mat(0xf0cb6c, { rough: 0.35, metal: 0.15, emissive: 0xc79a3c, emissiveIntensity: 0.35 });
  const cap = mat(0xb98a4f, { rough: 0.6, emissive: 0x6b4a22, emissiveIntensity: 0.2 });
  g.add(part(geo.sphere(18), gold, [0, -0.05, 0], [0.24, 0.3, 0.24]));
  g.add(part(geo.sphere(18), cap, [0, 0.14, 0], [0.27, 0.14, 0.27]));
  g.add(part(geo.cyl(1, 1, 6), cap, [0, 0.3, 0], [0.03, 0.12, 0.03]));
  return g;
}

export function boingPedestal(): { group: THREE.Group; gun: THREE.Group } {
  const g = new THREE.Group();
  g.add(part(geo.cyl(0.85, 1, 20), mat(P.cream, { rough: 0.6 }), [0, 0.45, 0], [0.6, 0.9, 0.6]));
  g.add(part(geo.torus(0.12, Math.PI * 2, 24), mat(P.coral, { emissive: P.coral, emissiveIntensity: 0.25 }), [0, 0.92, 0], [0.62, 0.62, 0.62], [Math.PI / 2, 0, 0]));
  const gun = new THREE.Group();
  gun.position.y = 1.5;
  gun.add(part(geo.cyl(1, 1, 18), mat(0xf3ecdf, { rough: 0.5 }), [0, 0, 0], [0.16, 0.7, 0.16], [Math.PI / 2, 0, 0]));
  gun.add(part(geo.torus(0.3, Math.PI * 2, 18), mat(P.coral), [0, 0, 0.36], 0.17));
  gun.add(part(geo.cyl(1, 0.8, 14), mat(P.coral), [0, 0.2, -0.05], [0.12, 0.16, 0.12]));
  for (let i = 0; i < 3; i++) gun.add(part(geo.sphere(10), mat([0xf3ead8, 0xefcf7b, 0x9fc3d9][i]), [Math.cos(i * 2.1) * 0.05, 0.32, -0.05 + Math.sin(i * 2.1) * 0.05], 0.06));
  g.add(gun);
  return { group: g, gun };
}
