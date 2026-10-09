import * as THREE from 'three';
import { TAU, clamp, lerp, makeNoise, mulberry32, sm, type Rand } from './noise';
import { V3, col, type GeoData } from './geometry';
import { INNER, BOUND, WL, Terrain, makeRegions, type Regions } from './terrain';
import { boulderGeo, elderTreeGeo, fernGeo, grassGeo, leafGeo, podGeo, shroomGeo, tendrilGeo, treeA, treeB, treeC, trumpetGeo, vineGeo, type Ctx } from './flora';
import { archGeo, isleGeo, spireGeo, type Isle } from './rocks';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITY: Record<Quality, { density: number; seg: number; isleDetail: number; grass: number }> = {
  low: { density: 0.38, seg: 240, isleDetail: 14, grass: 0.25 },
  medium: { density: 0.7, seg: 340, isleDetail: 19, grass: 0.6 },
  high: { density: 1, seg: 440, isleDetail: 22, grass: 0.8 },
};

/** Side length of the baked overview map, in pixels. */
export const MAP_SIZE = 512;

export type MatKey = 'terrain' | 'outer' | 'rock' | 'tree' | 'flora' | 'grass' | 'vine' | 'tendril' | 'elder';
export type Vec = [number, number, number];

export interface MeshData { geo: number; mat: MatKey; pos: Vec; rotY: number; scale: number }
export interface ChunkData { geo: number; mat: MatKey; matrices: Float32Array; colors: Float32Array | null; center: Vec; radius: number; maxDist: number; grass: boolean }
export interface PointsData { position: Float32Array; size: Float32Array; color: Float32Array; phase: Float32Array }
export interface PlaceData { name: string; sub: string; c: Vec; wps: Vec[] }
export interface Obstacle { t: 's' | 'c'; x: number; y: number; z: number; r: number; top: number }
export interface RingData { p: Vec; n: Vec }
export interface WorldData {
  seed: number;
  quality: Quality;
  seg: number;
  regions: Regions;
  heights: Float32Array;
  terrain: GeoData;
  outer: GeoData;
  geos: GeoData[];
  meshes: MeshData[];
  chunks: ChunkData[];
  falls: { position: Float32Array; uv: Float32Array; index: Uint32Array };
  points: { ff: PointsData; halo: PointsData; mist: PointsData };
  obstacles: Obstacle[];
  places: PlaceData[];
  rings: RingData[];
  seeds: Vec[];
  flocks: [number, number, number, number][];
  stats: { isles: number; plants: number };
  /** (seg+1)^2 RGBA: ground height, grass density, forest mask, sky occlusion */
  field: Float32Array;
  /** MAP_SIZE^2 RGBA overview map covering the inner terrain (INNER metres square) */
  map: Uint8ClampedArray;
  /** floating isles as x, y, z, R: a flattened dome on top and a tapering root below */
  isles: [number, number, number, number][];
  /** arch centres with their through-axis, for the map and collisions */
  arches: { c: Vec; ax: Vec; R: number; tube: number }[];
  /** base of the Elder Tree trunk */
  elder: Vec;
}

interface Item { p: THREE.Vector3; s: number | THREE.Vector3; ry?: number; c?: THREE.Color }
interface Pt { p: THREE.Vector3; s: number; c: THREE.Color }

const v = (p: THREE.Vector3): Vec => [p.x, p.y, p.z];

