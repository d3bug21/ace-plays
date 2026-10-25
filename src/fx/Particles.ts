import * as THREE from 'three';
import { Rng } from '../core/math';

// Pooled CPU-simulated point particles with procedural shapes drawn in the
// fragment shader (soft dot, sparkle, ring, droplet, heart, snowflake-ish).
// Two pools: "soft" (normal blending) and "glow" (gentle additive).

export enum Shape {
  Dot = 0,
  Sparkle = 1,
  Ring = 2,
  Droplet = 3,
  Heart = 4,
  Note = 5,
}

const vert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aShape;
  attribute float aSpin;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying float vShape;
  varying float vSpin;
  varying vec3 vColor;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = aAlpha;
    vShape = aShape;
    vSpin = aSpin;
    vColor = aColor;
    #include <fog_vertex>
  }
`;

const frag = /* glsl */ `
  varying float vAlpha;
  varying float vShape;
  varying float vSpin;
  varying vec3 vColor;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    p.y = -p.y;
    float c = cos(vSpin), s = sin(vSpin);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float r = length(p);
    float a = 0.0;
    vec3 col = vColor;
    int shape = int(vShape + 0.5);
    if (shape == 0) {
      a = smoothstep(0.5, 0.05, r);
    } else if (shape == 1) {
      float star = max(0.0, 1.0 - abs(q.x) * abs(q.y) * 90.0) * smoothstep(0.5, 0.0, r);
      float core = smoothstep(0.18, 0.0, r);
      a = clamp(star * 0.9 + core, 0.0, 1.0);
      col = mix(col, vec3(1.0), core * 0.6);
    } else if (shape == 2) {
      a = smoothstep(0.07, 0.0, abs(r - 0.4)) * 0.9;
    } else if (shape == 3) {
      float ring = smoothstep(0.08, 0.0, abs(r - 0.36));
      float hl = smoothstep(0.12, 0.0, length(p - vec2(-0.13, 0.13)));
      a = clamp(ring * 0.7 + hl + smoothstep(0.4, 0.0, r) * 0.12, 0.0, 1.0);
      col = mix(col, vec3(1.0), hl);
    } else if (shape == 4) {
      vec2 h = q * 2.4;
      h.y -= 0.15;
      float k = pow(h.x * h.x + h.y * h.y - 0.3, 3.0) - h.x * h.x * h.y * h.y * h.y;
      a = 1.0 - smoothstep(-0.02, 0.02, k);
    } else {
      // little music note
      float head = smoothstep(0.14, 0.1, length((q - vec2(-0.08, -0.18)) * vec2(1.0, 1.4)));
      float stem = step(abs(q.x - 0.04), 0.03) * step(-0.18, q.y) * step(q.y, 0.3);
      float flag = step(abs(q.y - 0.26 + q.x * 0.6), 0.05) * step(0.04, q.x) * step(q.x, 0.22);
      a = max(head, max(stem, flag));
    }
    a *= vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

interface P {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  s0: number; s1: number;
  a0: number;
  r: number; g: number; b: number;
  grav: number; drag: number;
  shape: number;
  spin: number; spinV: number;
  wobble: number;
  fadeIn: number;
}

export interface EmitOptions {
  count?: number;
  color?: THREE.ColorRepresentation | THREE.ColorRepresentation[];
  speed?: number;
  speedJitter?: number;
  spread?: number; // 0..1 hemisphere/sphere mixing
  dir?: THREE.Vector3;
  life?: number;
  lifeJitter?: number;
  size?: number;
  sizeEnd?: number;
  sizeJitter?: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
  shape?: Shape;
  radius?: number;
  wobble?: number;
  spinSpeed?: number;
  fadeIn?: number;
}

