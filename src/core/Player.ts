import * as THREE from 'three';
import { clamp, damp } from './math';
import type { Input } from './Input';
import type { PhysicsWorld } from './Physics';
import type { Settings } from './Save';

export type MoveMode = 'walk' | 'swim';

/**
 * Ace's first-person body. The camera frame is the single source of truth for
 * movement: W/ArrowUp go where Ace looks (flattened when walking, full 3D when
 * swimming) and A/D/ArrowLeft/ArrowRight strafe along the camera's own right
 * vector, so directions always match the screen in every mode and facing.
 */
export class Player {
  readonly position = new THREE.Vector3(); // feet position
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  mode: MoveMode = 'walk';
  onGround = true;
  readonly radius = 0.38;
  readonly height = 1.35;
  eyeHeight = 1.2; // Ace is a kid!
  walkSpeed = 5.4;
  swimSpeed = 4.6;
  jumpSpeed = 7.6;
  gravity = 21;
  /** Rise over run above which terrain blocks walking (about 58 degrees). */
  maxSlope = 1.6;
  /** Disable movement (cutscene moments) while still allowing look. */
  frozen = false;
  /** Extra external push (e.g. currents, bouncy pads). */
  readonly externalVel = new THREE.Vector3();

  private coyote = 0;
  private jumpBuffer = 0;
  private stepAcc = 0;
  private bobPhase = 0;
  bobAmount = 0;
  landKick = 0;
  swayX = 0;
  swayY = 0;
  private lastGroundY = 0;
  private fallStartY = 0;

  onJump: (() => void) | null = null;
  onLand: ((impact: number) => void) | null = null;
  onStep: (() => void) | null = null;
  onSwimStroke: (() => void) | null = null;
  private strokeAcc = 0;

