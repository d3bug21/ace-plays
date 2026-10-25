import * as THREE from 'three';

// Lightweight collision world shared by Ace, bouncy balls and bubbles.
// Stages describe their solid shapes with a ground height function plus simple
// primitives. Everything is analytic so it is cheap and deterministic.

export interface CylinderCollider {
  kind: 'cylinder';
  x: number;
  z: number;
  r: number;
  yMin: number;
  yMax: number;
  /** Optional tag so projectiles can react (e.g. 'bell', 'tree'). */
  tag?: string;
  bounciness?: number;
  enabled?: boolean;
}

export interface SphereCollider {
  kind: 'sphere';
  center: THREE.Vector3;
  r: number;
  tag?: string;
  bounciness?: number;
  enabled?: boolean;
}

export interface BoxCollider {
  kind: 'box';
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Players can stand on top of walkable boxes. */
  walkable?: boolean;
  tag?: string;
  bounciness?: number;
  enabled?: boolean;
}

export type Collider = CylinderCollider | SphereCollider | BoxCollider;

export interface ContactResult {
  hit: boolean;
  normal: THREE.Vector3;
  depth: number;
  collider: Collider | null;
  ground: boolean;
}

const tmpN = new THREE.Vector3();

export class PhysicsWorld {
  colliders: Collider[] = [];
  /** Ground height at a world XZ position. */
  groundHeight: (x: number, z: number) => number = () => 0;
  /** Optional water surface height; null for dry stages. Underwater stages clamp swimming below it. */
  waterSurface: number | null = null;
  /** Keep everything inside a soft circular playfield. */
  boundsCenter = new THREE.Vector2(0, 0);
  boundsRadius = 60;
  /** Optional extra boundary check: return true when (x, z) is allowed. */
  allowed: ((x: number, z: number) => boolean) | null = null;
  /** Optional ceiling (e.g. caves). */
  ceiling: ((x: number, z: number) => number) | null = null;

  add<T extends Collider>(c: T): T {
    this.colliders.push(c);
    return c;
  }

  remove(c: Collider): void {
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
  }

  clear(): void {
    this.colliders.length = 0;
    this.groundHeight = () => 0;
    this.waterSurface = null;
    this.allowed = null;
    this.ceiling = null;
    this.boundsCenter.set(0, 0);
    this.boundsRadius = 60;
  }

