import * as THREE from 'three';
import { TAU, clamp, lerp } from '../world/noise';
import { BOUND, WL, type Terrain } from '../world/terrain';
import type { Obstacle, PlaceData, Vec } from '../world/generate';
import { animateMount, buildMountBody, buildRider, disposeTree, type Mount, type MountPalette, type RiderDef } from './creatures';
import { U } from './materials';

/** Solid shapes riders can hit: isles (dome over a tapering root), arches (tube along a half circle), cylinders, the Elder canopy. */
export interface Solids {
  isles: [number, number, number, number][];
  arches: { base: THREE.Vector3; side: THREE.Vector3; R: number; tube: number }[];
  pillars: { x: number; z: number; r: number; top: number }[];
  elder: { x: number; y: number; z: number };
}

export interface FlightWorld {
  terrain: Terrain;
  obstacles: Obstacle[];
  places: PlaceData[];
  solids: Solids;
  /** steer gently around rock and pull up near the ground when the player flies */
  assist: boolean;
}

export interface Controls {
  /** stick: x turns right, y raises the nose, both -1..1 */
  x: number;
  y: number;
  /** a direction to fly toward (mouse aim); used while the stick is centred */
  aim: THREE.Vector3 | null;
  /** beat the wings for thrust (uses stamina) */
  flap: boolean;
  /** tuck the wings to dive fast */
  dive: boolean;
  /** barrel roll: -1 left, 1 right */
  trick: number;
}
export const NO_CONTROLS: Controls = { x: 0, y: 0, aim: null, flap: false, dive: false, trick: 0 };

const G = 9.81;
const CD = 0.00109, CD_TUCK = 0.00052;
const THRUST = 6.4;
const STALL = 14;
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

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Find the nearest exit from any solid the point is inside. Returns the push normal and depth, or null. */
export function penetration(p: THREE.Vector3, S: Solids, out: THREE.Vector3): number {
  let best = 0;
  const cand = (nx: number, ny: number, nz: number, depth: number) => {
    if (depth > 0 && (best === 0 || depth < best)) { best = depth; out.set(nx, ny, nz).normalize(); }
  };
  for (const [x, y, z, R] of S.isles) {
    const dx = p.x - x, dz = p.z - z, h = Math.hypot(dx, dz);
    if (h > R * 1.02 || p.y > y + R * 0.32 || p.y < y - R * 2.1) continue;
    const t = h / R, top = y + R * 0.3 * (1 - t * t), bot = y - R * 2 * Math.pow(Math.max(0, 1 - t), 0.85);
    if (p.y > top || p.y < bot) continue;
    const toTop = top - p.y, toBot = p.y - bot, toSide = R * 1.02 - h;
    if (toTop <= toSide && toTop <= toBot) cand(dx * 0.3 / R, 1, dz * 0.3 / R, toTop + 0.5);
    else if (toSide <= toBot) cand(dx, 0, dz, toSide + 0.5);
    else cand(0, -1, 0, toBot + 0.5);
  }
  for (const a of S.arches) {
    // arch-local coordinates: u across the span, v up, off along the through axis
    const rel = p.clone().sub(a.base);
    const along = new THREE.Vector3(a.side.z, 0, -a.side.x);
    const u = rel.dot(a.side), v = rel.y, off = rel.dot(along);
    const ang = Math.atan2(Math.max(v, 0), u), cu = Math.cos(ang) * a.R, cv = Math.sin(ang) * a.R;
    const du = u - cu, dv = v - cv, dist = Math.hypot(du, dv, off), lim = a.tube * 1.15;
    if (dist < lim && v > -a.tube) {
      const n = a.side.clone().multiplyScalar(du).add(new THREE.Vector3(0, dv, 0)).addScaledVector(along, off);
      cand(n.x, n.y, n.z, lim - dist + 0.4);
    }
  }
  for (const c of S.pillars) {
    if (p.y > c.top) continue;
    const dx = p.x - c.x, dz = p.z - c.z, h = Math.hypot(dx, dz), r = c.r;
    if (h < r) {
      const toTop = c.top - p.y, toSide = r - h;
      if (toTop < toSide) cand(0, 1, 0, toTop + 0.5); else cand(dx, 0, dz, toSide + 0.5);
    }
  }
  {
    const e = S.elder, dx = p.x - e.x, dy = p.y - (e.y + 162), dz = p.z - e.z;
    const k = (dx * dx + dz * dz) / (108 * 108) + (dy * dy) / (40 * 40);
    if (k < 1) cand(dx / 108, dy / 40, dz / 108, (1 - Math.sqrt(k)) * 40 + 0.5);
    const th = Math.hypot(dx, dz);
    if (p.y < e.y + 140 && th < 24) cand(dx, 0, dz, 24 - th + 0.5);
  }
  return best;
}

