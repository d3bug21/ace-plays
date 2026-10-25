import * as THREE from 'three';
import { Stage, type StageContext, type StageEnvironment, type StageInfo, type ObjectiveDef } from './types';
import { mat } from '../kit/kit';

/** Temporary flat stage used until a world is built. */
export class PlaceholderStage extends Stage {
  readonly env: StageEnvironment = {
    sky: { top: '#9cc7d6', horizon: '#eae3d2', bottom: '#c9c2b0' },
    fog: { color: '#e3e2d6', density: 0.012 },
    hemi: { sky: '#f4f1e6', ground: '#8a9a80', intensity: 1.2 },
    sun: { color: '#fff1dc', intensity: 2.2, dir: [0.5, 1, 0.3], shadows: true },
    exposure: 1,
    bloom: { strength: 0.3, radius: 0.5, threshold: 0.85 },
  };
  readonly spawn = { pos: new THREE.Vector3(0, 0, 0), yaw: 0 };
  constructor(readonly info: StageInfo, readonly objectives: ObjectiveDef[]) {
    super();
  }
  build(ctx: StageContext): void {
    this.ctx = ctx;
    const g = new THREE.Mesh(new THREE.CircleGeometry(60, 48), mat('#a9c48f'));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    ctx.root.add(g);
  }
  update(): void {}
}