export function generateWorld(seed: number, quality: Quality): WorldData {
  const Q = QUALITY[quality];
  const N = makeNoise(seed);
  const rand: Rand = mulberry32(seed);
  const ctx: Ctx = { N, rand };
  const R = makeRegions(rand);
  const T = new Terrain(N, R, Q.seg);
  const { PK, TR, PL, LK, FO } = R;

  const geos: GeoData[] = [];
  const addGeo = (g: GeoData) => geos.push(g) - 1;
  const meshes: MeshData[] = [];
  const chunks: ChunkData[] = [];
  const obstacles: Obstacle[] = [];

  /* ---------------- terrain */
  const tg = new THREE.PlaneGeometry(INNER, INNER, Q.seg, Q.seg).rotateX(-Math.PI / 2);
  const P = tg.attributes.position.array as Float32Array;
  const heights = new Float32Array((Q.seg + 1) * (Q.seg + 1));
  for (let i = 0; i < P.length / 3; i++) { const h = T.H(P[i * 3], P[i * 3 + 2]); P[i * 3 + 1] = h; heights[i] = h; }
  T.heights = heights;
  tg.computeVertexNormals();
  const tn = tg.attributes.normal.array as Float32Array;
  const TC = new Float32Array(P.length), TG = new Float32Array(P.length);
  const cDeep = col('#1e4a2a'), cGrass = col('#4c8a34'), cMoss = col('#1f5a4c'), cRock = col('#5f6168'), cMud = col('#3e3a2c'), cDusk = col('#6a8a3a');
  const gTeal = col('#2fffd0'), gViolet = col('#9a5cff'), gGreen = col('#6dff8a'), tmp = new THREE.Color();
  for (let i = 0; i < P.length / 3; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], ny = tn[i * 3 + 1];
    const m = N.n2(x * 0.008, z * 0.008) + 0.5, fo = T.forestMask(x, z);
    tmp.copy(cDeep).lerp(cGrass, clamp(m, 0, 1)).lerp(cMoss, fo * 0.5);
    tmp.lerp(cDusk, sm(1 - Math.hypot(x - PL.x, z - PL.z) / 400) * 0.4);
    tmp.lerp(cRock, sm((1 - ny - 0.28) / 0.3)).lerp(cRock, sm((y - 220) / 140) * 0.8);
    if (y < WL + 2.5) tmp.lerp(cMud, sm((WL + 2.5 - y) / 2));
    TC[i * 3] = tmp.r; TC[i * 3 + 1] = tmp.g; TC[i * 3 + 2] = tmp.b;
    let gr = 0, gg = 0, gb = 0;
    const vein = Math.abs(N.n2(x * 0.011 + 50, z * 0.011 - 20)), patch = N.n2(x * 0.035, z * 0.035);
    const live = (1 - sm((y - 140) / 60)) * (y > WL + 0.5 ? 1 : 0) * sm((ny - 0.6) / 0.2);
    if (vein < 0.035) { const k = (1 - vein / 0.035) * 1.1 * (0.35 + fo); gr += gTeal.r * k; gg += gTeal.g * k; gb += gTeal.b * k; }
    if (patch > 0.32) {
      const k = (patch - 0.32) * 3.5 * (0.3 + fo), c = Math.hypot(x - LK.x, z - LK.z) < 420 ? gViolet : gTeal;
      gr += c.r * k; gg += c.g * k; gb += c.b * k;
    }
    const pp = N.n2(x * 0.09, z * 0.09);
    if (pp > 0.42) { const k = (pp - 0.42) * 3 * (1 - fo * 0.5) * 0.6; gr += gGreen.r * k; gg += gGreen.g * k; gb += gGreen.b * k; }
    TG[i * 3] = gr * live * 0.5; TG[i * 3 + 1] = gg * live * 0.5; TG[i * 3 + 2] = gb * live * 0.5;
  }
  const terrain: GeoData = {
    position: P, normal: tn, color: TC, glow: TG,
    index: new Uint32Array((tg.index as THREE.BufferAttribute).array as ArrayLike<number>), radius: INNER,
  };

  // Coarse outer skirt so the horizon is mountains, not an edge.
  const og = new THREE.PlaneGeometry(9000, 9000, 150, 150).rotateX(-Math.PI / 2);
  const OP = og.attributes.position.array as Float32Array, OC = new Float32Array(OP.length);
  for (let i = 0; i < OP.length / 3; i++) {
    const x = OP[i * 3], z = OP[i * 3 + 2], inside = Math.max(Math.abs(x), Math.abs(z)) < INNER / 2 - 30, h = T.H(x, z);
    OP[i * 3 + 1] = inside ? h - 30 : h;
    tmp.copy(cRock).lerp(cDeep, clamp(N.n2(x * 0.003, z * 0.003) + 0.5, 0, 1));
    OC[i * 3] = tmp.r; OC[i * 3 + 1] = tmp.g; OC[i * 3 + 2] = tmp.b;
  }
  og.computeVertexNormals();
  const outer: GeoData = {
    position: OP, normal: og.attributes.normal.array as Float32Array, color: OC, glow: new Float32Array(OP.length),
    index: new Uint32Array((og.index as THREE.BufferAttribute).array as ArrayLike<number>), radius: 6400,
  };

  const items: Record<string, Item[]> = { a: [], b: [], c: [], pod: [], tru: [], fern: [], leaf: [], shroom: [], grass: [], vine: [], tend: [] };
  const ff: Pt[] = [], halo: Pt[] = [], mist: Pt[] = [];
  const white = col('#ffffff');
  const tint = () => new THREE.Color().setHSL(0, 0, 0.82 + rand() * 0.36);
  const fallP: number[] = [], fallUV: number[] = [], fallI: number[] = [];

  /* ---------------- floating isles */
  const variants: { isle: Isle; idx: number }[] = [];
  for (let i = 0; i < 10; i++) { const isle = isleGeo(N, i * 13.7 + (seed % 97), Q.isleDetail); variants.push({ isle, idx: addGeo(isle.geo) }); }
  interface IsleInst { c: THREE.Vector3; R: number; v: (typeof variants)[number]; ry: number }
  const isles: IsleInst[] = [];
  function addIsles(cx: number, cz: number, spread: number, count: number, ymin: number, ymax: number, rmin: number, rmax: number) {
    let tries = 0;
    while (count > 0 && tries++ < 4000) {
      const a = rand() * TAU, d = Math.sqrt(rand()) * spread, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const Rr = lerp(rmin, rmax, Math.pow(rand(), 1.8));
      const y = T.surface(x, z) + lerp(ymin, ymax, rand()) + Rr;
      if (Math.hypot(x, z) > BOUND - 60) continue;
      const c = new V3(x, y, z);
      if (isles.some(o => o.c.distanceTo(c) < (o.R + Rr) * 1.25 + 12)) continue;
      isles.push({ c, R: Rr, v: variants[(rand() * variants.length) | 0], ry: rand() * TAU });
      count--;
    }
  }
  addIsles(PK.x, PK.z, 420, 38, 90, 380, 16, 82);
  addIsles(PL.x, PL.z, 380, 9, 200, 380, 10, 40);
  addIsles(LK.x, LK.z, 260, 6, 120, 260, 14, 46);
  addIsles(TR.x, TR.z, 520, 5, 260, 380, 12, 36);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new V3();
  for (const is of isles) {
    meshes.push({ geo: is.v.idx, mat: 'rock', pos: v(is.c), rotY: is.ry, scale: is.R });
    obstacles.push({ t: 's', x: is.c.x, y: is.c.y - is.R * 0.45, z: is.c.z, r: is.R * 1.05, top: 0 });
    m4.compose(is.c, q.setFromEuler(e.set(0, is.ry, 0)), sv.setScalar(is.R));
    const tops = is.v.isle.tops, rims = is.v.isle.rims;
    const top = () => { const k = ((rand() * tops.length) / 3 | 0) * 3; return new V3(tops[k], tops[k + 1], tops[k + 2]).applyMatrix4(m4); };
    if (tops.length) {
      const nt = Math.round(is.R * 0.35);
      for (let i = 0; i < nt; i++) {
        const p = top(), r = rand();
        if (r < 0.45) items.c.push({ p, s: 0.4 + rand() * 0.5, ry: rand() * TAU, c: tint() });
        else if (r < 0.6) items.a.push({ p, s: 0.3 + rand() * 0.25, ry: rand() * TAU, c: tint() });
        else if (r < 0.8) items.leaf.push({ p, s: 1 + rand(), ry: rand() * TAU });
        else items.pod.push({ p, s: 1 + rand() * 0.6, ry: rand() * TAU });
      }
      for (let i = 0; i < is.R * 1.1 * Q.grass; i++) items.grass.push({ p: top(), s: 1 + rand() * 0.6, ry: rand() * TAU });
    }
    if (rims.length) {
      const rim = () => {
        const k = ((rand() * rims.length) / 5 | 0) * 5;
        const p = new V3(rims[k], rims[k + 1], rims[k + 2]).applyMatrix4(m4);
        const n = new V3(rims[k + 3], 0, rims[k + 4]).applyAxisAngle(new V3(0, 1, 0), is.ry);
        return { p, n };
      };
      const nv = Math.round(is.R * 0.7 * (0.5 + Q.density * 0.5));
      for (let i = 0; i < nv; i++) items.vine.push({ p: rim().p, s: new V3(1, lerp(6, 32, rand()) * (is.R / 50 + 0.4), 1), ry: rand() * TAU });
      if (is.R > 34 && rand() < 0.55) {
        const { p, n } = rim();
        const w = is.R * 0.16 + 3, L = is.R * 2.4 + 60, rows = 30, ry = Math.atan2(n.x, n.z);
        const base = fallP.length / 3;
        const o = p.clone().addScaledVector(n, -1.5);
        for (let j = 0; j <= rows; j++) {
          const t = j / rows;
          for (const sx of [-0.5, 0.5]) {
            const lp = new V3(sx * w, -t * L, 7 * (1 - Math.exp(-t * 9)) + t * 6).applyAxisAngle(new V3(0, 1, 0), ry).add(o);
            fallP.push(lp.x, lp.y, lp.z);
            fallUV.push(sx + 0.5, 1 - t);
          }
          if (j < rows) { const a = base + j * 2; fallI.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        }
        for (let j = 0; j < 10; j++) mist.push({ p: new V3(p.x + n.x * 12 + (rand() - 0.5) * 30, p.y - L * (0.55 + rand() * 0.4), p.z + n.z * 12 + (rand() - 0.5) * 30), s: 60 + rand() * 90, c: white });
      }
    }
    for (let j = 0; j < 3; j++) mist.push({ p: is.c.clone().add(new V3((rand() - 0.5) * is.R * 2, -is.R * (1 + rand() * 1.5), (rand() - 0.5) * is.R * 2)), s: is.R * 3 + rand() * 80, c: white });
  }

  /* ---------------- spires + arches */
  const spires: { x: number; z: number; r: number }[] = [];
  for (let i = 0, tries = 0; i < 22 && tries < 500; tries++) {
    const a = rand() * TAU, d = Math.sqrt(rand()) * 430, x = PK.x + Math.cos(a) * d, z = PK.z + Math.sin(a) * d;
    const h = 110 + rand() * 230, r = 12 + rand() * 22;
    if (obstacles.some(o => o.t === 'c' && Math.hypot(o.x - x, o.z - z) < o.r + r + 40)) continue;
    if (isles.some(o => Math.hypot(o.c.x - x, o.c.z - z) < o.R + r + 10 && o.c.y - o.R * 2.2 < T.groundY(x, z) + h)) continue;
    const gy = T.groundY(x, z);
    if (gy < WL - 4) continue;
    meshes.push({ geo: addGeo(spireGeo(N, h, r, rand() * 99)), mat: 'rock', pos: [x, gy - 6, z], rotY: 0, scale: 1 });
    obstacles.push({ t: 'c', x, y: gy, z, r: r * 1.4, top: gy + h });
    spires.push({ x, z, r });
    const top = new V3(x, gy - 6 + h * 0.985, z);
    for (let j = 0; j < 4; j++) items.c.push({ p: top.clone().add(new V3((rand() - 0.5) * r, 0, (rand() - 0.5) * r)), s: 0.4 + rand() * 0.4, ry: rand() * TAU });
    for (let j = 0; j < 10; j++) { const aa = rand() * TAU; items.vine.push({ p: new V3(x + Math.cos(aa) * r * 0.95, gy + h * 0.93, z + Math.sin(aa) * r * 0.95), s: new V3(1, 8 + rand() * 30, 1) }); }
    i++;
  }
  const arches: { c: THREE.Vector3; ax: THREE.Vector3; base: THREE.Vector3; R: number; tube: number }[] = [];
  for (let i = 0; i < 2; i++) {
    const Ra = i ? 46 : 72, tube = i ? 8 : 11;
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 60 && !ok; tries++) {
      const a = rand() * TAU, d = 120 + rand() * 220;
      x = PK.x + Math.cos(a) * d; z = PK.z + Math.sin(a) * d;
      ok = !obstacles.some(o => (o.t === 'c' ? Math.hypot(o.x - x, o.z - z) < o.r + Ra + 30 : Math.hypot(o.x - x, o.z - z) < o.r + Ra + 20 && o.y - o.r < T.surface(x, z) + Ra * 1.6));
    }
    const ry = rand() * Math.PI, base = new V3(x, T.surface(x, z) - tube * 0.6, z);
    meshes.push({ geo: addGeo(archGeo(N, Ra, tube, rand() * 50)), mat: 'rock', pos: v(base), rotY: ry, scale: 1 });
    for (let k = 0; k <= 8; k++) {
      const t = (k / 8) * Math.PI;
      const p = new V3(Math.cos(t) * Ra, Math.sin(t) * Ra, 0).applyAxisAngle(new V3(0, 1, 0), ry).add(base);
      obstacles.push({ t: 's', x: p.x, y: p.y, z: p.z, r: tube * 1.7, top: 0 });
      if (k > 1 && k < 7) for (let j = 0; j < 6; j++) items.vine.push({ p: p.clone().add(new V3((rand() - 0.5) * 6, -tube * 0.8, (rand() - 0.5) * 6)), s: new V3(1, 6 + rand() * 22, 1) });
    }
    arches.push({ c: base.clone().add(new V3(0, Ra * 0.45, 0)), ax: new V3(0, 0, 1).applyAxisAngle(new V3(0, 1, 0), ry), base, R: Ra, tube });
  }

  /* ---------------- elder tree */
  const tgx = TR.x, tgz = TR.z, tgy = T.groundY(tgx, tgz);
  meshes.push({ geo: addGeo(elderTreeGeo(ctx)), mat: 'elder', pos: [tgx, tgy, tgz], rotY: 0, scale: 1 });
  const tendrils = Math.round(2600 * (0.4 + Q.density * 0.6));
  for (let k = 0; k < tendrils; k++) {
    const a = rand() * TAU, r = 12 + Math.sqrt(rand()) * 102, y = tgy + 140 + Math.cos((r / 100) * 1.4) * 36 - 6;
    const L = 18 + rand() * rand() * 80, p = new V3(tgx + Math.cos(a) * r, y, tgz + Math.sin(a) * r);
    items.tend.push({ p, s: new V3(1, L, 1), ry: rand() * TAU });
    if (k % 4 === 0) halo.push({ p: p.clone().add(new V3(0, -L, 0)), s: 5 + rand() * 4, c: rand() < 0.5 ? col('#7a6bff') : col('#4ff6ff') });
  }
  for (let k = 0; k < 500; k++) { const a = rand() * TAU, r = rand() * 190; ff.push({ p: new V3(tgx + Math.cos(a) * r, tgy + 10 + rand() * 170, tgz + Math.sin(a) * r), s: 1.6 + rand() * 1.8, c: col('#e8fbff') }); }
  obstacles.push({ t: 's', x: tgx, y: tgy + 175, z: tgz, r: 120, top: 0 }, { t: 'c', x: tgx, y: tgy, z: tgz, r: 42, top: tgy + 150 });

  /* ---------------- ground light: sky occlusion baked into the terrain, plus a field texture for the GPU */
  const W = Q.seg + 1, cell = INNER / Q.seg;
  const ao = new Float32Array(W * W);
  {
    const dirs = [[1, 0], [0.707, 0.707], [0, 1], [-0.707, 0.707], [-1, 0], [-0.707, -0.707], [0, -1], [0.707, -0.707]];
    const steps = [2, 5, 11];
    for (let iz = 0; iz < W; iz++) for (let ix = 0; ix < W; ix++) {
      const h0 = heights[iz * W + ix];
      let occ = 0;
      for (const [dx, dz] of dirs) {
        let m = 0;
        for (const s of steps) {
          const jx = Math.min(W - 1, Math.max(0, Math.round(ix + dx * s))), jz = Math.min(W - 1, Math.max(0, Math.round(iz + dz * s)));
          const dh = Math.max(heights[jz * W + jx], WL) - h0;
          if (dh > 0) m = Math.max(m, dh / Math.hypot(dh, s * cell));
        }
        occ += m;
      }
      ao[iz * W + ix] = 1 - Math.min(0.72, (occ / 8) * 1.15);
    }
    // floating isles, spires and the Elder Tree canopy all block skylight from the ground below them
    const occlude = (cx: number, cz: number, rad: number, k: (d: number, gy: number) => number) => {
      const i0 = Math.max(0, Math.floor((cx - rad + INNER / 2) / cell)), i1 = Math.min(W - 1, Math.ceil((cx + rad + INNER / 2) / cell));
      const j0 = Math.max(0, Math.floor((cz - rad + INNER / 2) / cell)), j1 = Math.min(W - 1, Math.ceil((cz + rad + INNER / 2) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(-INNER / 2 + i * cell - cx, -INNER / 2 + j * cell - cz);
        if (d < rad) ao[j * W + i] *= 1 - k(d, heights[j * W + i]);
      }
    };
    for (const is of isles) {
      const rad = is.R * 1.7;
      occlude(is.c.x, is.c.z, rad, (d, gy) => (1 - sm(d / rad)) * clamp(1.25 - (is.c.y - gy) / (is.R * 7), 0, 1) * 0.5);
    }
    for (const s of spires) occlude(s.x, s.z, s.r * 2.6, d => (1 - sm(d / (s.r * 2.6))) * 0.38);
    occlude(tgx, tgz, 140, d => (1 - sm(d / 140)) * 0.5);
  }
  const field = new Float32Array(W * W * 4);
  for (let i = 0; i < W * W; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], ny = tn[i * 3 + 1];
    for (let k = 0; k < 3; k++) TC[i * 3 + k] *= 0.35 + 0.65 * ao[i];
    const fo = T.forestMask(x, z), pl = T.plainsMask(x, z), lk = T.lakeMask(x, z);
    let g = (y > WL + 0.8 ? 1 : 0) * sm((ny - 0.78) / 0.12) * (1 - sm((y - 170) / 60));
    g *= clamp(0.62 + pl * 0.38 + lk * 0.2 - fo * 0.18, 0, 1);
    g *= 0.45 + 0.55 * sm((N.n2(x * 0.018, z * 0.018) + 0.25) / 0.5);
    if (Math.hypot(x - tgx, z - tgz) < 60) g *= 0.4;
    field[i * 4] = y; field[i * 4 + 1] = g; field[i * 4 + 2] = fo; field[i * 4 + 3] = ao[i];
  }

  /* ---------------- ground flora */
  const D = Q.density;
  function scatter(n: number, tries: number, dens: (x: number, z: number) => number, minClear = 0) {
    const out: THREE.Vector3[] = [];
    n = Math.round(n * D);
    for (let t = 0; t < tries && out.length < n; t++) {
      const x = (rand() * 2 - 1) * 1150, z = (rand() * 2 - 1) * 1150;
      if (rand() > dens(x, z)) continue;
      const y = T.groundY(x, z);
      if (y < WL + 0.6 || y > 200) continue;
      if (T.slopeAt(x, z) > 0.75) continue;
      if (minClear && Math.hypot(x - tgx, z - tgz) < minClear) continue;
      if (obstacles.some(o => o.t === 'c' && Math.hypot(o.x - x, o.z - z) < o.r * 0.8)) continue;
      out.push(new V3(x, y - 0.25, z));
    }
    return out;
  }
  const fm = (x: number, z: number) => T.forestMask(x, z), pm = (x: number, z: number) => T.plainsMask(x, z), lm = (x: number, z: number) => T.lakeMask(x, z);
  scatter(520, 60000, (x, z) => fm(x, z) * 0.85, 95).forEach(p => items.a.push({ p: p.setY(p.y - 1), s: 0.7 + rand() * 0.7, ry: rand() * TAU, c: tint() }));
  scatter(130, 40000, (x, z) => pm(x, z) * 0.35 + lm(x, z) * 0.12 + fm(x, z) * 0.05, 95).forEach(p => items.b.push({ p: p.setY(p.y - 1), s: 0.75 + rand() * 0.6, ry: rand() * TAU, c: tint() }));
  scatter(520, 60000, (x, z) => fm(x, z) * 0.5 + lm(x, z) * 0.6 + 0.04, 60).forEach(p => items.c.push({ p, s: 0.7 + rand() * 0.8, ry: rand() * TAU, c: tint() }));
  scatter(2600, 90000, (x, z) => fm(x, z) * 0.7 + lm(x, z) * 0.8 + 0.03).forEach(p => {
    items.pod.push({ p, s: 0.8 + rand() * 0.9, ry: rand() * TAU });
    if (rand() < 0.5) halo.push({ p: p.clone().add(new V3(0, 1.6, 0)), s: 7 + rand() * 5, c: col('#33e8ff') });
  });
  scatter(900, 60000, (x, z) => fm(x, z) * 0.5 + lm(x, z) * 0.9 + 0.03).forEach(p => {
    items.tru.push({ p, s: 0.8 + rand() * 0.8, ry: rand() * TAU });
    if (rand() < 0.4) halo.push({ p: p.clone().add(new V3(0, 2.4, 0)), s: 5, c: col('#ff4fd0') });
  });
  scatter(700, 40000, (x, z) => fm(x, z) * 0.6 + 0.05).forEach(p => items.fern.push({ p, s: 1 + rand() * 0.9, ry: rand() * TAU }));
  scatter(4500, 90000, (x, z) => fm(x, z) * 0.9 + lm(x, z) * 0.5 + 0.08).forEach(p => items.leaf.push({ p, s: 0.8 + rand() * 1.2, ry: rand() * TAU }));
  scatter(1400, 60000, (x, z) => fm(x, z) * 0.6 + 0.03).forEach(p => items.shroom.push({ p, s: 0.9 + rand() * 1.2, ry: rand() * TAU }));
  items.boulder = [];
  scatter(900, 60000, (x, z) => sm(1 - Math.hypot(x - PK.x, z - PK.z) / 480) * 0.8 + lm(x, z) * 0.25 + pm(x, z) * 0.08 + 0.03)
    .forEach(p => items.boulder.push({ p: p.setY(p.y - 0.4), s: 1.2 + rand() * rand() * 4.5, ry: rand() * TAU }));
  scatter(15000 * Q.grass / D, 120000, (x, z) => pm(x, z) * 0.95 + lm(x, z) * 0.4 + (1 - fm(x, z)) * 0.25).forEach(p => items.grass.push({ p, s: 0.8 + rand() * 0.8, ry: rand() * TAU }));
  scatter(5200, 60000, (x, z) => fm(x, z) * 0.7 + pm(x, z) * 0.6 + lm(x, z) * 0.7 + 0.05).forEach(p => {
    const r = rand();
    ff.push({ p: p.clone().add(new V3(0, 1 + rand() * 22, 0)), s: 1 + rand() * 1.6, c: r < 0.5 ? col('#4dffe0') : r < 0.8 ? col('#9dff6a') : r < 0.9 ? col('#ff6ad8') : col('#ffd36a') });
  });
  for (let i = 0; i < 260 * (0.5 + D * 0.5); i++) {
    const a = rand() * TAU, d = Math.sqrt(rand()) * 450, x = PK.x + Math.cos(a) * d, z = PK.z + Math.sin(a) * d;
    mist.push({ p: new V3(x, T.surface(x, z) + 20 + rand() * 90, z), s: 120 + rand() * 160, c: white });
  }
  for (let i = 0; i < 90; i++) {
    const a = rand() * TAU, d = Math.sqrt(rand()) * 300;
    mist.push({ p: new V3(LK.x + Math.cos(a) * d, WL + 8 + rand() * 20, LK.z + Math.sin(a) * d), s: 90 + rand() * 100, c: white });
  }

  /* ---------------- instanced chunks */
  function instanced(g: GeoData, mat: MatKey, list: Item[], tile: number, maxDist: number, grass = false) {
    if (!list.length) return;
    const gi = addGeo(g);
    const buckets = new Map<string, Item[]>();
    for (const it of list) {
      const k = Math.floor(it.p.x / tile) + ',' + Math.floor(it.p.z / tile);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(it);
    }
    for (const b of buckets.values()) {
      const matrices = new Float32Array(b.length * 16);
      const hasCol = b.some(it => it.c);
      const colors = hasCol ? new Float32Array(b.length * 3).fill(1) : null;
      const ctr = new V3();
      b.forEach((it, i) => {
        e.set(0, it.ry || 0, 0); q.setFromEuler(e);
        if (typeof it.s === 'number') sv.setScalar(it.s); else sv.copy(it.s);
        m4.compose(it.p, q, sv);
        m4.toArray(matrices, i * 16);
        if (colors && it.c) it.c.toArray(colors, i * 3);
        ctr.add(it.p);
      });
      ctr.divideScalar(b.length);
      let radius = 0;
      for (const it of b) {
        const s = typeof it.s === 'number' ? it.s : Math.max(it.s.x, it.s.y, it.s.z);
        radius = Math.max(radius, it.p.distanceTo(ctr) + g.radius * s);
      }
      chunks.push({ geo: gi, mat, matrices, colors, center: v(ctr), radius, maxDist, grass });
    }
  }
  const third = (l: Item[], k: number, n: number) => l.filter((_, i) => i % n === k);
  for (let k = 0; k < 3; k++) instanced(treeA(ctx), 'tree', third(items.a, k, 3), 500, 2600);
  for (let k = 0; k < 2; k++) instanced(treeB(ctx), 'tree', third(items.b, k, 2), 500, 2600);
  for (let k = 0; k < 2; k++) instanced(treeC(ctx), 'tree', third(items.c, k, 2), 500, 2000);
  instanced(podGeo(ctx), 'flora', items.pod, 250, 620);
  instanced(trumpetGeo(ctx), 'flora', items.tru, 250, 620);
  instanced(fernGeo(ctx), 'flora', items.fern, 250, 460);
  instanced(leafGeo(ctx), 'flora', items.leaf, 250, 560);
  instanced(shroomGeo(ctx), 'flora', items.shroom, 250, 460);
  instanced(boulderGeo(ctx), 'rock', items.boulder, 400, 1200);
  instanced(grassGeo(ctx), 'grass', items.grass, 250, 480, true);
  instanced(vineGeo(), 'vine', items.vine, 600, 2400);
  instanced(tendrilGeo(), 'tendril', items.tend, 600, 3000);

  /* ---------------- places + waypoints */
  const gp = (x: number, z: number, dy: number) => new V3(x, T.surface(x, z) + dy, z);
  const pkIsles = isles.filter(o => Math.hypot(o.c.x - PK.x, o.c.z - PK.z) < 460);
  const gaps: THREE.Vector3[] = [];
  for (let i = 0; i < 14 && pkIsles.length > 1; i++) {
    const A = pkIsles[(rand() * pkIsles.length) | 0];
    let B: IsleInst | null = null, bd = 1e9;
    for (const o of pkIsles) { const d = o.c.distanceTo(A.c); if (o !== A && d < bd) { bd = d; B = o; } }
    if (B) gaps.push(A.c.clone().lerp(B.c, 0.5).add(new V3(0, -Math.min(A.R, B.R) * 0.3, 0)));
  }
  const clearAt = (p: THREE.Vector3, m: number) =>
    p.y > T.surface(p.x, p.z) + 25 &&
    !obstacles.some(o => (o.t === 's' ? Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z) < o.r + m : p.y < o.top + m && Math.hypot(p.x - o.x, p.z - o.z) < o.r + m));
  const clearGaps = gaps.filter(g => clearAt(g, 18));
  const peakWps: THREE.Vector3[] = [];
  for (const a of arches) peakWps.push(a.c.clone().addScaledVector(a.ax, -90), a.c.clone(), a.c.clone().addScaledVector(a.ax, 90));
  peakWps.push(...clearGaps.slice(0, 8));
  if (!peakWps.length) peakWps.push(gp(PK.x, PK.z, 190));

  const places: PlaceData[] = [
    { name: 'Hanging Peaks', sub: 'Floating mountains spilling waterfalls into the mist', c: v(gp(PK.x, PK.z, 190)), wps: peakWps.map(v) },
    {
      name: 'Elder Tree', sub: 'A 200 m tree that glows from within', c: [tgx, tgy + 110, tgz],
      wps: Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * TAU; return [tgx + Math.cos(a) * 175, tgy + 70 + (i % 2) * 60, tgz + Math.sin(a) * 175] as Vec; }).concat([[tgx, tgy + 270, tgz]]),
    },
    { name: 'Lumen Forest', sub: 'Rainforest floor that lights up under every wingbeat', c: v(gp(FO.x, FO.z, 70)), wps: Array.from({ length: 7 }, () => { const a = rand() * TAU, d = rand() * 320; return v(gp(FO.x + Math.cos(a) * d, FO.z + Math.sin(a) * d, 62 + rand() * 25)); }) },
    { name: 'Amber Plains', sub: 'Open meadows under drifting islands', c: v(gp(PL.x, PL.z, 40)), wps: Array.from({ length: 7 }, (_, i) => { const a = rand() * TAU, d = rand() * 330; return v(gp(PL.x + Math.cos(a) * d, PL.z + Math.sin(a) * d, i < 5 ? 14 : 150)); }) },
    { name: 'Mirror Lake', sub: 'Still water under a banded gas giant', c: [LK.x, WL + 40, LK.z], wps: Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * TAU; return [LK.x + Math.cos(a) * 190, WL + (i % 2 ? 12 : 45), LK.z + Math.sin(a) * 190] as Vec; }) },
  ];
  // Keep waypoints clear of rock so autopilot never aims into a mountain.
  for (const pl of places) for (const w of pl.wps) {
    const p = new V3(...w);
    for (let k = 0; k < 12 && !clearAt(p, 10); k++) p.y += 15;
    w[0] = p.x; w[1] = p.y; w[2] = p.z;
  }

  /* ---------------- ring race course through the peaks */
  const rings: RingData[] = [];
  {
    type Node = { pts: THREE.Vector3[]; c: THREE.Vector3 };
    const nodes: Node[] = arches.map(a => ({ pts: [a.c.clone().addScaledVector(a.ax, -70), a.c.clone(), a.c.clone().addScaledVector(a.ax, 70)], c: a.c.clone() }));
    for (const g of clearGaps) if (nodes.length < 9 && nodes.every(n => n.c.distanceTo(g) > 90)) nodes.push({ pts: [g], c: g });
    for (let i = 0; nodes.length < 7 && i < 200; i++) {
      const a = rand() * TAU, d = 80 + rand() * 340, p = gp(PK.x + Math.cos(a) * d, PK.z + Math.sin(a) * d, 40 + rand() * 120);
      if (clearAt(p, 25) && nodes.every(n => n.c.distanceTo(p) > 110)) nodes.push({ pts: [p], c: p });
    }
    // nearest-neighbour tour from the node farthest from the peaks centre
    const centre = new V3(PK.x, nodes.reduce((s, n) => s + n.c.y, 0) / Math.max(1, nodes.length), PK.z);
    const order: Node[] = [];
    let cur = nodes.slice().sort((a, b) => b.c.distanceTo(centre) - a.c.distanceTo(centre))[0];
    const left = new Set(nodes);
    let last: THREE.Vector3 | null = null;
    while (cur) {
      left.delete(cur);
      let pts = cur.pts;
      if (last && pts.length > 1 && pts[pts.length - 1].distanceTo(last) < pts[0].distanceTo(last)) pts = pts.slice().reverse();
      order.push({ pts, c: cur.c });
      last = pts[pts.length - 1];
      let best: Node | undefined, bd = 1e9;
      for (const n of left) { const d = n.c.distanceTo(last); if (d < bd) { bd = d; best = n; } }
      cur = best as Node;
    }
    const seq = order.flatMap(n => n.pts);
    seq.forEach((p, i) => {
      const a = seq[Math.max(0, i - 1)], b = seq[Math.min(seq.length - 1, i + 1)];
      const n = b.clone().sub(a).normalize();
      rings.push({ p: v(p), n: v(n) });
    });
  }

  /* ---------------- drift seeds (collectibles) */
  const seeds: Vec[] = [];
  for (const pl of places) for (const w of pl.wps) for (let k = 0; k < 2; k++) {
    const p = new V3(w[0] + (rand() - 0.5) * 120, w[1] + (rand() - 0.5) * 50, w[2] + (rand() - 0.5) * 120);
    p.y = Math.max(p.y, T.surface(p.x, p.z) + 14);
    if (clearAt(p, 8)) seeds.push(v(p));
  }
  for (let i = 0; seeds.length < 60 && i < 400; i++) {
    const a = rand() * TAU, d = Math.sqrt(rand()) * 950, p = gp(Math.cos(a) * d, Math.sin(a) * d, 18 + rand() * 160);
    if (clearAt(p, 8)) seeds.push(v(p));
  }
  seeds.length = Math.min(seeds.length, 60);

  const flocks: [number, number, number, number][] = [
    [PK.x, T.surface(PK.x, PK.z) + 260, PK.z, 220],
    [PL.x, T.surface(PL.x, PL.z) + 120, PL.z, 180],
  ];

  const points = { ff: toPoints(ff, rand), halo: toPoints(halo, rand), mist: toPoints(mist, rand) };
  const plants = Object.values(items).reduce((s, l) => s + l.length, 0);
  const map = bakeMap(T, ao, W, isles, spires, arches, { x: tgx, z: tgz });

  return {
    seed, quality, seg: Q.seg, regions: R, heights, terrain, outer, geos, meshes, chunks,
    falls: { position: new Float32Array(fallP), uv: new Float32Array(fallUV), index: new Uint32Array(fallI) },
    points, obstacles, places, rings, seeds, flocks, stats: { isles: isles.length, plants }, field, map,
    isles: isles.map(o => [o.c.x, o.c.y, o.c.z, o.R]),
    arches: arches.map(a => ({ c: v(a.c), ax: v(a.ax), R: a.R, tube: a.tube })),
    elder: [tgx, tgy, tgz],
  };
}

