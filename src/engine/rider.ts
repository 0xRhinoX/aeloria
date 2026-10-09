import * as THREE from 'three';
import { TAU, clamp, lerp } from '../world/noise';
import { BOUND, WL, type Terrain } from '../world/terrain';
import type { Obstacle, PlaceData } from '../world/generate';
import { animateMount, buildMountBody, buildRider, disposeTree, type Mount, type MountPalette, type RiderDef } from './creatures';
import { U } from './materials';

export interface FlightWorld { terrain: Terrain; obstacles: Obstacle[]; places: PlaceData[] }
export interface FlightInput { x: number; y: number; boost: boolean }
const NO_INPUT: FlightInput = { x: 0, y: 0, boost: false };
const UP = new THREE.Vector3(0, 1, 0);

/** Steer `des` away from rock, trees and the world edge. Shared by riders and wild mounts. */
export function avoid(pos: THREE.Vector3, des: THREE.Vector3, obstacles: Obstacle[], margin = 38) {
  for (const o of obstacles) {
    if (o.t === 's') {
      const dx = pos.x - o.x, dy = pos.y - o.y, dz = pos.z - o.z, d = Math.hypot(dx, dy, dz), m = o.r + margin;
      if (d < m && d > 0) { const k = ((m - d) / margin) * 2.4 / d; des.x += dx * k; des.y += dy * k; des.z += dz * k; }
    } else if (pos.y < o.top + 25) {
      const dx = pos.x - o.x, dz = pos.z - o.z, d = Math.hypot(dx, dz), m = o.r + margin;
      if (d < m && d > 0) { const k = ((m - d) / margin) * 2.4 / d; des.x += dx * k; des.z += dz * k; des.y += 0.4; }
    }
  }
  const r = Math.hypot(pos.x, pos.z);
  if (r > BOUND) { des.x -= (pos.x / r) * (r - BOUND) * 0.03; des.z -= (pos.z / r) * (r - BOUND) * 0.03; }
}

export class Rider {
  readonly root = new THREE.Group();
  mount!: Mount;
  pal: MountPalette;
  pos = new THREE.Vector3();
  fwd = new THREE.Vector3(0, 0, 1);
  speed = 30;
  roll = 0;
  flap = Math.random() * TAU;
  amp = 0.6;
  flapped = false;
  queue: THREE.Vector3[] = [];
  target: THREE.Vector3 | null = null;
  placeIdx: number;
  manual = false;
  yaw = 0;
  pitch = 0;
  /** 0..1, how close to the ground; drives the ripple glow */
  low = 0;
  cruise = 27 + Math.random() * 7;
  /** temporary cruise speed, used to match a wild flock while bonding */
  cruiseOverride: number | null = null;
  /** dynamic target (race ring, wild mount) that overrides the tour while set */
  follow: (() => THREE.Vector3 | null) | null = null;
  private riderFig: ReturnType<typeof buildRider>;

  constructor(public def: RiderDef, public i: number, scene: THREE.Scene) {
    this.placeIdx = i % 5;
    this.pal = def.pal;
    this.riderFig = buildRider(def.skin);
    this.riderFig.group.position.set(0, 0.55, 1.55);
    this.setPalette(def.pal);
    scene.add(this.root);
  }

  get head() { return this.riderFig.head; }

  setPalette(p: MountPalette) {
    if (this.mount) { this.mount.body.remove(this.riderFig.group); this.root.remove(this.mount.body); disposeTree(this.mount.body); }
    const b = buildMountBody(p);
    b.body.add(this.riderFig.group);
    this.root.add(b.body);
    this.mount = { root: this.root, ...b, head: this.riderFig.head };
    this.pal = p;
  }

  spawn(w: FlightWorld, placeIdx = this.placeIdx) {
    this.placeIdx = placeIdx;
    const p = w.places[placeIdx], c = new THREE.Vector3(...p.c), a = Math.random() * TAU;
    this.pos.copy(c).add(new THREE.Vector3(Math.cos(a) * 220, 40, Math.sin(a) * 220));
    this.pos.y = Math.max(this.pos.y, w.terrain.surface(this.pos.x, this.pos.z) + 60);
    this.fwd.copy(c).sub(this.pos).setY(0).normalize();
    this.queue = [];
    this.target = null;
    this.yaw = Math.atan2(this.fwd.x, this.fwd.z);
    this.pitch = 0;
  }

