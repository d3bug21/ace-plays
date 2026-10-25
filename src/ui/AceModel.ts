import * as THREE from 'three';
import { Face, geo, mat, part } from '../kit/kit';
import { damp } from '../core/math';

export type AcePose = 'idle' | 'wave' | 'cheer' | 'thumbs' | 'jump' | 'think';

const SKIN = 0xeec4a2;
const HOODIE = 0xe2b45e;
const HOODIE_DARK = 0xc99b48;
const CREAM = 0xf6efe2;
const SHORTS = 0x3f5a6a;
const CAP = 0x5f9f99;
const HAIR = 0x7a4f34;
const SHOE = 0xf3eee5;

/** Ace: a cheerful kid adventurer built from soft rounded shapes. */
export class AceModel {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private foreL = new THREE.Group();
  private foreR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  readonly face: Face;
  pose: AcePose = 'idle';
  private poseT = 0;
  private wand: THREE.Group;

  constructor() {
    const skin = mat(SKIN, { rough: 0.7 });
    const hoodie = mat(HOODIE, { rough: 0.9 });
    const hoodieDark = mat(HOODIE_DARK, { rough: 0.9 });
    const cream = mat(CREAM, { rough: 0.85 });
    const shorts = mat(SHORTS, { rough: 0.85 });
    const cap = mat(CAP, { rough: 0.7 });
    const hair = mat(HAIR, { rough: 0.85 });
    const shoe = mat(SHOE, { rough: 0.6 });
    const sole = mat(CAP, { rough: 0.6 });

    this.root.add(this.hips);
    this.hips.position.y = 0.52;
    // Legs.
    for (const [leg, side] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(side * 0.1, 0, 0);
      leg.add(part(geo.capsule(1), shorts, [0, -0.08, 0], [0.09, 0.07, 0.095]));
      leg.add(part(geo.capsule(1), skin, [0, -0.28, 0], [0.052, 0.075, 0.052]));
      leg.add(part(geo.cyl(1, 1, 12), cream, [0, -0.39, 0], [0.056, 0.05, 0.056]));
      leg.add(part(geo.box(0.4), shoe, [0, -0.46, 0.04], [0.13, 0.09, 0.22]));
      leg.add(part(geo.box(0.3), sole, [0, -0.5, 0.04], [0.135, 0.03, 0.225]));
      this.hips.add(leg);
    }
    // Torso (hoodie).
    this.torso.position.y = 0.05;
    this.hips.add(this.torso);
    this.torso.add(part(geo.capsule(0.6), hoodie, [0, 0.17, 0], [0.19, 0.17, 0.15]));
    this.torso.add(part(geo.cyl(1, 1, 20), hoodieDark, [0, -0.02, 0], [0.19, 0.05, 0.155]));
    this.torso.add(part(geo.box(0.4), hoodieDark, [0, 0.08, 0.13], [0.2, 0.09, 0.04])); // pocket
    this.torso.add(part(geo.cyl(1, 1, 6), cream, [-0.04, 0.27, 0.14], [0.008, 0.1, 0.008], [0.15, 0, 0]));
    this.torso.add(part(geo.cyl(1, 1, 6), cream, [0.04, 0.27, 0.14], [0.008, 0.1, 0.008], [0.15, 0, 0]));
    // Soft hood folded behind the neck + a little neck.
    this.torso.add(part(geo.sphere(16), hoodieDark, [0, 0.36, -0.1], [0.15, 0.08, 0.09]));
    this.torso.add(part(geo.cyl(1, 1, 12), skin, [0, 0.4, 0], [0.07, 0.08, 0.07]));
    // Arms.
    for (const [arm, fore, side] of [[this.armL, this.foreL, -1], [this.armR, this.foreR, 1]] as const) {
      arm.position.set(side * 0.22, 0.34, 0);
      arm.add(part(geo.capsule(1), hoodie, [0, -0.09, 0], [0.06, 0.06, 0.06]));
      fore.position.set(0, -0.17, 0);
      fore.add(part(geo.sphere(14), hoodie, [0, 0, 0], 0.058));
      fore.add(part(geo.capsule(1), hoodie, [0, -0.065, 0], [0.054, 0.045, 0.054]));
      fore.add(part(geo.cyl(1, 1, 12), cream, [0, -0.14, 0], [0.058, 0.03, 0.058]));
      fore.add(part(geo.sphere(14), skin, [0, -0.2, 0], [0.055, 0.06, 0.05]));
      arm.add(fore);
      this.torso.add(arm);
    }
    // Bubble wand in the right hand.
    this.wand = new THREE.Group();
    this.wand.add(part(geo.cyl(1, 1, 8), mat(CAP), [0, 0.1, 0], [0.012, 0.25, 0.012]));
    this.wand.add(part(geo.torus(0.18, Math.PI * 2, 20), mat(CAP), [0, 0.27, 0], 0.06));
    this.wand.position.set(0, -0.2, 0.02);
    this.foreR.add(this.wand);

    // Head.
    this.head.position.y = 0.5;
    this.torso.add(this.head);
    this.head.add(part(geo.sphere(28), skin, [0, 0.16, 0], [0.24, 0.23, 0.22]));
    this.head.add(part(geo.sphere(12), skin, [-0.235, 0.15, 0], [0.04, 0.055, 0.035]));
    this.head.add(part(geo.sphere(12), skin, [0.235, 0.15, 0], [0.04, 0.055, 0.035]));
    // Hair tufts peeking out under the cap.
    for (let i = 0; i < 7; i++) {
      const a = -1.4 + i * 0.45;
      this.head.add(part(geo.sphere(10), hair, [Math.sin(a) * 0.21, 0.27 - Math.abs(a) * 0.03, Math.cos(a) * 0.13 + 0.03], [0.07, 0.05, 0.06], [0.3, a, 0]));
    }
    this.head.add(part(geo.sphere(12), hair, [0, 0.2, -0.17], [0.19, 0.17, 0.1]));
    // Cap worn a little tilted, brim forward.
    this.head.add(part(geo.sphere(24), cap, [0, 0.27, -0.01], [0.245, 0.15, 0.235]));
    this.head.add(part(geo.cyl(1, 1, 24), cap, [0, 0.26, 0.19], [0.16, 0.022, 0.13], [0.08, 0, 0]));
    this.head.add(part(geo.sphere(8), mat(CREAM), [0, 0.415, -0.01], 0.025));
    // Face.
    this.face = new Face({ eyeSize: 0.055, spacing: 0.15, eyeY: 0.16, eyeZ: 0.185, smileY: 0.065, smileWidth: 0.055, blush: 0xe9a79a, lidColor: SKIN });
    this.head.add(this.face.group);
    // Freckles.
    const freck = mat(0xc98f6c, { rough: 0.9 });
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) this.head.add(part(geo.sphere(6), freck, [s * (0.08 + i * 0.018), 0.105 + (i % 2) * 0.012, 0.205], 0.007, [0, 0, 0], false));
    this.head.add(part(geo.sphere(10), skin, [0, 0.12, 0.215], [0.028, 0.022, 0.02]));
  }

  setPose(p: AcePose): void {
    if (p !== this.pose) {
      this.pose = p;
      this.poseT = 0;
      if (p === 'cheer' || p === 'jump' || p === 'thumbs') this.face.beam(1.6);
    }
  }

  update(dt: number, t: number): void {
    this.poseT += dt;
    this.face.update(dt);
    const p = this.pose;
    let hipY = 0.52;
    let armLx = 0.1, armLz = -0.15, armRx = 0.1, armRz = 0.15, foreL = -0.2, foreR = -0.3;
    let headTilt = Math.sin(t * 1.3) * 0.05;
    let torsoLean = 0;
    const breathe = Math.sin(t * 2.2) * 0.008;
    if (p === 'idle') {
      armRx = -0.5;
      foreR = -0.9;
      hipY += breathe;
    } else if (p === 'wave') {
      armRz = 2.5 + Math.sin(t * 9) * 0.25;
      armRx = 0;
      foreR = -0.5 + Math.sin(t * 9) * 0.3;
      headTilt = 0.12;
    } else if (p === 'cheer' || p === 'jump') {
      const jump = Math.abs(Math.sin(t * 5.5));
      hipY += jump * 0.16;
      armLz = -2.6 - Math.sin(t * 11) * 0.15;
      armRz = 2.6 + Math.sin(t * 11) * 0.15;
      armLx = armRx = 0;
      foreL = foreR = -0.15;
      headTilt = Math.sin(t * 5.5) * 0.1;
    } else if (p === 'thumbs') {
      armRx = -1.3;
      armRz = 0.4;
      foreR = -1.2;
      hipY += Math.abs(Math.sin(t * 3)) * 0.04;
      headTilt = 0.15;
      torsoLean = -0.06;
    } else if (p === 'think') {
      armRx = -1.6;
      foreR = -2.1;
      headTilt = 0.22;
    }
    const k = 12;
    this.hips.position.y = damp(this.hips.position.y, hipY, k, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, armLx, k, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, armLz, k, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, armRx, k, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, armRz, k, dt);
    this.foreL.rotation.x = damp(this.foreL.rotation.x, foreL, k, dt);
    this.foreR.rotation.x = damp(this.foreR.rotation.x, foreR, k, dt);
    this.head.rotation.z = damp(this.head.rotation.z, headTilt, 6, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, torsoLean, 6, dt);
    const swing = p === 'cheer' || p === 'jump' ? Math.sin(t * 11) * 0.25 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
  }
}
