import * as THREE from 'three';
import type { RingData, Vec } from '../world/generate';
import { U } from './materials';

const glowMat = (c: string, k = 2.2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

/** Floating drift seeds: fly through them to collect. */
export class Seeds {
  mesh: THREE.InstancedMesh;
  pos: THREE.Vector3[];
  got: Set<number>;
  halo: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Group, list: Vec[], got: number[]) {
    this.pos = list.map(p => new THREE.Vector3(...p));
    this.got = new Set(got);
    const g = new THREE.IcosahedronGeometry(1.1, 1);
    this.mesh = new THREE.InstancedMesh(g, glowMat('#ffe9a8', 1.3), Math.max(1, list.length));
    this.mesh.count = list.length;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    const core = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.2, 1), glowMat('#2a1d08'), Math.max(1, list.length));
    core.count = list.length;
    core.frustumCulled = false;
    this.halo = core;
    scene.add(core);
  }

  /** Returns the index of a seed collected this frame, or -1. */
  update(rider: THREE.Vector3): number {
    const t = U.uTime.value;
    let hit = -1;
    this.pos.forEach((p, i) => {
      const gone = this.got.has(i);
      if (!gone && p.distanceTo(rider) < 10) { this.got.add(i); hit = i; }
      const k = this.got.has(i) ? 0 : 1 + 0.15 * Math.sin(t * 3 + i);
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 0.8 + i);
      this.m.compose(this.s.copy(p).setY(p.y + Math.sin(t * 1.2 + i) * 1.5), this.q, new THREE.Vector3(k, k * 1.3, k));
      this.mesh.setMatrixAt(i, this.m);
      this.m.compose(this.s, this.q, new THREE.Vector3(k, k, k).multiplyScalar(0.9 + 0.2 * Math.sin(t * 2 + i)));
      this.halo.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
    return hit;
  }

  nearestOpen(p: THREE.Vector3) {
    let best = -1, bd = Infinity;
    this.pos.forEach((s, i) => { if (!this.got.has(i)) { const d = s.distanceTo(p); if (d < bd) { bd = d; best = i; } } });
    return best < 0 ? null : { i: best, d: bd, p: this.pos[best] };
  }

  dispose(scene: THREE.Group) {
    for (const m of [this.mesh, this.halo]) { scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  }
}

/** A ring course through the Hanging Peaks with timing. */
export class Race {
  group = new THREE.Group();
  rings: { p: THREE.Vector3; n: THREE.Vector3; mesh: THREE.Mesh }[] = [];
  active = false;
  next = 0;
  start = 0;
  elapsed = 0;
  private mat = { next: glowMat('#5ff2d6'), later: glowMat('#1e5a6a') };

  constructor(scene: THREE.Group, data: RingData[]) {
    const g = new THREE.TorusGeometry(15, 0.9, 10, 48);
    for (const r of data) {
      const p = new THREE.Vector3(...r.p), n = new THREE.Vector3(...r.n);
      const mesh = new THREE.Mesh(g, this.mat.later);
      mesh.position.copy(p);
      mesh.lookAt(p.clone().add(n));
      this.group.add(mesh);
      this.rings.push({ p, n, mesh });
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  get total() { return this.rings.length; }

  begin() {
    this.active = this.rings.length > 0;
    this.next = 0;
    this.elapsed = 0;
    this.start = performance.now();
    this.group.visible = this.active;
    this.paint();
  }

  stop() { this.active = false; this.group.visible = false; }

  private paint() {
    this.rings.forEach((r, i) => {
      r.mesh.visible = i >= this.next;
      r.mesh.material = i === this.next ? this.mat.next : this.mat.later;
    });
  }

  /** Where the autopilot should aim during a race: the next ring, slightly past its centre. */
  aim() {
    const r = this.rings[this.next];
    return r ? r.p.clone().addScaledVector(r.n, 20) : null;
  }

  /** Returns 'ring' when a ring is passed, 'done' at the finish. */
  update(p: THREE.Vector3): 'ring' | 'done' | null {
    if (!this.active) return null;
    this.elapsed = (performance.now() - this.start) / 1000;
    const t = U.uTime.value;
    const cur = this.rings[this.next];
    if (cur) cur.mesh.scale.setScalar(1 + 0.06 * Math.sin(t * 5));
    if (cur && p.distanceTo(cur.p) < 17) {
      this.next++;
      this.paint();
      if (this.next >= this.rings.length) { this.active = false; this.group.visible = false; return 'done'; }
      return 'ring';
    }
    return null;
  }

  dispose(scene: THREE.Group) {
    scene.remove(this.group);
    this.rings[0]?.mesh.geometry.dispose();
    this.mat.next.dispose(); this.mat.later.dispose();
  }
}