export class ParticlePool {
  readonly points: THREE.Points;
  private parts: P[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private shape: Float32Array;
  private spin: Float32Array;
  private color: Float32Array;
  private cursor = 0;
  private rng = new Rng(77);
  private tmpC = new THREE.Color();
  readonly material: THREE.ShaderMaterial;

  constructor(capacity: number, additive: boolean) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.shape = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    for (let i = 0; i < capacity; i++) {
      this.parts.push({
        alive: false, x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0, s1: 0, a0: 1,
        r: 1, g: 1, b: 1, grav: 0, drag: 0, shape: 0, spin: 0, spinV: 0, wobble: 0, fadeIn: 0,
      });
      this.pos[i * 3 + 1] = -9999;
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 } }]),
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  setViewportHeight(h: number, fovDeg: number): void {
    // Pixel size for a 1-unit sprite at distance 1.
    this.material.uniforms.uScale.value = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(origin: THREE.Vector3, o: EmitOptions = {}): void {
    const count = o.count ?? 10;
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? 0xffffff];
    const rng = this.rng;
    for (let n = 0; n < count; n++) {
      const p = this.parts[this.cursor];
      this.cursor = (this.cursor + 1) % this.parts.length;
      // Random direction biased towards o.dir.
      let dx = rng.range(-1, 1), dy = rng.range(-1, 1), dz = rng.range(-1, 1);
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      if (o.dir) {
        const sp = o.spread ?? 0.5;
        dx = o.dir.x * (1 - sp) + dx * sp;
        dy = o.dir.y * (1 - sp) + dy * sp;
        dz = o.dir.z * (1 - sp) + dz * sp;
        const l2 = Math.hypot(dx, dy, dz) || 1;
        dx /= l2; dy /= l2; dz /= l2;
      }
      const speed = (o.speed ?? 2) * (1 + rng.range(-1, 1) * (o.speedJitter ?? 0.4));
      const rad = o.radius ?? 0;
      p.alive = true;
      p.x = origin.x + dx * rad * rng.next();
      p.y = origin.y + dy * rad * rng.next();
      p.z = origin.z + dz * rad * rng.next();
      p.vx = dx * speed; p.vy = dy * speed; p.vz = dz * speed;
      p.max = (o.life ?? 0.8) * (1 + rng.range(-1, 1) * (o.lifeJitter ?? 0.3));
      p.life = p.max;
      const sj = 1 + rng.range(-1, 1) * (o.sizeJitter ?? 0.3);
      p.s0 = (o.size ?? 0.15) * sj;
      p.s1 = (o.sizeEnd ?? (o.size ?? 0.15) * 0.3) * sj;
      p.a0 = o.alpha ?? 1;
      this.tmpC.set(colors[n % colors.length]);
      p.r = this.tmpC.r; p.g = this.tmpC.g; p.b = this.tmpC.b;
      p.grav = o.gravity ?? 0;
      p.drag = o.drag ?? 1.5;
      p.shape = o.shape ?? Shape.Dot;
      p.spin = rng.range(0, Math.PI * 2);
      p.spinV = rng.range(-1, 1) * (o.spinSpeed ?? 2);
      p.wobble = o.wobble ?? 0;
      p.fadeIn = o.fadeIn ?? 0.05;
    }
  }

  update(dt: number, time: number): void {
    const parts = this.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.alpha[i] = 0;
        this.pos[i * 3 + 1] = -9999;
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.vy -= p.grav * dt;
      if (p.wobble) {
        p.vx += Math.sin(time * 3 + i) * p.wobble * dt;
        p.vz += Math.cos(time * 2.6 + i * 1.3) * p.wobble * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.spin += p.spinV * dt;
      const t = 1 - p.life / p.max; // 0 -> 1
      const fin = p.fadeIn > 0 ? Math.min(1, t / p.fadeIn) : 1;
      const fout = Math.min(1, (p.life / p.max) / 0.35);
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.s0 + (p.s1 - p.s0) * t;
      this.alpha[i] = p.a0 * fin * fout;
      this.shape[i] = p.shape;
      this.spin[i] = p.spin;
      this.color[i * 3] = p.r; this.color[i * 3 + 1] = p.g; this.color[i * 3 + 2] = p.b;
    }
    const g = this.geo;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aShape as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSpin as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.parts.length; i++) {
      this.parts[i].alive = false;
      this.alpha[i] = 0;
      this.pos[i * 3 + 1] = -9999;
    }
  }
}

/** High-level, tasteful effect presets used by gameplay. */
export class Effects {
  readonly soft: ParticlePool;
  readonly glow: ParticlePool;
  readonly group = new THREE.Group();
  /** Global intensity multiplier (simple graphics lowers counts). */
  density = 1;
  underwater = false;

  constructor() {
    this.soft = new ParticlePool(2400, false);
    this.glow = new ParticlePool(1600, true);
    this.group.add(this.soft.points, this.glow.points);
  }

  private n(c: number): number {
    return Math.max(1, Math.round(c * this.density));
  }

  /** Crisp, delightful bubble pop: a quick ring, droplets and a few soft sparkles. */
  pop(pos: THREE.Vector3, scale = 1, tint: THREE.ColorRepresentation = 0xdff3f6): void {
    this.soft.emit(pos, { count: 1, shape: Shape.Ring, size: 0.5 * scale, sizeEnd: 1.5 * scale, life: 0.22, lifeJitter: 0, speed: 0, color: 0xffffff, alpha: 0.75, fadeIn: 0 });
    this.soft.emit(pos, { count: this.n(10 * scale), shape: Shape.Droplet, size: 0.11 * scale, sizeEnd: 0.05, speed: 3.2 * scale, life: 0.5, gravity: this.underwater ? -1 : 5, drag: 3, color: tint, radius: 0.3 * scale });
    this.glow.emit(pos, { count: this.n(5 * scale), shape: Shape.Sparkle, size: 0.22 * scale, sizeEnd: 0.02, speed: 1.6, life: 0.55, drag: 2.5, color: [0xfff4d6, 0xd8f1ff, 0xf6e1ff], alpha: 0.55, spinSpeed: 3 });
  }