  /** Place the rider at a point facing a direction (race start). */
  placeAt(p: THREE.Vector3, dir: THREE.Vector3) {
    this.pos.copy(p);
    this.fwd.copy(dir).normalize();
    this.yaw = Math.atan2(this.fwd.x, this.fwd.z);
    this.pitch = Math.asin(clamp(this.fwd.y, -1, 1));
  }

  nextTarget(w: FlightWorld) {
    if (!this.queue.length) {
      if (Math.random() > 0.65) this.placeIdx = (Math.random() * w.places.length) | 0;
      const wps = w.places[this.placeIdx].wps.slice().sort(() => Math.random() - 0.5);
      this.queue = wps.slice(0, 3 + ((Math.random() * 3) | 0)).map(p => new THREE.Vector3(...p));
    }
    this.target = this.queue.shift() ?? null;
  }

  update(dt: number, input: FlightInput = NO_INPUT, w: FlightWorld) {
    const des = new THREE.Vector3();
    if (this.manual) {
      this.yaw += -input.x * 1.5 * dt;
      this.pitch = clamp(this.pitch + input.y * 1.3 * dt, -0.85, 0.85);
      if (!input.y) this.pitch *= 1 - dt * 0.8;
      des.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    } else {
      const f = this.follow?.();
      if (f) des.copy(f).sub(this.pos).normalize();
      else {
        if (!this.target || this.pos.distanceTo(this.target) < 45) this.nextTarget(w);
        if (this.target) des.copy(this.target).sub(this.pos).normalize();
      }
    }
    avoid(this.pos, des, w.obstacles, this.manual ? 22 : 38);
    const T = w.terrain;
    const ahead = this.pos.clone().addScaledVector(this.fwd, this.speed * 1.6);
    const gnd = Math.max(T.groundY(ahead.x, ahead.z), T.groundY(this.pos.x, this.pos.z), WL);
    const clear = this.manual ? 5 : 10;
    if (this.pos.y < gnd + clear + 22) des.y += (gnd + clear + 22 - this.pos.y) * 0.05;
    des.normalize();
    des.y = clamp(des.y, -0.7, 0.7);
    des.normalize();
    const prev = this.fwd.clone();
    this.fwd.lerp(des, 1 - Math.exp(-dt * (this.manual ? 3 : 1.25))).normalize();
    if (this.manual) this.yaw = Math.atan2(this.fwd.x, this.fwd.z);
    const yawRate = (prev.x * this.fwd.z - prev.z * this.fwd.x) / Math.max(dt, 1e-4);
    this.roll = lerp(this.roll, clamp(yawRate * 1.5, -1.1, 1.1), 1 - Math.exp(-dt * 3));
    const tgt = (this.manual && input.boost ? 58 : this.cruiseOverride ?? this.cruise) - this.fwd.y * 22;
    this.speed = lerp(this.speed, tgt, 1 - Math.exp(-dt * 0.9));
    this.pos.addScaledVector(this.fwd, this.speed * dt);
    const floorY = T.surface(this.pos.x, this.pos.z) + clear * 0.6;
    if (this.pos.y < floorY) this.pos.y = floorY;

    this.root.position.copy(this.pos);
    this.root.lookAt(this.pos.clone().add(this.fwd));
    this.root.rotateZ(this.roll);

    const wantAmp = clamp(0.3 + this.fwd.y * 2.4 + (tgt - this.speed) * 0.04 + (input.boost && this.manual ? 0.4 : 0), 0.06, 1);
    this.amp = lerp(this.amp, wantAmp, 1 - Math.exp(-dt * 2));
    const prevPh = this.flap;
    this.flap += dt * (2.6 + this.amp * 2.2);
    this.flapped = Math.floor(prevPh / TAU) !== Math.floor(this.flap / TAU);
    animateMount(this.mount, this.flap, this.amp, U.uTime.value, this.roll, this.fwd.y, this.i);
    this.low = clamp(1 - (this.pos.y - T.surface(this.pos.x, this.pos.z)) / 48, 0, 1);
  }

  get up() { return UP; }
}
