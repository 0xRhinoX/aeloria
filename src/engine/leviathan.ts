import * as THREE from 'three';
import { TAU, clamp, mulberry32, sm } from '../world/noise';
import type { Terrain } from '../world/terrain';
import { bioMat, makePointsMaterial } from './materials';

const UP = new THREE.Vector3(0, 1, 0);
/** body length, cruise speed (m/s), max body radius, ellipse width and height */
const LEN = 300, SPEED = 26, R0 = 34, WX = 1.15, HY = 0.85;
const NR = 90, NS = 22;
const PATH_N = 4096;
const TENDRILS = 36, BEADS = 14, PODS = 44, SPORES = 320;

/** Radius profile from head (u = 0) to tail (u = 1): blunt head, widest at a quarter, long taper. */
function radius(u: number) {
  if (u < 0.24) return R0 * Math.sqrt(Math.sin((u / 0.24) * Math.PI * 0.5)) * 0.97 + 1;
  const k = (u - 0.24) / 0.76;
  return Math.max(2, R0 * Math.pow(1 - k, 1.25) * (1 - 0.15 * k));
}

function finGeometry(span: number, root: number, sweep: number, color: THREE.Color, glow: THREE.Color, both: boolean) {
  const P: number[] = [], C: number[] = [], G: number[] = [];
  const nu = 10, nv = 4;
  const lead = (s: number) => new THREE.Vector3(span * s, -4 * s * s, -sweep * s * s);
  const trail = (s: number) => new THREE.Vector3(span * s * 0.92, -3 * s * s, -root * (1 - s) - sweep * s * s - 3);
  const pt = (s: number, v: number) => lead(s).lerp(trail(s), v);
  const push = (p: THREE.Vector3, s: number, v: number, sx: number) => {
    P.push(p.x * sx, p.y, p.z);
    const c = color.clone().multiplyScalar(0.7 + 0.3 * v);
    C.push(c.r, c.g, c.b);
    const edge = sm((v - 0.75) / 0.25) * 0.8 + sm((s - 0.85) / 0.15) * 0.6 + (Math.sin(s * 30) > 0.7 && v > 0.3 && v < 0.6 ? 0.5 : 0);
    G.push(glow.r * edge, glow.g * edge, glow.b * edge);
  };
  for (const sx of both ? [1, -1] : [1]) {
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const s0 = i / nu, s1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
      for (const [s, v] of [[s0, v0], [s1, v0], [s1, v1], [s0, v0], [s1, v1], [s0, v1]]) push(pt(s, v), s, v, sx);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(G, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A sky whale some 300 m long that swims a slow figure-eight over the whole world. Its body follows
 * its own path like a snake, so turns ripple down its length. Glowing tendrils hang from its belly,
 * a little garden glows on its back and it sheds spores behind its tail. Every minute or so it sings.
 */
export class Leviathan {
  readonly group = new THREE.Group();
  /** collision spheres along the body as x, y, z, r; refreshed every frame */
  readonly spheres: [number, number, number, number][] = [];
  /** 0..1 swell of light that follows each song */
  pulse = 0;
  /** set on the frame a song starts; the engine plays it and clears the flag */
  sang = false;
  speed = SPEED;
  private path = new Float32Array(PATH_N * 3);
  private cum = new Float32Array(PATH_N + 1);
  private total = 1;
  private s = 0;
  private songT = 25;
  private rising = false;
  private emitAcc = 0;
  private body: THREE.Mesh;
  private finL: THREE.Mesh;
  private finR: THREE.Mesh;
  private fluke: THREE.Mesh;
  private pts: THREE.Points;
  private ptsMat = makePointsMaterial(true);
  private pos: THREE.BufferAttribute;
  private nrm: THREE.BufferAttribute;
  private ppos: THREE.BufferAttribute;
  private psize: THREE.BufferAttribute;
  private tend: { u: number; th: number; len: number; ph: number }[] = [];
  private pods: { u: number; th: number }[] = [];
  private spore = { head: 0, age: new Float32Array(SPORES), vel: new Float32Array(SPORES * 3) };
  private frames: { c: THREE.Vector3; t: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3; r: number }[] = [];
  private tmp = new THREE.Vector3();

  constructor() {
    // body: a tube of NR rings with NS vertices each, rebuilt along the path every frame
    const n = NR * NS, col = new Float32Array(n * 3), glow = new Float32Array(n * 3), idx: number[] = [];
    const back = new THREE.Color('#24557d'), back2 = new THREE.Color('#3f8fa6'), belly = new THREE.Color('#d4eef2');
    const cyan = new THREE.Color('#5ff2d6'), violet = new THREE.Color('#b18cff'), c = new THREE.Color();
    for (let i = 0; i < NR; i++) {
      const u = i / (NR - 1);
      for (let j = 0; j < NS; j++) {
        const th = (j / NS) * TAU, sn = Math.sin(th), k = i * NS + j;
        const mott = 0.5 + 0.5 * Math.sin(u * 47 + Math.cos(th * 3) * 2.3) * Math.sin(u * 13 + th * 5);
        c.copy(back).lerp(back2, mott * 0.6).lerp(belly, sm((-sn - 0.15) / 0.6));
        c.toArray(col, k * 3);
        // rows of lights below the flanks, a dorsal seam, faint belly grooves near the head
        const flank = Math.exp(-(((sn + 0.35) / 0.12) ** 2)) * (Math.sin(u * 160) > 0.55 ? 1 : 0) * sm((u - 0.04) / 0.05) * sm((0.92 - u) / 0.1);
        const seam = Math.exp(-(((sn - 1) / 0.04) ** 2)) * (0.35 + 0.65 * (Math.sin(u * 40) > 0.2 ? 1 : 0)) * sm((0.85 - u) / 0.2);
        const groove = Math.abs(Math.sin(th * 9)) > 0.93 && sn < -0.5 && u < 0.4 ? 0.35 : 0;
        const eye = Math.exp(-(((u - 0.055) / 0.012) ** 2)) * Math.exp(-(((sn + 0.05) / 0.12) ** 2)) * 3;
        c.copy(cyan).multiplyScalar(flank + groove + eye).add(violet.clone().multiplyScalar(seam * 0.8));
        c.toArray(glow, k * 3);
        if (i < NR - 1) {
          const a = k, b = i * NS + ((j + 1) % NS), d = (i + 1) * NS + j, e = (i + 1) * NS + ((j + 1) % NS);
          idx.push(a, b, d, b, e, d);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.nrm = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('normal', this.nrm);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 3));
    g.setIndex(idx);
    const skin = bioMat({ roughness: 0.55, side: THREE.DoubleSide }, { base: 0.55, k: 1.5, detail: 0.05 });
    this.body = new THREE.Mesh(g, skin);
    this.body.frustumCulled = false;
    this.body.castShadow = true;

    const finMat = bioMat({ roughness: 0.6, side: THREE.DoubleSide }, { base: 0.6, k: 1.4, backlit: 0.9 });
    const finCol = new THREE.Color('#2c6c8c');
    this.finR = new THREE.Mesh(finGeometry(78, 34, 26, finCol, cyan, false), finMat);
    this.finL = new THREE.Mesh(this.finR.geometry, finMat);
    this.fluke = new THREE.Mesh(finGeometry(62, 26, 30, finCol, violet, true), finMat);
    for (const m of [this.finR, this.finL, this.fluke]) { m.matrixAutoUpdate = false; m.frustumCulled = false; }

    // glowing points: tendril beads, back garden pods, spore trail
    const np = TENDRILS * BEADS + PODS + SPORES, pc = new Float32Array(np * 3), ps = new Float32Array(np), ph = new Float32Array(np);
    const rand = mulberry32(911);
    for (let t = 0; t < TENDRILS; t++) {
      this.tend.push({ u: 0.1 + rand() * 0.5, th: -Math.PI / 2 + (rand() - 0.5) * 1.6, len: 40 + rand() * 60, ph: rand() * TAU });
      for (let b = 0; b < BEADS; b++) {
        const k = t * BEADS + b, w = b / (BEADS - 1);
        c.copy(cyan).lerp(violet, w * 0.8 + rand() * 0.2).toArray(pc, k * 3);
        ps[k] = 2.2 + (1 - w) * 1.6 + (b === BEADS - 1 ? 2.5 : 0); ph[k] = rand();
      }
    }
    const gold = new THREE.Color('#ffd36a'), rose = new THREE.Color('#ff7ae6');
    for (let p = 0; p < PODS; p++) {
      const k = TENDRILS * BEADS + p;
      this.pods.push({ u: 0.12 + rand() * 0.6, th: Math.PI / 2 + (rand() - 0.5) * 1.5 });
      c.copy(rand() < 0.7 ? gold : rose).toArray(pc, k * 3); ps[k] = 3 + rand() * 4; ph[k] = rand();
    }
    for (let p = 0; p < SPORES; p++) {
      const k = TENDRILS * BEADS + PODS + p;
      c.copy(cyan).lerp(gold, rand() * 0.6).toArray(pc, k * 3); ps[k] = 0; ph[k] = rand();
      this.spore.age[p] = 99;
    }
    const pg = new THREE.BufferGeometry();
    this.ppos = new THREE.BufferAttribute(new Float32Array(np * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.psize = new THREE.BufferAttribute(ps, 1).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('position', this.ppos);
    pg.setAttribute('aSize', this.psize);
    pg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    pg.setAttribute('aColor', new THREE.BufferAttribute(pc, 3));
    this.ptsMat.uniforms.uDrift.value = 0.4;
    this.ptsMat.uniforms.uBlink.value = 0.5;
    this.ptsMat.uniforms.uFar.value = 0.00025;
    this.pts = new THREE.Points(pg, this.ptsMat);
    this.pts.frustumCulled = false;

    for (let i = 0; i < NR; i++) this.frames.push({ c: new THREE.Vector3(), t: new THREE.Vector3(), side: new THREE.Vector3(), up: new THREE.Vector3(), r: radius(i / (NR - 1)) });
    this.group.add(this.body, this.finL, this.finR, this.fluke, this.pts);
  }

  /**
   * Lay out a figure-eight over the world, turned by the seed, and lift it smoothly over floating
   * isles and the Elder Tree so the whale never swims through rock.
   */
  build(seed: number, T: Terrain, isles: [number, number, number, number][], elder: [number, number, number]) {
    const rand = mulberry32(seed * 7 + 3), rot = rand() * TAU, cr = Math.cos(rot), sr = Math.sin(rot);
    const ax = 640, az = 440, ys = new Float32Array(PATH_N);
    const tall = [...isles.map(([x, y, z, R]) => [x, z, R + R0 + 30, y + R * 0.35] as const), [elder[0], elder[2], 150, elder[1] + 215] as const];
    for (let i = 0; i < PATH_N; i++) {
      const a = (i / PATH_N) * TAU, lx = ax * Math.sin(a), lz = az * Math.sin(2 * a);
      const x = lx * cr - lz * sr, z = lx * sr + lz * cr;
      let y = Math.max(250 + 35 * Math.sin(3 * a + 1), T.surface(x, z) + 150);
      for (const [ix, iz, rr, top] of tall) if (Math.hypot(x - ix, z - iz) < rr) y = Math.max(y, top + R0 + 45);
      this.path[i * 3] = x; this.path[i * 3 + 2] = z; ys[i] = y;
    }
    // max filter then blur along the loop: climbs start early and stay above every obstacle
    const W = 160, mx = new Float32Array(PATH_N);
    for (let i = 0; i < PATH_N; i++) { let m = -1e9; for (let k = -W; k <= W; k += 4) m = Math.max(m, ys[(i + k + PATH_N) % PATH_N]); mx[i] = m; }
    for (let i = 0; i < PATH_N; i++) { let s = 0, c = 0; for (let k = -W; k <= W; k += 4) { s += mx[(i + k + PATH_N) % PATH_N]; c++; } this.path[i * 3 + 1] = s / c; }
    this.cum[0] = 0;
    for (let i = 0; i < PATH_N; i++) {
      const j = (i + 1) % PATH_N;
      this.cum[i + 1] = this.cum[i] + Math.hypot(this.path[j * 3] - this.path[i * 3], this.path[j * 3 + 1] - this.path[i * 3 + 1], this.path[j * 3 + 2] - this.path[i * 3 + 2]);
    }
    this.total = this.cum[PATH_N];
    this.s = rand() * this.total;
    this.songT = 20 + rand() * 15;
    this.pulse = 0;
    this.spore.age.fill(99);
  }

  /** Point and unit tangent on the loop at arc length s. */
  private at(s: number, out: THREE.Vector3, tan: THREE.Vector3) {
    s = ((s % this.total) + this.total) % this.total;
    let lo = 0, hi = PATH_N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const i = lo, j = (i + 1) % PATH_N, f = (s - this.cum[i]) / Math.max(this.cum[i + 1] - this.cum[i], 1e-6), P = this.path;
    out.set(P[i * 3] + (P[j * 3] - P[i * 3]) * f, P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * f, P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * f);
    tan.set(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]).normalize();
  }

  /** Body frame at u (0 head, 1 tail), interpolated between rings. */
  frameAt(u: number) { return this.frames[Math.round(clamp(u, 0, 1) * (NR - 1))]; }

  /** Heading of the whale (unit vector). */
  get dir() { return this.frames[0].t; }

  /** Nearest body ring to p: its frame and the distance from the skin (negative inside). */
  nearest(p: THREE.Vector3) {
    let best = this.frames[0], bd = Infinity;
    for (let i = 0; i < NR; i += 3) { const f = this.frames[i], d = f.c.distanceTo(p) - f.r; if (d < bd) { bd = d; best = f; } }
    return { frame: best, skin: bd };
  }

  update(dt: number, t: number, glow: number, scale: number) {
    this.s += this.speed * dt;
    // song timer and the light swell after it
    this.songT -= dt;
    this.sang = false;
    if (this.songT < 0) { this.songT = 60 + Math.random() * 25; this.sang = true; this.rising = true; }
    if (this.rising) { this.pulse = Math.min(1, this.pulse + dt * 0.8); if (this.pulse >= 1) this.rising = false; }
    else this.pulse *= Math.exp(-dt * 0.35);

    // spine frames: each ring sits further back along the same path, plus a slow vertical wave
    for (let i = 0; i < NR; i++) {
      const u = i / (NR - 1), f = this.frames[i];
      this.at(this.s - u * LEN, f.c, f.t);
      f.c.y += (2 + 12 * u * u) * Math.sin(t * 0.55 - u * 5.2);
      f.side.crossVectors(f.t, UP).normalize();
      f.up.crossVectors(f.side, f.t).normalize();
    }
    // the wave tilts the tangent a little; recompute it from neighbours so fins follow the swell
    for (let i = 0; i < NR; i++) {
      const a = this.frames[Math.max(0, i - 1)].c, b = this.frames[Math.min(NR - 1, i + 1)].c;
      this.frames[i].t.subVectors(a, b).normalize();
    }

    const P = this.pos.array as Float32Array, N = this.nrm.array as Float32Array;
    for (let i = 0; i < NR; i++) {
      const f = this.frames[i], r = f.r;
      for (let j = 0; j < NS; j++) {
        const th = (j / NS) * TAU, cs = Math.cos(th), sn = Math.sin(th), hb = sn < 0 ? HY * 0.82 : HY, k = (i * NS + j) * 3;
        P[k] = f.c.x + f.side.x * cs * r * WX + f.up.x * sn * r * hb;
        P[k + 1] = f.c.y + f.side.y * cs * r * WX + f.up.y * sn * r * hb;
        P[k + 2] = f.c.z + f.side.z * cs * r * WX + f.up.z * sn * r * hb;
        const nx = f.side.x * cs / WX + f.up.x * sn / hb, ny = f.side.y * cs / WX + f.up.y * sn / hb, nz = f.side.z * cs / WX + f.up.z * sn / hb, l = Math.hypot(nx, ny, nz);
        N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l;
      }
    }
    this.pos.needsUpdate = this.nrm.needsUpdate = true;

    // pectoral fins row slowly, the flukes beat in time with the body wave
    const place = (m: THREE.Mesh, f: (typeof this.frames)[number], off: THREE.Vector3, mirror: number, rollA: number, pitchA: number) => {
      const x = f.side.clone().multiplyScalar(mirror), basis = new THREE.Matrix4().makeBasis(x, f.up, f.t);
      // a mirrored basis flips the fin to the other side; the same roll then lifts both tips together
      const rot = new THREE.Matrix4().makeRotationX(pitchA).multiply(new THREE.Matrix4().makeRotationZ(rollA));
      m.matrix.copy(basis).multiply(rot).setPosition(off);
      m.matrixWorldNeedsUpdate = true;
    };
    const ff = this.frameAt(0.27), fr = ff.r;
    const flapA = -0.12 + 0.22 * Math.sin(t * 0.45);
    place(this.finR, ff, ff.c.clone().addScaledVector(ff.side, fr * WX * 0.8).addScaledVector(ff.up, -fr * 0.3), 1, flapA, 0);
    place(this.finL, ff, ff.c.clone().addScaledVector(ff.side, -fr * WX * 0.8).addScaledVector(ff.up, -fr * 0.3), -1, flapA, 0);
    const ft = this.frames[NR - 1];
    place(this.fluke, ft, ft.c, 1, 0, 0.4 * Math.sin(t * 0.55 - 5.2 + 1.2));

    // tendrils hang and trail behind; pods sit on the back; spores drift down from the tail
    const PP = this.ppos.array as Float32Array, S = this.psize.array as Float32Array;
    const tmp = this.tmp;
    this.tend.forEach((td, ti) => {
      const f = this.frameAt(td.u), r = f.r, cs = Math.cos(td.th), sn = Math.sin(td.th);
      const root = tmp.copy(f.c).addScaledVector(f.side, cs * r * WX * 0.95).addScaledVector(f.up, sn * r * HY * 0.8);
      for (let b = 0; b < BEADS; b++) {
        const w = b / (BEADS - 1), d = w * td.len, k = (ti * BEADS + b) * 3;
        const sway = Math.sin(t * 0.7 + td.ph + w * 2.2) * w * w * 9;
        PP[k] = root.x - f.t.x * w * w * 26 + f.side.x * sway;
        PP[k + 1] = root.y - d;
        PP[k + 2] = root.z - f.t.z * w * w * 26 + f.side.z * sway;
      }
    });
    const pod0 = TENDRILS * BEADS;
    this.pods.forEach((pd, pi) => {
      const f = this.frameAt(pd.u), r = f.r, k = (pod0 + pi) * 3;
      tmp.copy(f.c).addScaledVector(f.side, Math.cos(pd.th) * r * WX).addScaledVector(f.up, Math.sin(pd.th) * r * HY + 1.5);
      PP[k] = tmp.x; PP[k + 1] = tmp.y; PP[k + 2] = tmp.z;
    });
    const sp0 = pod0 + PODS, sp = this.spore;
    const tail = this.frameAt(0.8);
    for (this.emitAcc += dt * 24; this.emitAcc >= 1; this.emitAcc--) {
      const i = sp.head = (sp.head + 1) % SPORES, k = (sp0 + i) * 3;
      const a = Math.random() * TAU, rr = tail.r * Math.random();
      tmp.copy(tail.c).addScaledVector(tail.side, Math.cos(a) * rr).addScaledVector(tail.up, Math.sin(a) * rr * 0.7);
      PP[k] = tmp.x; PP[k + 1] = tmp.y; PP[k + 2] = tmp.z;
      sp.vel[i * 3] = (Math.random() - 0.5) * 3; sp.vel[i * 3 + 1] = -1.5 - Math.random() * 2.5; sp.vel[i * 3 + 2] = (Math.random() - 0.5) * 3;
      sp.age[i] = 0;
    }
    for (let i = 0; i < SPORES; i++) {
      const k = (sp0 + i) * 3, a = (sp.age[i] += dt);
      if (a > 14) { S[sp0 + i] = 0; continue; }
      PP[k] += sp.vel[i * 3] * dt; PP[k + 1] += sp.vel[i * 3 + 1] * dt; PP[k + 2] += sp.vel[i * 3 + 2] * dt;
      S[sp0 + i] = 2.6 * Math.min(1, a * 2) * (1 - a / 14);
    }
    this.ppos.needsUpdate = this.psize.needsUpdate = true;
    this.ptsMat.uniforms.uScale.value = scale;
    this.ptsMat.uniforms.uInt.value = 0.55 + glow * 1.1 + this.pulse * 1.6;

    this.spheres.length = 0;
    for (let i = 2; i < NR; i += 5) { const f = this.frames[i]; this.spheres.push([f.c.x, f.c.y, f.c.z, f.r * 0.98]); }
  }

  /** A point near the front of the body, for markers and the compass. */
  get center() { return this.frames[Math.round(NR * 0.2)].c; }

  dispose() {
    this.body.geometry.dispose(); this.finR.geometry.dispose(); this.fluke.geometry.dispose(); this.pts.geometry.dispose();
  }
}
