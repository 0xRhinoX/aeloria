import * as THREE from 'three';
import { TAU, clamp, lerp, mulberry32 } from '../world/noise';
import type { Terrain } from '../world/terrain';
import type { Obstacle } from '../world/generate';
import { animateMount, buildMountBody, disposeTree, wildPalette, type MountPalette } from './creatures';
import { U } from './materials';

/** Riderless skywings that circle in flocks and can be bonded with. */
export class WildMount {
  root = new THREE.Group();
  body!: ReturnType<typeof buildMountBody>;
  pos = new THREE.Vector3();
  fwd = new THREE.Vector3(1, 0, 0);
  flap = Math.random() * TAU;
  phase: number;
  roll = 0;
  constructor(public pal: MountPalette, public flock: Flock, public slot: number, scene: THREE.Scene) {
    this.phase = (slot / 4) * 0.5;
    this.setPalette(pal);
    this.root.scale.setScalar(0.92);
    scene.add(this.root);
  }
  setPalette(p: MountPalette) {
    if (this.body) { this.root.remove(this.body.body); disposeTree(this.body.body); }
    this.body = buildMountBody(p);
    this.root.add(this.body.body);
    this.pal = p;
  }
  dispose(scene: THREE.Scene) { scene.remove(this.root); disposeTree(this.root); }
}

export interface Flock { c: THREE.Vector3; r: number; dir: number; speed: number; a: number }

export class Wilds {
  flocks: Flock[] = [];
  mounts: WildMount[] = [];
  private made = 0;
  constructor(private scene: THREE.Scene) {}

  build(seed: number, centres: [number, number, number, number][]) {
    this.dispose();
    const rand = mulberry32(seed * 31 + 7);
    centres.forEach(([x, y, z, r], fi) => {
      const f: Flock = { c: new THREE.Vector3(x, y, z), r, dir: fi % 2 ? 1 : -1, speed: 24, a: rand() * TAU };
      this.flocks.push(f);
      for (let i = 0; i < 4; i++) this.mounts.push(new WildMount(wildPalette(rand, this.made++), f, i, this.scene));
    });
  }

  dispose() { this.mounts.forEach(m => m.dispose(this.scene)); this.mounts = []; this.flocks = []; }

  /** A fresh wild palette for the mount a rider leaves behind after bonding. */
  release(m: WildMount, pal: MountPalette) { m.setPalette(pal); }

  update(dt: number, T: Terrain, obstacles: Obstacle[]) {
    const t = U.uTime.value;
    for (const f of this.flocks) f.a += ((f.speed / f.r) * dt) * f.dir;
    for (const m of this.mounts) {
      const f = m.flock, a = f.a - m.slot * 0.09 * f.dir;
      const lateral = (m.slot - 1.5) * 9;
      const target = new THREE.Vector3(
        f.c.x + Math.cos(a) * (f.r + lateral),
        f.c.y + Math.sin(a * 2 + m.slot) * 22 + m.slot * 4,
        f.c.z + Math.sin(a) * (f.r + lateral),
      );
      target.y = Math.max(target.y, T.surface(target.x, target.z) + 40);
      // slide the path around floating rock and the Elder Tree canopy
      for (const o of obstacles) {
        if (o.t === 's') {
          const d = Math.hypot(target.x - o.x, target.y - o.y, target.z - o.z), lim = o.r + 25;
          if (d < lim) { const k = (lim - d) / Math.max(d, 1); target.x += (target.x - o.x) * k; target.y += (target.y - o.y) * k; target.z += (target.z - o.z) * k; }
        } else if (target.y < o.top + 25) {
          const d = Math.hypot(target.x - o.x, target.z - o.z), lim = o.r + 25;
          if (d < lim) { const k = (lim - d) / Math.max(d, 1); target.x += (target.x - o.x) * k; target.z += (target.z - o.z) * k; }
        }
      }
      if (m.pos.lengthSq() === 0) m.pos.copy(target);
      const prev = m.fwd.clone();
      const d = target.clone().sub(m.pos);
      m.pos.lerp(target, 1 - Math.exp(-dt * 2));
      if (d.lengthSq() > 0.01) m.fwd.lerp(d.normalize(), 1 - Math.exp(-dt * 3)).normalize();
      const yawRate = (prev.x * m.fwd.z - prev.z * m.fwd.x) / Math.max(dt, 1e-4);
      m.roll = lerp(m.roll, clamp(yawRate * 1.5, -0.9, 0.9), 1 - Math.exp(-dt * 3));
      m.root.position.copy(m.pos);
      m.root.lookAt(m.pos.clone().add(m.fwd));
      m.root.rotateZ(m.roll);
      m.flap += dt * (3.2 + m.slot * 0.2);
      animateMount(m.body, m.flap, 0.55 + 0.3 * Math.sin(t * 0.3 + m.slot), t, m.roll, m.fwd.y, m.slot * 3);
    }
  }

  nearest(p: THREE.Vector3) {
    let best: WildMount | null = null, bd = Infinity;
    for (const m of this.mounts) { const d = m.pos.distanceTo(p); if (d < bd) { bd = d; best = m; } }
    return { mount: best, dist: bd };
  }
}
