import * as THREE from 'three';
import { clamp, lerp } from '../world/noise';
import type { Terrain } from '../world/terrain';
import type { Rider } from './rider';
import type { CamMode } from '../state/store';

const UP = new THREE.Vector3(0, 1, 0);

export interface RigInput {
  mode: CamMode;
  photo: boolean;
  /** mouse-aim direction while flying with a locked pointer */
  aim: THREE.Vector3 | null;
  dragging: boolean;
  idle: boolean;
}

/** Follows the selected rider in several styles with spring smoothing, bank, speed FOV and shake. */
export class CameraRig {
  snap = true;
  lookYaw = 0;
  lookPitch = 0;
  orbitYaw = 0;
  orbitPitch = 0.25;
  orbitDist = 34;
  chaseDist = 34;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private upv = new THREE.Vector3(0, 1, 0);
  private shot = 0;
  private shotT = 0;
  private shotPos = new THREE.Vector3();
  private qFlip = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
  private t = 0;

  constructor(private unocclude: (from: THREE.Vector3, to: THREE.Vector3) => void) {}

  zoom(deltaY: number) {
    this.orbitDist = clamp(this.orbitDist * (1 + deltaY * 0.001), 12, 220);
    this.chaseDist = clamp(this.chaseDist * (1 + deltaY * 0.001), 10, 90);
  }