/** Hill-shaded overview map with water depth, biomes, floating isles and their shadows. */
function bakeMap(
  T: Terrain, ao: Float32Array, W: number,
  isles: { c: THREE.Vector3; R: number }[], spires: { x: number; z: number; r: number }[],
  arches: { base: THREE.Vector3; ax: THREE.Vector3; R: number; tube: number }[], elder: { x: number; z: number },
) {
  const S = MAP_SIZE, px = INNER / S, img = new Uint8ClampedArray(S * S * 4), N = T.N;
  const hex = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  const mixc = (a: number[], b: number[], t: number) => { t = clamp(t, 0, 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  const C = {
    deep: hex(0x0d2f4a), shallow: hex(0x2d8a94), grass: hex(0x3b7438), grassHi: hex(0x6a9a4a), amber: hex(0xa3a656),
    forest: hex(0x1b4632), rock: hex(0x7d786f), rockDark: hex(0x4f535a), sand: hex(0x8d8262),
    isle: hex(0x5a9644), isleHi: hex(0x86b85a), isleRim: hex(0x6b655c), elder: hex(0x1d5a46), glow: hex(0x5ff2d6),
  };
  const L = new V3(-0.5, 0.75, -0.42).normalize();
  const put = (i: number, c: number[]) => { img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255; };
  for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) {
    const x = -INNER / 2 + (u + 0.5) * px, z = -INNER / 2 + (v + 0.5) * px, h = T.groundY(x, z), i = (v * S + u) * 4;
    if (h < WL) {
      const ripple = N.n2(x * 0.05, z * 0.05) * 0.08;
      put(i, mixc(C.shallow, C.deep, (WL - h) / 16 + ripple));
      continue;
    }
    const e = 4, hx = T.groundY(x + e, z) - T.groundY(x - e, z), hz = T.groundY(x, z + e) - T.groundY(x, z - e);
    const n = new V3(-hx, 2 * e, -hz).normalize();
    let c = mixc(C.grass, C.grassHi, N.n2(x * 0.01, z * 0.01) + 0.5);
    c = mixc(c, C.forest, T.forestMask(x, z) * 0.9);
    c = mixc(c, C.amber, T.plainsMask(x, z) * 0.55);
    c = mixc(c, C.rock, sm((1 - n.y - 0.25) / 0.3));
    c = mixc(c, C.rockDark, sm((h - 200) / 160));
    if (h < WL + 2) c = mixc(c, C.sand, (WL + 2 - h) / 2);
    const gi = Math.min(W - 1, Math.round((z + INNER / 2) / (INNER / (W - 1)))) * W + Math.min(W - 1, Math.round((x + INNER / 2) / (INNER / (W - 1))));
    const shade = (0.55 + 0.75 * Math.max(0, n.dot(L))) * (0.55 + 0.45 * ao[gi]);
    put(i, [c[0] * shade, c[1] * shade, c[2] * shade]);
  }
  const disc = (cx: number, cz: number, r: number, fn: (i: number, t: number, dx: number, dz: number) => void) => {
    const u0 = Math.max(0, Math.floor((cx - r + INNER / 2) / px)), u1 = Math.min(S - 1, Math.ceil((cx + r + INNER / 2) / px));
    const v0 = Math.max(0, Math.floor((cz - r + INNER / 2) / px)), v1 = Math.min(S - 1, Math.ceil((cz + r + INNER / 2) / px));
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
      const dx = -INNER / 2 + (u + 0.5) * px - cx, dz = -INNER / 2 + (v + 0.5) * px - cz, d = Math.hypot(dx, dz);
      if (d < r) fn((v * S + u) * 4, d / r, dx / r, dz / r);
    }
  };
  const darken = (k: number) => (i: number, t: number) => { const f = 1 - k * (1 - sm((t - 0.6) / 0.4)); img[i] *= f; img[i + 1] *= f; img[i + 2] *= f; };
  const sorted = isles.slice().sort((a, b) => a.c.y - b.c.y);
  for (const is of sorted) disc(is.c.x + is.R * 0.45, is.c.z + is.R * 0.55, is.R * 1.1, darken(0.45));
  for (const is of sorted) {
    disc(is.c.x, is.c.z, is.R * 0.98, (i, t, dx, dz) => {
      const edge = t + N.n2(dx * 3 + is.c.x, dz * 3) * 0.12;
      if (edge > 1) return;
      const lit = 0.8 + 0.35 * clamp(-(dx * 0.6 + dz * 0.5), -1, 1);
      const c = edge > 0.84 ? C.isleRim : mixc(C.isle, C.isleHi, N.n2(dx * 4 + is.c.z, dz * 4) + 0.5);
      put(i, [c[0] * lit, c[1] * lit, c[2] * lit]);
    });
  }
  for (const s of spires) {
    disc(s.x + s.r * 0.5, s.z + s.r * 0.6, s.r * 1.3, darken(0.4));
    disc(s.x, s.z, s.r * 1.15, (i, t, dx, dz) => { const lit = 0.85 + 0.3 * clamp(-(dx * 0.6 + dz * 0.5), -1, 1); const c = t < 0.6 ? C.isle : C.rock; put(i, [c[0] * lit, c[1] * lit, c[2] * lit]); });
  }
  for (const a of arches) {
    const side = new V3(a.ax.z, 0, -a.ax.x);
    for (let k = -1; k <= 1; k += 0.05) disc(a.base.x + side.x * a.R * k, a.base.z + side.z * a.R * k, a.tube * 1.3, i => put(i, C.rock));
  }
  disc(elder.x + 30, elder.z + 36, 128, darken(0.45));
  disc(elder.x, elder.z, 118, (i, t, dx, dz) => {
    const edge = t + N.n2(dx * 5, dz * 5) * 0.06;
    if (edge > 1) return;
    put(i, edge > 0.94 ? C.glow : mixc(C.elder, C.isle, N.n2(dx * 6 + 3, dz * 6) * 0.6 + 0.3));
  });
  return img;
}

function toPoints(list: Pt[], rand: Rand): PointsData {
  const n = list.length;
  const position = new Float32Array(n * 3), size = new Float32Array(n), color = new Float32Array(n * 3), phase = new Float32Array(n);
  list.forEach((it, i) => { it.p.toArray(position, i * 3); size[i] = it.s; it.c.toArray(color, i * 3); phase[i] = rand(); });
  return { position, size, color, phase };
}

/** Every transferable buffer in the world, so postMessage moves instead of copying. */
export function transferables(w: WorldData): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (a?: ArrayBufferView | null) => { if (a) out.add(a.buffer as ArrayBuffer); };
  const geo = (g: GeoData) => { add(g.position); add(g.normal); add(g.color); add(g.glow); add(g.uv); add(g.index); };
  add(w.heights); add(w.field); add(w.map); geo(w.terrain); geo(w.outer); w.geos.forEach(geo);
  w.chunks.forEach(c => { add(c.matrices); add(c.colors); });
  add(w.falls.position); add(w.falls.uv); add(w.falls.index);
  for (const p of Object.values(w.points)) { add(p.position); add(p.size); add(p.color); add(p.phase); }
  return [...out];
}

