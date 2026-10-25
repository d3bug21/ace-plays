import * as THREE from 'three';

export type ProjectileKind = 'bubble' | 'ball' | 'fizz' | 'glow' | 'bigBubble';

export interface HitInfo {
  kind: ProjectileKind;
  point: THREE.Vector3;
  /** Normalised travel direction of the projectile. */
  dir: THREE.Vector3;
  speed: number;
  /** 0..1 strength (fizz bubbles are light, big bubbles strong). */
  power: number;
}

/** What the projectile should do after hitting something. */
export type HitResponse = 'consume' | 'bounce' | 'stick' | 'pass';

export interface Hittable {
  /** World-space centre used for hit tests. */
  hitCenter(out: THREE.Vector3): THREE.Vector3;
  hitRadius: number;
  active: boolean;
  /** Optional filter. Return false to let the projectile pass through. */
  accepts?(kind: ProjectileKind): boolean;
  onHit(info: HitInfo): HitResponse;
  /** Aim assist weight (0 disables). Defaults to 1. */
  aimAssist?: number;
  /** Optional label shown near the crosshair when aimed at. */
  label?: string;
}

const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();

export class HitRegistry {
  readonly items: Hittable[] = [];

  add<T extends Hittable>(h: T): T {
    this.items.push(h);
    return h;
  }

  remove(h: Hittable): void {
    const i = this.items.indexOf(h);
    if (i >= 0) this.items.splice(i, 1);
  }

  clear(): void {
    this.items.length = 0;
  }

  /** First hittable overlapped by a sphere, with a generous radius bonus. */
  overlap(p: THREE.Vector3, r: number, kind: ProjectileKind, ignore?: Hittable | null): Hittable | null {
    let best: Hittable | null = null;
    let bestD = Infinity;
    for (const h of this.items) {
      if (!h.active || h === ignore) continue;
      if (h.accepts && !h.accepts(kind)) continue;
      h.hitCenter(tmpC);
      const d = tmpC.distanceTo(p) - h.hitRadius - r;
      if (d < 0 && d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  /**
   * Find the best target near the aim ray for gentle aim assist.
   * Returns the target and its centre or null.
   */
  aimTarget(origin: THREE.Vector3, dir: THREE.Vector3, kind: ProjectileKind | null, maxDist = 45, coneDeg = 7): { target: Hittable; center: THREE.Vector3; dist: number } | null {
    let best: Hittable | null = null;
    let bestScore = Infinity;
    const center = new THREE.Vector3();
    let bestDist = 0;
    for (const h of this.items) {
      if (!h.active) continue;
      if ((h.aimAssist ?? 1) <= 0) continue;
      if (kind && h.accepts && !h.accepts(kind)) continue;
      h.hitCenter(tmpC);
      tmpD.subVectors(tmpC, origin);
      const dist = tmpD.length();
      if (dist > maxDist || dist < 0.5) continue;
      const along = tmpD.dot(dir);
      if (along <= 0) continue;
      // Angle off the aim ray, reduced by the target's angular radius.
      const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
      const angRad = Math.atan2(perp, along) - Math.atan2(h.hitRadius, dist);
      const ang = (angRad * 180) / Math.PI;
      if (ang > coneDeg) continue;
      const score = Math.max(0, ang) + dist * 0.02;
      if (score < bestScore) {
        bestScore = score;
        best = h;
        center.copy(tmpC);
        bestDist = dist;
      }
    }
    return best ? { target: best, center, dist: bestDist } : null;
  }
}
