import * as THREE from 'three';
import { clamp } from '../world/noise';
import type { Controls } from './rider';

export type PadEvent = 'reins' | 'camera' | 'next' | 'prev' | 'map';

/**
 * Collects flight input from keyboard, pointer-locked mouse aim, gamepad and touch,
 * and turns it into one Controls value for the rider being flown.
 */
export class Input {
  keys: Record<string, boolean> = {};
  /** mouse aim direction while the pointer is locked */
  aimYaw = 0;
  aimPitch = 0;
  locked = false;
  /** pointer lock was refused (sandboxed frame); fall back to drag steering */
  lockFailed = false;
  sensitivity = 0.0022;
  invertY = false;
  /** drag steering when the pointer is not locked (mouse or touch on the canvas) */
  drag = { x: 0, y: 0 };
  /** on-screen touch controls */
  touch = { x: 0, y: 0, flap: false, dive: false };
  trick = 0;
  private pad = { x: 0, y: 0, flap: false, dive: false, active: false };
  private prevButtons: boolean[] = [];
  private aim = new THREE.Vector3();

  /** called when the browser takes the pointer lock away (usually Esc), not when we release it ourselves */
  onLockLost: (() => void) | null = null;
  private releasing = false;

  constructor() {
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = !!document.pointerLockElement;
      if (was && !this.locked && !this.releasing) this.onLockLost?.();
      this.releasing = false;
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.aimYaw -= e.movementX * this.sensitivity;
      this.aimPitch = clamp(this.aimPitch - e.movementY * this.sensitivity * (this.invertY ? -1 : 1), -1.15, 1.05);
    });
  }

  requestLock(el: HTMLElement) {
    if (this.locked || !el.requestPointerLock) return;
    try {
      const p = el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => { this.lockFailed = true; });
    } catch { this.lockFailed = true; }
  }

  releaseLock() { if (document.pointerLockElement) { this.releasing = true; document.exitPointerLock(); } }

  /** Align mouse aim with the rider so taking the reins does not jerk the mount. */
  syncAim(yaw: number, pitch: number) { this.aimYaw = yaw; this.aimPitch = pitch; }

  aimDir() {
    const cp = Math.cos(this.aimPitch);
    return this.aim.set(Math.sin(this.aimYaw) * cp, Math.sin(this.aimPitch), Math.cos(this.aimYaw) * cp);
  }

  /** Poll the first connected gamepad; returns one-shot button events. */
  pollPad(): PadEvent[] {
    const out: PadEvent[] = [];
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find(p => p && p.connected);
    if (!gp) { this.pad.active = false; return out; }
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    this.pad.x = dz(gp.axes[0] ?? 0);
    this.pad.y = -dz(gp.axes[1] ?? 0);
    const b = (i: number) => !!gp.buttons[i]?.pressed;
    this.pad.flap = b(0) || b(7);
    this.pad.dive = b(1) || b(6);
    this.pad.active = this.pad.active || Math.abs(this.pad.x) + Math.abs(this.pad.y) > 0 || this.pad.flap || this.pad.dive;
    const edge = (i: number) => b(i) && !this.prevButtons[i];
    if (edge(9)) out.push('reins');
    if (edge(3)) out.push('camera');
    if (edge(5)) out.push('next');
    if (edge(4)) out.push('prev');
    if (edge(8)) out.push('map');
    if (edge(2)) this.trick = Math.sign(this.pad.x || 1);
    this.prevButtons = gp.buttons.map(x => x.pressed);
    return out;
  }

  get padActive() { return this.pad.active; }

  /** Current controls for the flown rider. `yaw`/`pitch` are the rider's, used to keep aim in sync while steering by stick. */
  controls(yaw: number, pitch: number): Controls {
    const k = this.keys;
    let x = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + this.drag.x + this.touch.x + this.pad.x;
    let y = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) + this.drag.y + this.touch.y + this.pad.y;
    x = clamp(x, -1, 1); y = clamp(y, -1, 1);
    const stick = Math.abs(x) > 0.05 || Math.abs(y) > 0.05;
    if (stick || !this.locked) this.syncAim(yaw, pitch);
    const trick = this.trick || (k.KeyE ? 1 : k.KeyQ ? -1 : 0);
    this.trick = 0;
    return {
      x, y,
      aim: this.locked && !stick ? this.aimDir().clone() : null,
      flap: !!(k.Space || this.touch.flap || this.pad.flap),
      dive: !!(k.ShiftLeft || k.ShiftRight || this.touch.dive || this.pad.dive),
      trick,
    };
  }
}