  groundNormal(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.15;
    const hx = this.groundHeight(x + e, z) - this.groundHeight(x - e, z);
    const hz = this.groundHeight(x, z + e) - this.groundHeight(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** Highest walkable surface at (x, z) that is not above `maxY`. */
  floorAt(x: number, z: number, maxY: number): number {
    let h = this.groundHeight(x, z);
    for (const c of this.colliders) {
      if (c.kind !== 'box' || !c.walkable || c.enabled === false) continue;
      if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z && c.max.y <= maxY && c.max.y > h) h = c.max.y;
    }
    return h;
  }

  /**
   * Push a vertical capsule-ish body (feet at pos.y, given height) out of colliders horizontally.
   * Returns true when something was hit.
   */
  resolveBody(pos: THREE.Vector3, radius: number, height: number, stepHeight: number): boolean {
    let hit = false;
    for (const c of this.colliders) {
      if (c.enabled === false) continue;
      if (c.kind === 'cylinder') {
        if (pos.y + height < c.yMin || pos.y + stepHeight > c.yMax) continue;
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const d2 = dx * dx + dz * dz;
        const min = c.r + radius;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 0.0001;
          pos.x = c.x + (dx / d) * min;
          pos.z = c.z + (dz / d) * min;
          hit = true;
        }
      } else if (c.kind === 'box') {
        if (pos.y + height < c.min.y || pos.y + stepHeight >= c.max.y) continue;
        const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
        const cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < radius * radius) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            pos.x = cx + (dx / d) * radius;
            pos.z = cz + (dz / d) * radius;
          } else {
            // Center inside the box: push along the shallowest axis.
            const pushes = [
              { a: 'x', v: c.min.x - radius, d: pos.x - (c.min.x - radius) },
              { a: 'x', v: c.max.x + radius, d: c.max.x + radius - pos.x },
              { a: 'z', v: c.min.z - radius, d: pos.z - (c.min.z - radius) },
              { a: 'z', v: c.max.z + radius, d: c.max.z + radius - pos.z },
            ].sort((p, q) => Math.abs(p.d) - Math.abs(q.d));
            const p = pushes[0];
            if (p.a === 'x') pos.x = p.v;
            else pos.z = p.v;
          }
          hit = true;
        }
      } else {
        // Sphere: treat body as a vertical segment.
        const cy = Math.max(pos.y + radius, Math.min(c.center.y, pos.y + height - radius));
        tmpN.set(pos.x - c.center.x, cy - c.center.y, pos.z - c.center.z);
        const d = tmpN.length();
        const min = c.r + radius;
        if (d < min) {
          const n = d > 1e-6 ? tmpN.multiplyScalar(1 / d) : tmpN.set(1, 0, 0);
          const push = min - d;
          pos.x += n.x * push;
          pos.z += n.z * push;
          if (n.y > 0.6) pos.y += n.y * push; // standing on top of a big boulder
          hit = true;
        }
      }
    }
    this.clampBounds(pos, radius);
    return hit;
  }

  clampBounds(pos: THREE.Vector3, radius = 0): boolean {
    const dx = pos.x - this.boundsCenter.x;
    const dz = pos.z - this.boundsCenter.y;
    const max = this.boundsRadius - radius;
    const d2 = dx * dx + dz * dz;
    let clamped = false;
    if (d2 > max * max) {
      const d = Math.sqrt(d2);
      pos.x = this.boundsCenter.x + (dx / d) * max;
      pos.z = this.boundsCenter.y + (dz / d) * max;
      clamped = true;
    }
    return clamped;
  }

  /** Sphere contact against ground + colliders (for balls and bubbles). */
  sphereContact(p: THREE.Vector3, r: number, out: ContactResult): ContactResult {
    out.hit = false;
    out.depth = 0;
    out.collider = null;
    out.ground = false;
    const gh = this.groundHeight(p.x, p.z);
    if (p.y - r < gh) {
      out.hit = true;
      out.ground = true;
      this.groundNormal(p.x, p.z, out.normal);
      out.depth = (gh - (p.y - r)) * out.normal.y;
    }
    for (const c of this.colliders) {
      if (c.enabled === false) continue;
      let depth = 0;
      if (c.kind === 'sphere') {
        tmpN.subVectors(p, c.center);
        const d = tmpN.length();
        if (d < c.r + r) {
          depth = c.r + r - d;
          if (depth > out.depth) {
            out.normal.copy(d > 1e-6 ? tmpN.multiplyScalar(1 / d) : tmpN.set(0, 1, 0));
            out.depth = depth;
            out.hit = true;
            out.collider = c;
            out.ground = out.normal.y > 0.7;
          }
        }
      } else if (c.kind === 'cylinder') {
        if (p.y + r < c.yMin || p.y - r > c.yMax) continue;
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < c.r + r) {
          // Top cap or side?
          const topDepth = c.yMax - (p.y - r);
          const sideDepth = c.r + r - d;
          if (topDepth < sideDepth && p.y > c.yMax - 0.05) {
            depth = topDepth;
            if (depth > out.depth) {
              out.normal.set(0, 1, 0);
              out.depth = depth;
              out.hit = true;
              out.collider = c;
              out.ground = true;
            }
          } else {
            depth = sideDepth;
            if (depth > out.depth) {
              out.normal.set(d > 1e-6 ? dx / d : 1, 0, d > 1e-6 ? dz / d : 0);
              out.depth = depth;
              out.hit = true;
              out.collider = c;
              out.ground = false;
            }
          }
        }
      } else {
        const cx = Math.max(c.min.x, Math.min(p.x, c.max.x));
        const cy = Math.max(c.min.y, Math.min(p.y, c.max.y));
        const cz = Math.max(c.min.z, Math.min(p.z, c.max.z));
        tmpN.set(p.x - cx, p.y - cy, p.z - cz);
        const d = tmpN.length();
        if (d < r) {
          depth = r - d;
          if (depth > out.depth) {
            if (d > 1e-6) out.normal.copy(tmpN.multiplyScalar(1 / d));
            else out.normal.set(0, 1, 0);
            out.depth = depth;
            out.hit = true;
            out.collider = c;
            out.ground = out.normal.y > 0.7;
          }
        }
      }
    }
    return out;
  }
}