export class Rider {
  readonly root = new THREE.Group();
  mount!: Mount;
  pal: MountPalette;
  pos = new THREE.Vector3();
  fwd = new THREE.Vector3(0, 0, 1);
  yaw = 0;
  pitch = 0;
  roll = 0;
  speed = 30;
  /** extra visual roll for barrel rolls */
  trickRoll = 0;
  private trickDir = 0;
  flap = Math.random() * TAU;
  amp = 0.6;
  tuck = 0;
  flapping = false;
  flapped = false;
  stamina = 1;
  /** strength of the last collision, decays; drives camera shake and sound */
  impact = 0;
  /** seconds since the mount skimmed water */
  splash = 9;
  queue: THREE.Vector3[] = [];
  target: THREE.Vector3 | null = null;
  placeIdx: number;
  manual = false;
  /** 0..1, how close to the ground; drives the ripple glow */
  low = 0;
  cruise = 27 + Math.random() * 7;
  /** temporary cruise speed, used to match a wild flock while bonding */
  cruiseOverride: number | null = null;
  /** dynamic target (race ring, wild mount, map pin) that overrides the tour while set */
  follow: (() => THREE.Vector3 | null) | null = null;
  private riderFig: ReturnType<typeof buildRider>;
  private tmp = new THREE.Vector3();
  private n = new THREE.Vector3();

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