  /** Soft sparkle shower (targets popping, items collected). */
  sparkle(pos: THREE.Vector3, count = 14, color: THREE.ColorRepresentation | THREE.ColorRepresentation[] = [0xffe7a8, 0xfff8e8], scale = 1): void {
    this.glow.emit(pos, { count: this.n(count), shape: Shape.Sparkle, size: 0.3 * scale, sizeEnd: 0.03, speed: 2.6 * scale, life: 0.9, drag: 2.2, gravity: this.underwater ? -0.3 : 0.6, color, alpha: 0.7, spinSpeed: 2.5, radius: 0.25 * scale });
    this.glow.emit(pos, { count: 1, shape: Shape.Dot, size: 1.3 * scale, sizeEnd: 0.2, speed: 0, life: 0.3, color: Array.isArray(color) ? color[0] : color, alpha: 0.35, fadeIn: 0 });
  }

  puff(pos: THREE.Vector3, color: THREE.ColorRepresentation = 0xe9dfcf, count = 8, scale = 1): void {
    this.soft.emit(pos, { count: this.n(count), shape: Shape.Dot, size: 0.45 * scale, sizeEnd: 0.9 * scale, speed: 1.4 * scale, life: 0.8, drag: 3, gravity: -0.4, color, alpha: 0.5, radius: 0.3 * scale, dir: new THREE.Vector3(0, 0.5, 0), spread: 0.9 });
  }

  splash(pos: THREE.Vector3, scale = 1): void {
    this.soft.emit(pos, { count: this.n(14 * scale), shape: Shape.Droplet, size: 0.12 * scale, sizeEnd: 0.06, speed: 3.6 * scale, life: 0.7, gravity: 9, drag: 1, color: 0xe3f4f7, dir: new THREE.Vector3(0, 1, 0), spread: 0.55 });
    this.soft.emit(pos, { count: 1, shape: Shape.Ring, size: 0.6 * scale, sizeEnd: 2.2 * scale, speed: 0, life: 0.45, lifeJitter: 0, color: 0xffffff, alpha: 0.5, fadeIn: 0 });
  }

  hearts(pos: THREE.Vector3, count = 3, color: THREE.ColorRepresentation = 0xf2a7a0): void {
    this.soft.emit(pos, { count: this.n(count), shape: Shape.Heart, size: 0.32, sizeEnd: 0.22, speed: 0.9, life: 1.4, drag: 1.5, gravity: -0.8, color, alpha: 0.9, dir: new THREE.Vector3(0, 1, 0), spread: 0.6, spinSpeed: 0.5, radius: 0.2, wobble: 0.6 });
  }

  notes(pos: THREE.Vector3, count = 3, color: THREE.ColorRepresentation = 0xf6e6b8): void {
    this.glow.emit(pos, { count: this.n(count), shape: Shape.Note, size: 0.55, sizeEnd: 0.4, speed: 1.0, life: 1.8, drag: 1.2, gravity: -0.6, color, alpha: 0.65, dir: new THREE.Vector3(0, 1, 0), spread: 0.7, spinSpeed: 0.4, radius: 0.3, wobble: 0.8 });
  }

  /** Restrained celebration burst for big moments. */
  celebrate(pos: THREE.Vector3, scale = 1): void {
    this.glow.emit(pos, { count: this.n(40 * scale), shape: Shape.Sparkle, size: 0.4 * scale, sizeEnd: 0.05, speed: 5 * scale, life: 1.4, drag: 1.8, gravity: this.underwater ? -0.3 : 1.2, color: [0xffe3a3, 0xcdeef5, 0xf3d5e2, 0xd9efc9], alpha: 0.7, spinSpeed: 3, radius: 0.5 });
    this.soft.emit(pos, { count: this.n(24 * scale), shape: Shape.Droplet, size: 0.25 * scale, sizeEnd: 0.18, speed: 3.5 * scale, life: 1.6, drag: 1.2, gravity: -0.6, color: 0xe8f6f8, wobble: 1, radius: 0.5 });
  }

  /** Single trail mote. */
  trail(pos: THREE.Vector3, color: THREE.ColorRepresentation, size = 0.08, life = 0.45, glow = false): void {
    (glow ? this.glow : this.soft).emit(pos, { count: 1, shape: glow ? Shape.Dot : Shape.Droplet, size, sizeEnd: size * 0.2, speed: 0.25, life, drag: 2, color, alpha: glow ? 0.5 : 0.6, gravity: this.underwater ? -0.6 : -0.15, fadeIn: 0 });
  }

  /** Tiny breath bubbles while swimming. */
  breath(pos: THREE.Vector3): void {
    this.soft.emit(pos, { count: this.n(4), shape: Shape.Droplet, size: 0.07, sizeEnd: 0.1, speed: 0.6, life: 1.8, drag: 1.2, gravity: -2.5, color: 0xe8f6f8, alpha: 0.7, dir: new THREE.Vector3(0, 1, 0), spread: 0.5, wobble: 1.2 });
  }

  update(dt: number, time: number): void {
    this.soft.update(dt, time);
    this.glow.update(dt, time);
  }

  setViewport(h: number, fov: number): void {
    this.soft.setViewportHeight(h, fov);
    this.glow.setViewportHeight(h, fov);
  }

  clear(): void {
    this.soft.clear();
    this.glow.clear();
  }
}