  drag(dx: number, dy: number, mode: CamMode) {
    if (mode === 'orbit' || mode === 'drone') { this.orbitYaw -= dx * 0.006; this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, -0.4, 1.4); }
    else { this.lookYaw -= dx * 0.005; this.lookPitch = clamp(this.lookPitch - dy * 0.004, -0.8, 0.8); }
  }

  update(dt: number, cam: THREE.PerspectiveCamera, r: Rider, T: Terrain, inp: RigInput) {
    this.t += dt;
    let mode = inp.mode;
    if (inp.photo) mode = 'cinema';
    if (inp.idle && !inp.dragging) { this.lookYaw *= 1 - dt * 1.2; this.lookPitch *= 1 - dt * 1.2; }
    const flat = new THREE.Vector3(r.fwd.x, 0, r.fwd.z).normalize();
    const right = new THREE.Vector3().crossVectors(flat, UP).normalize();
    const speedK = clamp((r.speed - 25) / 60, 0, 1);
    let fov = 60, kPos = 5, kLook = 10, roll = 0;
    const pos = new THREE.Vector3(), look = new THREE.Vector3();

    if (mode === 'seat') {
      r.root.updateMatrixWorld(true);
      r.head.getWorldPosition(pos);
      cam.position.copy(pos);
      cam.quaternion.copy(r.root.quaternion).multiply(this.qFlip);
      cam.rotateY(this.lookYaw);
      cam.rotateX(-0.08 + this.lookPitch);
      cam.fov = lerp(cam.fov, 74 + speedK * 16 + r.tuck * 6, 0.1);
      cam.updateProjectionMatrix();
      this.pos.copy(pos);
      this.look.copy(pos).addScaledVector(r.fwd, 10);
      this.snap = false;
      return;
    }

    if (mode === 'chase') {
      // follow the aim when flying with the mouse, otherwise the flight path with a capped pitch
      const base = inp.aim ? inp.aim.clone() : r.fwd.clone();
      const p = clamp(Math.asin(clamp(base.y, -1, 1)) * 0.7, -0.6, 0.6), yw = Math.atan2(base.x, base.z) + this.lookYaw;
      const dir = new THREE.Vector3(Math.sin(yw) * Math.cos(p), Math.sin(p), Math.cos(yw) * Math.cos(p));
      const dist = this.chaseDist * (1 + speedK * 0.25);
      pos.copy(r.pos).addScaledVector(dir, -dist).add(new THREE.Vector3(0, dist * 0.3 + this.lookPitch * 22, 0));
      look.copy(r.pos).addScaledVector(dir, inp.aim ? 40 : 14).add(new THREE.Vector3(0, 2.5, 0));
      fov = 60 + speedK * 20 + r.tuck * 6;
      roll = (r.roll + r.trickRoll * 0.15) * 0.3;
      kPos = 6; kLook = 12;
    } else if (mode === 'drone') {
      const yw = Math.atan2(flat.x, flat.z) + this.orbitYaw;
      const back = new THREE.Vector3(Math.sin(yw), 0, Math.cos(yw));
      const h = 55 + this.orbitPitch * 60;
      pos.copy(r.pos).addScaledVector(back, -110).add(new THREE.Vector3(0, h, 0));
      look.copy(r.pos).addScaledVector(back, 50);
      fov = 50; kPos = 1.6; kLook = 3;
    } else if (mode === 'orbit') {
      if (inp.idle && !inp.dragging) this.orbitYaw += dt * 0.12;
      const yaw = Math.atan2(r.fwd.x, r.fwd.z) + Math.PI + this.orbitYaw;
      pos.set(Math.sin(yaw) * Math.cos(this.orbitPitch), Math.sin(this.orbitPitch), Math.cos(yaw) * Math.cos(this.orbitPitch)).multiplyScalar(this.orbitDist).add(r.pos);
      look.copy(r.pos);
      kPos = 6;
    } else {
      const slow = inp.photo ? 1.6 : 1;
      this.shotT -= dt;
      if (this.shotT <= 0) {
        this.shot = (this.shot + 1) % 6;
        this.shotT = (6 + Math.random() * 4) * slow;
        const side = Math.random() < 0.5 ? -1 : 1;
        if (this.shot === 1) this.shotPos.copy(r.pos).addScaledVector(r.fwd, r.speed * 4.5).addScaledVector(right, side * 30).add(new THREE.Vector3(0, -6, 0));
        if (this.shot === 2) this.shotPos.copy(r.pos).addScaledVector(flat, -70).addScaledVector(right, -90).add(new THREE.Vector3(0, 70, 0));
        if (this.shot === 4) {
          const ahead = r.pos.clone().addScaledVector(flat, r.speed * 5).addScaledVector(right, side * 22);
          this.shotPos.set(ahead.x, Math.max(T.surface(ahead.x, ahead.z) + 3, r.pos.y - 70), ahead.z);
        }
        this.snap = true;
      }
      switch (this.shot) {
        case 0: pos.copy(r.pos).addScaledVector(right, 26).addScaledVector(flat, -4).add(new THREE.Vector3(0, 3, 0)); look.copy(r.pos); fov = 40; kPos = 4; break;
        case 1: pos.copy(this.shotPos); look.copy(r.pos); fov = lerp(48, 28, clamp(1 - r.pos.distanceTo(this.shotPos) / 200, 0, 1)); kPos = 50; break;
        case 2: this.shotPos.addScaledVector(flat, r.speed * 0.85 * dt); pos.copy(this.shotPos); look.copy(r.pos); fov = 34; kPos = 50; break;
        case 3: pos.copy(r.pos).addScaledVector(r.fwd, 15).add(new THREE.Vector3(0, 3.5, 0)).addScaledVector(right, 4); look.copy(r.pos).add(new THREE.Vector3(0, 1.5, 0)); fov = 55; kPos = 5; break;
        case 4: pos.copy(this.shotPos); look.copy(r.pos); fov = 44; kPos = 50; break;
        default: pos.copy(r.pos).add(new THREE.Vector3(0, 90, 0)).addScaledVector(flat, -20); look.copy(r.pos).addScaledVector(flat, 25); fov = 52; kPos = 3; break;
      }
    }

    if (mode !== 'cinema' || this.shot === 0 || this.shot === 3) this.unocclude(r.pos, pos);
    const minY = T.surface(pos.x, pos.z) + 2.5;
    if (pos.y < minY) pos.y = minY;
    const a = this.snap ? 1 : 1 - Math.exp(-dt * kPos);
    this.pos.lerp(pos, a);
    this.look.lerp(look, this.snap ? 1 : 1 - Math.exp(-dt * kLook));
    this.snap = false;

    // shake from impacts and from very high speed
    const shake = r.impact * 1.4 + Math.max(0, r.speed - 62) * 0.006;
    const sx = (Math.sin(this.t * 37.1) + Math.sin(this.t * 23.7)) * 0.5 * shake;
    const sy = (Math.sin(this.t * 31.3 + 1.7) + Math.sin(this.t * 19.9)) * 0.5 * shake;
    cam.position.copy(this.pos).addScaledVector(right, sx).add(new THREE.Vector3(0, sy, 0));
    const viewDir = this.look.clone().sub(this.pos).normalize();
    this.upv.lerp(UP.clone().applyAxisAngle(viewDir, roll), 1 - Math.exp(-dt * 4));
    cam.up.copy(this.upv);
    cam.lookAt(this.look);
    cam.fov = lerp(cam.fov, fov, 1 - Math.exp(-dt * 3));
    cam.updateProjectionMatrix();
  }

  /** Where the camera is looking from and to, for culling and HUD math. */
  get eye() { return this.pos; }
}