  readonly camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
  }

  /** Teleport and clear all motion state. */
  spawn(pos: THREE.Vector3, yaw: number, pitch = 0): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.externalVel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.onGround = this.mode === 'walk';
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.bobAmount = 0;
    this.landKick = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.lastGroundY = pos.y;
    this.fallStartY = pos.y;
    this.syncCamera(0, false);
  }

  /** Forward direction Ace moves in. Flat when walking, view direction when swimming. */
  moveForward(out: THREE.Vector3): THREE.Vector3 {
    if (this.mode === 'swim') return this.viewForward(out);
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Camera view direction (includes pitch). */
  viewForward(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Camera right vector (always horizontal since the camera never rolls). */
  viewRight(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  look(input: Input, settings: Settings, dt: number): void {
    const base = 0.0022 * settings.sensitivity;
    const inv = settings.invertLook ? -1 : 1;
    this.yaw -= input.lookDX * base;
    this.pitch -= input.lookDY * base * inv;
    const limit = this.mode === 'swim' ? 1.45 : 1.48;
    this.pitch = clamp(this.pitch, -limit, limit);
    // Viewmodel sway follows look speed.
    this.swayX = damp(this.swayX, clamp(-input.lookDX * 0.0025, -0.06, 0.06), 10, dt);
    this.swayY = damp(this.swayY, clamp(input.lookDY * 0.0025, -0.05, 0.05), 10, dt);
  }

  update(dt: number, input: Input, world: PhysicsWorld, settings: Settings): void {
    const ax = this.frozen ? { x: 0, y: 0 } : input.moveAxes();
    const fwd = this.moveForward(new THREE.Vector3());
    const right = this.viewRight(new THREE.Vector3());
    const wish = new THREE.Vector3().addScaledVector(fwd, ax.y).addScaledVector(right, ax.x);

    if (this.mode === 'swim') {
      if (!this.frozen) {
        if (input.isDown('jump')) wish.y += 1;
        if (input.isDown('down')) wish.y -= 1;
      }
      if (wish.lengthSq() > 1) wish.normalize();
      wish.multiplyScalar(this.swimSpeed);
      const k = wish.lengthSq() > 0 ? 3.2 : 1.6; // gentle water drag
      this.velocity.x = damp(this.velocity.x, wish.x, k, dt);
      this.velocity.y = damp(this.velocity.y, wish.y, k, dt);
      this.velocity.z = damp(this.velocity.z, wish.z, k, dt);
      this.position.addScaledVector(this.velocity, dt);
      this.position.addScaledVector(this.externalVel, dt);
      this.externalVel.multiplyScalar(Math.exp(-2 * dt));
      // Stay above the seabed and below the surface.
      const floor = world.floorAt(this.position.x, this.position.z, this.position.y + 0.5) + 0.25;
      if (this.position.y < floor) {
        this.position.y = floor;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
      if (world.waterSurface !== null) {
        const top = world.waterSurface - this.eyeHeight - 0.35;
        if (this.position.y > top) {
          this.position.y = top;
          if (this.velocity.y > 0) this.velocity.y = 0;
        }
      }
      if (world.ceiling) {
        const top = world.ceiling(this.position.x, this.position.z) - this.height - 0.2;
        if (this.position.y > top) {
          this.position.y = top;
          if (this.velocity.y > 0) this.velocity.y = 0;
        }
      }
      world.resolveBody(this.position, this.radius, this.height, 0.05);
      const sp = this.velocity.length();
      this.bobPhase += dt * (1.2 + sp * 0.4);
      this.bobAmount = damp(this.bobAmount, Math.min(1, sp / this.swimSpeed), 4, dt);
      this.strokeAcc += sp * dt;
      if (this.strokeAcc > 2.6) {
        this.strokeAcc = 0;
        if (this.onSwimStroke) this.onSwimStroke();
      }
      this.onGround = false;
      this.syncCamera(dt, settings.headBob);
      return;
    }

    // --- Walking ---
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(this.walkSpeed);
    const accel = this.onGround ? 14 : 5;
    this.velocity.x = damp(this.velocity.x, wish.x, accel, dt);
    this.velocity.z = damp(this.velocity.z, wish.z, accel, dt);

    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    if (!this.frozen && input.wasPressed('jump')) this.jumpBuffer = 0.16;
    if (this.jumpBuffer > 0 && (this.onGround || this.coyote > 0)) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.fallStartY = this.position.y;
      if (this.onJump) this.onJump();
    }
    // Slightly floaty fall at the apex makes jumping feel kind.
    const g = this.velocity.y > 0 && input.isDown('jump') ? this.gravity * 0.82 : this.gravity;
    this.velocity.y -= g * dt;
    this.velocity.y = Math.max(this.velocity.y, -30);

    const prevX = this.position.x;
    const prevZ = this.position.z;
    this.position.x += (this.velocity.x + this.externalVel.x) * dt;
    this.position.z += (this.velocity.z + this.externalVel.z) * dt;
    this.position.y += (this.velocity.y + this.externalVel.y) * dt;
    this.externalVel.multiplyScalar(Math.exp(-3 * dt));

    // Kind slope limit: very steep cliffs act like walls (walk along them instead).
    const hPrev = world.groundHeight(prevX, prevZ);
    const hNew = world.groundHeight(this.position.x, this.position.z);
    const run = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    if (run > 1e-5 && hNew - hPrev > run * this.maxSlope && hNew > this.position.y + 0.25) {
      // Try sliding along each axis before giving up.
      const hx = world.groundHeight(this.position.x, prevZ);
      const hz = world.groundHeight(prevX, this.position.z);
      if (hx - hPrev <= Math.abs(this.position.x - prevX) * this.maxSlope) this.position.z = prevZ;
      else if (hz - hPrev <= Math.abs(this.position.z - prevZ) * this.maxSlope) this.position.x = prevX;
      else {
        this.position.x = prevX;
        this.position.z = prevZ;
      }
    }
    world.resolveBody(this.position, this.radius, this.height, 0.45);
    const floor = world.floorAt(this.position.x, this.position.z, this.position.y + 0.55);
    const wasGround = this.onGround;
    if (this.position.y <= floor + 0.001 || (wasGround && this.velocity.y <= 0 && this.position.y - floor < 0.35)) {
      const impact = -this.velocity.y;
      this.position.y = floor;
      if (this.velocity.y < 0) this.velocity.y = 0;
      if (!wasGround) {
        const fell = this.fallStartY - floor;
        if (this.onLand) this.onLand(Math.max(impact, fell * 2));
        this.landKick = Math.min(1, impact / 14);
      }
      this.onGround = true;
      this.coyote = 0.12;
      this.lastGroundY = floor;
    } else {
      if (wasGround) {
        this.coyote = 0.12;
        this.fallStartY = this.position.y;
      }
      this.onGround = false;
    }
    if (world.ceiling) {
      const top = world.ceiling(this.position.x, this.position.z) - this.height;
      if (this.position.y > top) {
        this.position.y = top;
        if (this.velocity.y > 0) this.velocity.y = 0;
      }
    }

    // Footsteps + head bob.
    const moved = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    const speed = moved / Math.max(dt, 1e-4);
    if (this.onGround && speed > 0.5) {
      this.bobPhase += dt * (6 + speed * 1.1);
      this.stepAcc += moved;
      if (this.stepAcc > 1.55) {
        this.stepAcc = 0;
        if (this.onStep) this.onStep();
      }
    }
    this.bobAmount = damp(this.bobAmount, this.onGround ? Math.min(1, speed / this.walkSpeed) : 0, 8, dt);
    this.landKick = damp(this.landKick, 0, 7, dt);
    this.syncCamera(dt, settings.headBob);
  }

  /** Position the camera from the body. Only cosmetic offsets are added here. */
  syncCamera(_dt: number, headBob: boolean): void {
    const cam = this.camera;
    let bobY = 0;
    let bobX = 0;
    if (headBob) {
      const amt = this.mode === 'swim' ? 0.05 : 0.045;
      bobY = Math.sin(this.bobPhase * 2) * amt * this.bobAmount - this.landKick * 0.12;
      bobX = Math.cos(this.bobPhase) * amt * 0.6 * this.bobAmount;
      if (this.mode === 'swim') bobY += Math.sin(performance.now() * 0.0012) * 0.04;
    }
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    cam.position.set(
      this.position.x + rx * bobX,
      this.position.y + this.eyeHeight + bobY,
      this.position.z + rz * bobX,
    );
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  bobOffset(): { x: number; y: number } {
    return {
      x: Math.cos(this.bobPhase) * 0.012 * this.bobAmount,
      y: Math.abs(Math.sin(this.bobPhase)) * 0.014 * this.bobAmount + this.landKick * 0.03,
    };
  }
}