  private syncFwd() {
    const cp = Math.cos(this.pitch);
    this.fwd.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  private setDir(d: THREE.Vector3) {
    this.yaw = Math.atan2(d.x, d.z);
    this.pitch = Math.asin(clamp(d.y / Math.max(d.length(), 1e-6), -1, 1));
    this.syncFwd();
  }

  spawn(w: FlightWorld, placeIdx = this.placeIdx) {
    this.placeIdx = placeIdx;
    const p = w.places[placeIdx], c = new THREE.Vector3(...p.c), a = Math.random() * TAU;
    this.pos.copy(c).add(new THREE.Vector3(Math.cos(a) * 220, 40, Math.sin(a) * 220));
    this.pos.y = Math.max(this.pos.y, w.terrain.surface(this.pos.x, this.pos.z) + 60);
    this.setDir(c.clone().sub(this.pos).setY(0));
    this.speed = 30;
    this.queue = [];
    this.target = null;
  }

  /** Place the rider at a point facing a direction (race start, map pin). */
  placeAt(p: THREE.Vector3, dir: THREE.Vector3) {
    this.pos.copy(p);
    this.setDir(dir);
  }

  nextTarget(w: FlightWorld) {
    if (!this.queue.length) {
      if (Math.random() > 0.65) this.placeIdx = (Math.random() * w.places.length) | 0;
      const wps = w.places[this.placeIdx].wps.slice().sort(() => Math.random() - 0.5);
      this.queue = wps.slice(0, 3 + ((Math.random() * 3) | 0)).map((p: Vec) => new THREE.Vector3(...p));
    }
    this.target = this.queue.shift() ?? null;
  }

  update(dt: number, ctl: Controls, w: FlightWorld) {
    const T = w.terrain, auto = !this.manual;
    let aim: THREE.Vector3 | null = null;
    let sx = 0, sy = 0, wantFlap = false, wantDive = false;

    if (auto) {
      const f = this.follow?.();
      if (!f && (!this.target || this.pos.distanceTo(this.target) < 45)) this.nextTarget(w);
      const goal = f ?? this.target;
      aim = goal ? this.tmp.copy(goal).sub(this.pos).normalize() : this.fwd.clone();
      avoid(this.pos, aim, w.obstacles, 38);
      const ahead = this.pos.clone().addScaledVector(this.fwd, this.speed * 1.6);
      const gnd = Math.max(T.groundY(ahead.x, ahead.z), T.groundY(this.pos.x, this.pos.z), WL);
      if (this.pos.y < gnd + 32) aim.y += (gnd + 32 - this.pos.y) * 0.05;
      aim.normalize();
      aim.y = clamp(aim.y, -0.7, 0.7);
      const cruise = this.cruiseOverride ?? this.cruise;
      wantFlap = this.speed < cruise - 1 || aim.y > 0.15;
      wantDive = aim.y < -0.55;
    } else {
      sx = ctl.x; sy = ctl.y; wantFlap = ctl.flap; wantDive = ctl.dive;
      if (Math.abs(sx) < 0.05 && Math.abs(sy) < 0.05 && ctl.aim) aim = this.tmp.copy(ctl.aim);
      if (w.assist) {
        // gentle help: lean away from rock ahead and pull up before the ground
        if (aim) avoid(this.pos, aim, w.obstacles, 14);
        const ahead = this.pos.clone().addScaledVector(this.fwd, Math.max(this.speed, 20) * 1.1);
        const gnd = Math.max(T.groundY(ahead.x, ahead.z), WL);
        if (ahead.y < gnd + 6 && this.fwd.y < 0.2) sy = Math.max(sy, clamp((gnd + 6 - ahead.y) / 12, 0, 1));
      }
      if (ctl.trick && !this.trickDir && this.stamina > 0.15) { this.trickDir = ctl.trick; this.stamina -= 0.15; }
    }

    // steering controller: bank to turn, pitch toward the goal
    let targetRoll: number, pitchRate: number;
    if (aim && Math.abs(sy) < 0.05) {
      aim.normalize();
      const yawErr = wrap(Math.atan2(aim.x, aim.z) - this.yaw);
      targetRoll = clamp(-yawErr * 2.1, -1.15, 1.15);
      pitchRate = clamp((Math.asin(clamp(aim.y, -1, 1)) - this.pitch) * 2.4, -1.3, 1.3);
    } else {
      targetRoll = sx * 1.15;
      pitchRate = sy * 1.2;
      if (Math.abs(sy) < 0.05) pitchRate = (-0.04 - this.pitch) * 0.6;
    }
    if (this.speed < STALL) pitchRate -= (STALL - this.speed) * 0.3;
    this.roll = lerp(this.roll, targetRoll, 1 - Math.exp(-dt * 4));
    this.pitch = clamp(this.pitch + pitchRate * dt, -1.3, 1.15);
    this.yaw -= (Math.tan(clamp(this.roll, -1.25, 1.25)) * G / Math.max(this.speed, 12)) * 1.6 * dt;
    this.syncFwd();

    // energy: gravity along the flight path, drag, wingbeats
    this.tuck = lerp(this.tuck, wantDive ? 1 : 0, 1 - Math.exp(-dt * 4));
    let cd = lerp(CD, CD_TUCK, this.tuck) * (1 + Math.abs(this.roll) * 0.25);
    if (auto && this.speed > 48) cd *= 3;
    let thrust = 0;
    if (wantFlap) {
      if (auto) thrust = THRUST * 0.75;
      else if (this.stamina > 0.02) { thrust = THRUST; this.stamina = Math.max(0, this.stamina - dt * 0.11); }
      else thrust = THRUST * 0.3;
    } else if (!auto) this.stamina = Math.min(1, this.stamina + dt * 0.07 * (1 + this.tuck * 0.6));
    if (this.speed < STALL + 2) thrust = Math.max(thrust, THRUST * 0.6);
    this.flapping = thrust > 0;
    const acc = -G * Math.sin(this.pitch) - cd * this.speed * this.speed + thrust * (1 - this.tuck * 0.7);
    this.speed = clamp(this.speed + acc * dt, 9, 115);
    this.pos.addScaledVector(this.fwd, this.speed * dt);

    this.collide(w);

    // barrel roll
    if (this.trickDir) {
      this.trickRoll += this.trickDir * dt * 7.5;
      if (Math.abs(this.trickRoll) >= TAU) { this.trickRoll = 0; this.trickDir = 0; }
    }

    // pose
    this.root.position.copy(this.pos);
    this.root.lookAt(this.tmp.copy(this.pos).add(this.fwd));
    this.root.rotateZ(this.roll + this.trickRoll);
    const wantAmp = this.flapping ? 0.7 + 0.3 * Math.min(1, thrust / THRUST) : 0.08 + Math.max(0, this.pitch) * 0.6;
    this.amp = lerp(this.amp, wantAmp * (1 - this.tuck * 0.85), 1 - Math.exp(-dt * 3));
    const prevPh = this.flap;
    this.flap += dt * (2.4 + this.amp * 2.8);
    this.flapped = Math.floor(prevPh / TAU) !== Math.floor(this.flap / TAU) && this.amp > 0.3;
    this.root.position.y -= Math.sin(this.flap) * 0.18 * this.amp;
    animateMount(this.mount, this.flap, this.amp, U.uTime.value, this.roll, this.pitch, this.i, this.tuck);
    this.low = clamp(1 - (this.pos.y - T.surface(this.pos.x, this.pos.z)) / 48, 0, 1);
    this.impact *= Math.exp(-dt * 3);
    this.splash += dt;
  }

  /** Push out of terrain, water and rock; bounce and lose speed on impact. */
  private collide(w: FlightWorld) {
    const T = w.terrain, n = this.n;
    const ground = T.groundY(this.pos.x, this.pos.z), floor = Math.max(ground, WL) + 2.2;
    if (this.pos.y < floor) {
      if (ground < WL) { n.set(0, 1, 0); this.splash = 0; }
      else {
        const e = 2, hx = T.groundY(this.pos.x + e, this.pos.z) - T.groundY(this.pos.x - e, this.pos.z);
        const hz = T.groundY(this.pos.x, this.pos.z + e) - T.groundY(this.pos.x, this.pos.z - e);
        n.set(-hx, 2 * e, -hz).normalize();
      }
      this.pos.y = floor;
      this.bounce(n, ground < WL ? 0.15 : 0.35);
    }
    for (let k = 0; k < 2; k++) {
      const depth = penetration(this.pos, w.solids, n);
      if (!depth) break;
      this.pos.addScaledVector(n, depth);
      this.bounce(n, 0.5);
    }
  }

  private bounce(n: THREE.Vector3, loss: number) {
    const into = -this.fwd.dot(n);
    if (into <= 0) return;
    const d = this.fwd.clone().addScaledVector(n, into * 1.2).normalize();
    this.setDir(d);
    const hit = into * this.speed;
    this.speed *= 1 - Math.min(0.6, into * loss * 1.6);
    if (hit > 4) this.impact = Math.max(this.impact, Math.min(1, hit / 30));
  }

  get up() { return UP; }
}
