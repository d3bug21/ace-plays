import * as THREE from 'three';
import { AceModel } from './AceModel';
import { bubbleGeometry, createBubbleMaterial } from '../fx/BubbleMaterial';
import { geo, mat, part } from '../kit/kit';
import { makeClouds } from '../fx/Environment';
import { Rng } from '../core/math';

export type MenuView = 'title' | 'results' | 'ending';

interface FloatBubble {
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  speed: number;
  phase: number;
}

/** Cosy diorama behind the title and results screens: Ace on a little hill with bubbles. */
export class MenuScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 800);
  readonly ace = new AceModel();
  private bubbles: FloatBubble[] = [];
  private view: MenuView = 'title';
  private skyMat: THREE.ShaderMaterial;
  private clouds: THREE.Group;
  private island = new THREE.Group();
  private t = 0;

  constructor() {
    const s = this.scene;
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color('#8fc0d6') }, uBottom: { value: new THREE.Color('#f5ead3') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(uBottom, uTop, smoothstep(-0.05, 0.6, h)); gl_FragColor = vec4(c,1.0); \n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n }',
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), this.skyMat));
    s.fog = new THREE.Fog(0xeee7d6, 60, 320);
    const hemi = new THREE.HemisphereLight(0xf6f1e4, 0x7d9a7a, 1.5);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(6, 10, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    sun.shadow.radius = 4;
    s.add(hemi, sun);

    // Grassy round hill with flowers, a tree and a fence.
    const grass = mat(0xa9c48f, { rough: 0.95 });
    const grassDark = mat(0x8fb07c, { rough: 0.95 });
    const hill = part(geo.sphere(48), grass, [0, -7.6, 0], [9, 8, 9]);
    hill.receiveShadow = true;
    this.island.add(hill);
    const rng = new Rng(9);
    const petals = [0xf3ecdf, 0xf0cb6c, 0xe7a99a, 0xc9d9e8];
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(1.2, 6);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = Math.sqrt(Math.max(0, 81 - x * x - z * z)) * (8 / 9) - 7.6;
      if (rng.chance(0.55)) {
        const f = new THREE.Group();
        f.add(part(geo.cyl(1, 1, 5), grassDark, [0, 0.12, 0], [0.015, 0.24, 0.015], [0, 0, 0], false));
        f.add(part(geo.sphere(8), mat(rng.pick(petals)), [0, 0.26, 0], [0.07, 0.05, 0.07], [0, 0, 0], false));
        f.add(part(geo.sphere(6), mat(0xf0cb6c), [0, 0.29, 0], 0.025, [0, 0, 0], false));
        f.position.set(x, y, z);
        this.island.add(f);
      } else {
        this.island.add(part(geo.cone(5), grassDark, [x, y + 0.1, z], [0.06, 0.25, 0.06], [rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)], false));
      }
    }
    // Tree.
    const tree = new THREE.Group();
    tree.add(part(geo.cyl(0.8, 1, 10), mat(0x9a7656), [0, 1.2, 0], [0.22, 2.4, 0.22]));
    const leaf = mat(0x86ad7c, { rough: 0.9 });
    const leaf2 = mat(0x9dbd8d, { rough: 0.9 });
    tree.add(part(geo.ico(1), leaf, [0, 3, 0], [1.4, 1.2, 1.4]));
    tree.add(part(geo.ico(1), leaf2, [0.8, 2.6, 0.4], [0.9, 0.8, 0.9]));
    tree.add(part(geo.ico(1), leaf2, [-0.7, 2.7, -0.3], [0.9, 0.85, 0.9]));
    tree.position.set(-5.2, -0.9, -3.2);
    this.island.add(tree);
    // Little fence arc.
    const wood = mat(0xd9c3a2, { rough: 0.9 });
    for (let i = 0; i < 7; i++) {
      const a = -0.4 + i * 0.22;
      const x = Math.sin(a) * 5.2 + 1.2;
      const z = -Math.cos(a) * 5.2 + 1.5;
      const y = Math.sqrt(Math.max(0, 81 - x * x - z * z)) * (8 / 9) - 7.6;
      this.island.add(part(geo.box(0.2), wood, [x, y + 0.35, z], [0.12, 0.75, 0.12]));
      if (i < 6) {
        const a2 = a + 0.11;
        const x2 = Math.sin(a2) * 5.2 + 1.2;
        const z2 = -Math.cos(a2) * 5.2 + 1.5;
        this.island.add(part(geo.box(0.2), wood, [x2, y + 0.45, z2], [0.08, 0.1, 1.15], [0, Math.PI / 2 - a2, 0]));
      }
    }
    s.add(this.island);

    this.ace.root.position.set(0, 0.38, 0);
    this.ace.root.scale.setScalar(1.25);
    this.ace.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    s.add(this.ace.root);

    // Floating bubbles.
    const bm = createBubbleMaterial({ wobble: 0.05 });
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(bubbleGeometry(), bm);
      const sz = rng.range(0.1, 0.32);
      mesh.scale.setScalar(sz);
      mesh.renderOrder = 5;
      const base = new THREE.Vector3(rng.range(-7, 7), rng.range(0.5, 6), rng.range(-5, 4));
      this.bubbles.push({ mesh, base, speed: rng.range(0.2, 0.5), phase: rng.range(0, 10) });
      s.add(mesh);
    }
    this.clouds = makeClouds(10, 120, 30, 0xffffff, 5);
    s.add(this.clouds);
    this.setView('title');
  }

  setView(v: MenuView, tint?: { top: string; bottom: string }): void {
    this.view = v;
    this.skyMat.uniforms.uTop.value.set(tint?.top ?? '#8fc0d6');
    this.skyMat.uniforms.uBottom.value.set(tint?.bottom ?? '#f5ead3');
    this.ace.setPose(v === 'title' ? 'wave' : v === 'ending' ? 'cheer' : 'thumbs');
  }

  setAcePose(p: Parameters<AceModel['setPose']>[0]): void {
    this.ace.setPose(p);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    this.ace.update(dt, t);
    for (const b of this.bubbles) {
      const y = ((b.base.y + t * b.speed) % 8) - 0.5;
      b.mesh.position.set(b.base.x + Math.sin(t * 0.6 + b.phase) * 0.6, y, b.base.z + Math.cos(t * 0.5 + b.phase) * 0.4);
    }
    this.clouds.rotation.y += dt * 0.004;
    const narrow = this.camera.aspect < 1;
    if (this.view === 'title') {
      const a = Math.sin(t * 0.08) * 0.12;
      const ox = narrow ? 0 : -1.7;
      this.camera.position.set(ox + Math.sin(a) * 7.2, 2.1, Math.cos(a) * 7.2);
      this.camera.lookAt(ox, narrow ? 0.85 : 1.6, 0);
      this.ace.root.rotation.y = Math.sin(t * 0.3) * 0.12 - 0.25;
    } else {
      // Results: Ace on the left third, panel on the right.
      const off = narrow ? 0 : 1.5;
      this.camera.position.set(off + 0.5, 1.7, 5.4);
      this.camera.lookAt(off, narrow ? 2.1 : 1.2, 0);
      this.ace.root.rotation.y = 0.35 + Math.sin(t * 0.7) * 0.06;
    }
  }
}
