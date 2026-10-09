import * as THREE from 'three';
import { lerp, makeNoise, type Rand } from '../world/noise';
import { BLACK, V3, col, lathe, limb, merge, part, type Part } from '../world/geometry';
import { bioMat } from './materials';

export interface MountPalette { id: string; name: string; a: string; b: string; belly: string; glow: string }
export interface RiderDef { name: string; skin: string; pal: MountPalette }

export const RIDERS: RiderDef[] = [
  { name: 'Kaelo', skin: '#3f74c4', pal: { id: 'ember', name: 'Ember', a: '#d9531e', b: '#1fb5a3', belly: '#f2c48d', glow: '#ffcc55' } },
  { name: 'Sora', skin: '#4a86d0', pal: { id: 'tidewing', name: 'Tidewing', a: '#1d5fbf', b: '#5ff2e0', belly: '#d6f0ff', glow: '#7ffcff' } },
  { name: 'Tavi', skin: '#3a6cb8', pal: { id: 'vesper', name: 'Vesper', a: '#6a2fbf', b: '#ff5fd2', belly: '#e9d0ff', glow: '#ff7ae6' } },
  { name: 'Ruun', skin: '#4479bf', pal: { id: 'mossback', name: 'Mossback', a: '#2f7a3a', b: '#e8d23a', belly: '#dff0b0', glow: '#b8ff5a' } },
  { name: 'Ilsa', skin: '#3d70c0', pal: { id: 'crimson', name: 'Crimson Veil', a: '#a3122a', b: '#ffb21f', belly: '#ffd9b0', glow: '#ffd15a' } },
  { name: 'Oru', skin: '#4680cc', pal: { id: 'frost', name: 'Frost', a: '#dfe8f2', b: '#3a8fe0', belly: '#ffffff', glow: '#9fe3ff' } },
];

/** Colourways unlocked by collecting drift seeds. */
export const SEED_PALETTES: { at: number; pal: MountPalette }[] = [
  { at: 10, pal: { id: 'aurora', name: 'Aurora', a: '#2a1a6e', b: '#4dffb0', belly: '#d0f0ff', glow: '#8affd6' } },
  { at: 25, pal: { id: 'obsidian', name: 'Obsidian', a: '#15161c', b: '#ff5a2a', belly: '#3a3a44', glow: '#ff7a3a' } },
  { at: 45, pal: { id: 'sunbloom', name: 'Sunbloom', a: '#ffb21f', b: '#ff4f8a', belly: '#fff0c0', glow: '#ffe066' } },
];

const SYL = ['ka', 'ri', 'tho', 'mel', 'va', 'sen', 'ly', 'or', 'quin', 'the', 'za', 'ru', 'ne', 'shi', 'ae', 'lo'];
export function wildPalette(rand: Rand, n: number): MountPalette {
  const h = rand(), name = (SYL[(rand() * 16) | 0] + SYL[(rand() * 16) | 0] + (rand() < 0.5 ? SYL[(rand() * 16) | 0] : '')).replace(/^./, c => c.toUpperCase());
  const c = (hh: number, s: number, l: number) => '#' + new THREE.Color().setHSL(((hh % 1) + 1) % 1, s, l).getHexString();
  return { id: `wild-${n}-${name.toLowerCase()}`, name, a: c(h, 0.65, 0.35), b: c(h + 0.35 + rand() * 0.3, 0.85, 0.55), belly: c(h + 0.05, 0.4, 0.82), glow: c(h + 0.5, 1, 0.65) };
}

export const swatch = (p: MountPalette) => `linear-gradient(135deg,${p.a} 0 45%,${p.b} 45% 70%,${p.glow} 70%)`;

const NR = makeNoise(42);

function membrane(lead: (u: number) => THREE.Vector3, trail: (u: number) => THREE.Vector3, nu: number, nv: number,
  cfn: (u: number, v: number) => THREE.Color, gfn: (u: number, v: number) => THREE.Color): Part {
  const P: number[] = [], uv: number[] = [];
  const pt = (u: number, v: number) => lead(u).lerp(trail(u), v);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
    const a = pt(u0, v0), b = pt(u1, v0), c = pt(u1, v1), d = pt(u0, v1);
    P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  const n = P.length / 3, C = new Float32Array(n * 3), G = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = cfn(uv[i * 2], uv[i * 2 + 1]), gg = gfn(uv[i * 2], uv[i * 2 + 1]);
    C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b;
    G[i * 3] = gg.r; G[i * 3 + 1] = gg.g; G[i * 3 + 2] = gg.b;
  }
  return { P: new Float32Array(P), N: Float32Array.from(g.attributes.normal.array as Float32Array), C, G };
}

function geoOf(parts: Part[]) {
  const d = merge(parts), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.color, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(d.glow, 3));
  return g;
}

const mountMat = bioMat({ roughness: 0.48, side: THREE.DoubleSide }, { base: 0.7, k: 0.8 });
const membraneMat = bioMat({ roughness: 0.62, side: THREE.DoubleSide }, { base: 0.7, k: 0.8, backlit: 0.85 });
const riderMat = bioMat({ roughness: 0.55 }, { base: 0.25, k: 0.9 });

export interface Mount {
  root: THREE.Group;
  body: THREE.Group;
  wings: { inner: THREE.Group; outer: THREE.Group }[];
  tail: THREE.Group[];
  /** wingtip anchors (right, left) for light trails */
  tips: THREE.Object3D[];
  head: THREE.Object3D | null;
}

/** A tube swept along a curve whose radius eases from r0 to r1. */
function taperTube(curve: THREE.Curve<THREE.Vector3>, n: number, r0: number, r1: number, radial: number, squash = 1) {
  const frames = curve.computeFrenetFrames(n, false), P: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, c = curve.getPointAt(t), r = lerp(r0, r1, t), N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, cs = Math.cos(a) * r, sn = Math.sin(a) * r * squash;
      P.push(c.x + N.x * cs + B.x * sn, c.y + N.y * cs + B.y * sn, c.z + N.z * cs + B.z * sn);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A winged skywing: smooth lathed body, tapered neck, crest and dorsal fins, ribbed two-segment wings, finned tail. */
export function buildMountBody(d: MountPalette): Omit<Mount, 'root' | 'head'> {
  const A = col(d.a), B = col(d.b), Be = col(d.belly), Gl = col(d.glow);
  const body = new THREE.Group(), parts: Part[] = [];
  const stripe = (x: number, _y: number, z: number, _nx: number, ny: number) =>
    ny < -0.3 ? Be : Math.sin(z * 3.4 + Math.abs(x) * 3.2) > 0.3 ? B : Math.sin(z * 9 + x * 4) > 0.85 ? B.clone().lerp(A, 0.5) : A;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    prof.push([0.06 + 0.95 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.9) * (1 + 0.08 * Math.sin(t * 9)), lerp(-3.4, 3, t)]);
  }
  const torso = lathe(prof, 20); torso.rotateX(Math.PI / 2); torso.scale(0.85, 0.72, 1);
  parts.push(part(torso, stripe, (_x, _y, z, _nx, ny) => (ny > 0.62 && (((z * 1.6) % 1) + 1) % 1 < 0.2 ? Gl.clone().multiplyScalar(1.1) : BLACK)));
  const neckCurve = new THREE.CatmullRomCurve3([new V3(0, 0.05, 2.3), new V3(0, 0.6, 3.7), new V3(0, 0.95, 4.7), new V3(0, 0.98, 5.6)]);
  parts.push(part(taperTube(neckCurve, 20, 0.62, 0.36, 12, 0.85), stripe));
  const hp: [number, number][] = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; hp.push([0.52 * Math.sin(Math.PI * (0.28 + 0.72 * t)) * (1 - t * 0.2), t * 2.6]); }
  const head = lathe(hp, 16); head.rotateX(Math.PI / 2); head.scale(0.85, 0.62, 1); head.rotateX(0.18); head.translate(0, 0.98, 5.3);
  parts.push(part(head, stripe));
  const jaw = lathe(hp.map(([r, y]) => [r * 0.7, y * 0.85] as [number, number]), 12); jaw.rotateX(Math.PI / 2); jaw.scale(0.75, 0.4, 1); jaw.rotateX(0.32); jaw.translate(0, 0.72, 5.45);
  parts.push(part(jaw, Be));
  const crest = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.6, 1.5), new THREE.Vector2(1.6, 1.2), new THREE.Vector2(2.9, 1.9), new THREE.Vector2(3.6, 0.4), new THREE.Vector2(1.8, 0)]));
  crest.rotateY(Math.PI / 2); crest.translate(0, 1.1, 6.4);
  parts.push(part(crest, B, (_x, y) => Gl.clone().multiplyScalar(y > 2.1 ? 1.3 : 0.15)));
  // dorsal fins from the neck down to the tail base
  for (let i = 0; i < 9; i++) {
    const z = 4.6 - i * 0.85, h = 0.55 - Math.abs(i - 3) * 0.05, y = i < 3 ? 0.95 - i * 0.15 : 0.62 - (i - 3) * 0.04;
    const fin = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.25, h), new THREE.Vector2(0.7, 0)]));
    fin.rotateY(Math.PI / 2); fin.translate(0, y, z);
    parts.push(part(fin, B, (_x, yy) => Gl.clone().multiplyScalar(yy > y + h * 0.6 ? 1.4 : 0.1)));
  }
  for (const s of [-1, 1]) {
    const fin = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.3, 0.5), new THREE.Vector2(1.6, -0.3)]));
    fin.rotateY(Math.PI / 2); fin.rotateZ(s * 0.9); fin.translate(s * 0.42, 0.9, 6.2);
    parts.push(part(fin, B, Gl.clone().multiplyScalar(0.3)));
    const eye = new THREE.SphereGeometry(0.12, 10, 8); eye.translate(s * 0.36, 1.05, 6.85);
    parts.push(part(eye, col('#ffffff'), Gl.clone().multiplyScalar(2.6)));
    // tucked hind legs with claws
    const hip = new V3(s * 0.45, -0.3, -1.2), knee = new V3(s * 0.62, -0.95, -1.75), ankle = new V3(s * 0.5, -1.05, -2.7);
    parts.push(part(limb(hip, knee, 0.24, 0.15, 8), A), part(limb(knee, ankle, 0.14, 0.09, 8), A));
    for (let k = -1; k <= 1; k++) parts.push(part(limb(ankle, ankle.clone().add(new V3(k * 0.12 * s, -0.12, -0.38)), 0.05, 0.01, 5), col('#e8e0d0')));
  }
  const bm = new THREE.Mesh(geoOf(parts), mountMat);
  bm.castShadow = true;
  body.add(bm);

  const wings: Mount['wings'] = [];
  const tips: THREE.Object3D[] = [];
  for (const s of [1, -1]) {
    const side = new THREE.Group(); side.scale.x = s; side.position.set(0, 0.4, 1.1); body.add(side);
    const inner = new THREE.Group(); inner.position.set(0.6, 0, 0); side.add(inner);
    const wc = (u: number, v: number) => (Math.sin(u * 16) > 0.45 && v > 0.2 ? B : A).clone().lerp(Be, v > 0.85 ? 0.4 : 0);
    const innerLead = (u: number) => new V3(5 * u, 0.05 * Math.sin(Math.PI * u), 0.9 + 0.1 * u);
    const innerTrail = (u: number) => new V3(5 * u, 0, -2.4 + 0.4 * u - 0.3 * Math.sin(Math.PI * u));
    const iw = membrane(innerLead, innerTrail, 14, 6, wc, (_u, v) => (v > 0.9 ? Gl.clone().multiplyScalar(0.5) : BLACK));
    const ib = part(taperTube(new THREE.CatmullRomCurve3([0, 0.5, 1].map(innerLead)), 6, 0.17, 0.12, 8), A);
    const irib = part(taperTube(new THREE.LineCurve3(new V3(4.8, 0, 0.9), innerTrail(0.62)), 3, 0.07, 0.03, 5), A);
    const im = new THREE.Mesh(geoOf([iw]), membraneMat), ibm = new THREE.Mesh(geoOf([ib, irib]), mountMat);
    im.castShadow = ibm.castShadow = true;
    inner.add(im, ibm);
    const outer = new THREE.Group(); outer.position.set(5, 0, 0); inner.add(outer);
    const lead = (u: number) => new V3(6.8 * u, 0.12 * Math.sin(Math.PI * u), 1 - 2.4 * u * u);
    const trail = (u: number) => new V3(6.8 * u, 0, lerp(-2, -1.4, u) - 0.6 * Math.sin(Math.PI * u));
    const ow = membrane(lead, trail, 18, 6, (u, v) => wc(u + 1, v), (u, v) => (v > 0.88 || u > 0.9 ? Gl.clone().multiplyScalar(0.85) : BLACK));
    const ob = part(taperTube(new THREE.CatmullRomCurve3([0, 0.25, 0.5, 0.75, 1].map(lead)), 12, 0.12, 0.03, 6), A);
    // finger bones fanning from the wrist to the trailing edge
    const ribs = [0.3, 0.55, 0.8].map(u => part(taperTube(new THREE.LineCurve3(new V3(0.2, 0.02, 0.6), trail(u)), 3, 0.06, 0.02, 5), A));
    const om = new THREE.Mesh(geoOf([ow]), membraneMat), obm = new THREE.Mesh(geoOf([ob, ...ribs]), mountMat);
    om.castShadow = obm.castShadow = true;
    outer.add(om, obm);
    const tip = new THREE.Object3D(); tip.position.set(6.7, 0, -1.35); outer.add(tip);
    tips.push(tip);
    wings.push({ inner, outer });
  }
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = body;
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group(); g.position.set(0, 0, i ? -0.72 : -3.2); parent.add(g);
    const r = 0.34 * (1 - i / 10), c = new THREE.CylinderGeometry(r * 0.8, r, 0.76, 10, 1, true);
    c.rotateX(Math.PI / 2); c.translate(0, 0, -0.36);
    const ps = [part(c, stripe)];
    if (i === 8) for (const s of [1, -1]) {
      ps.push(membrane(u => new V3(0, 0, -0.7 - u * 2.6), u => new V3(0, s * 1.35 * Math.sin(Math.PI * Math.pow(u, 0.8)), -0.7 - u * 2.6), 8, 3, () => B, (_u, v) => Gl.clone().multiplyScalar(v > 0.6 ? 1.1 : 0.1)));
    }
    const tm = new THREE.Mesh(geoOf(ps), i === 8 ? membraneMat : mountMat);
    tm.castShadow = true;
    g.add(tm);
    tail.push(g); parent = g;
  }
  body.traverse(o => { if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; });
  return { body, wings, tail, tips };
}

/** A tall, slender rider with skin stripes, glowing freckles and a braid. */
export function buildRider(skinHex: string) {
  const S = col(skinHex), Sd = S.clone().multiplyScalar(0.6), hair = col('#1a1420'), parts: Part[] = [];
  const skin = (x: number, y: number) => (Math.sin(y * 14 + Math.sin(x * 9) * 2) > 0.55 ? Sd : S);
  const freck = (x: number, y: number, z: number) => (NR.n3(x * 18, y * 18, z * 18) > 0.42 ? col('#7ffcff').multiplyScalar(0.9) : BLACK);
  const add = (g: THREE.BufferGeometry, c: Parameters<typeof part>[1] = skin, gl: Parameters<typeof part>[2] = freck) => parts.push(part(g, c, gl));
  const sph = (r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const g = new THREE.SphereGeometry(r, 12, 10); g.scale(sx, sy, sz); g.translate(x, y, z); return g;
  };
  add(sph(0.2, 1.2, 0.8, 1, 0, 0.2, 0));
  const torso = new THREE.CapsuleGeometry(0.19, 0.55, 4, 10); torso.scale(1.25, 1, 0.85); torso.rotateX(0.35); torso.translate(0, 0.7, 0.14); add(torso);
  add(limb(new V3(0, 1.02, 0.26), new V3(0, 1.26, 0.34), 0.075, 0.07));
  add(sph(0.165, 0.85, 1.15, 1.05, 0, 1.42, 0.4));
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.05, 0.2, 6); ear.rotateZ(-s * 1.0); ear.translate(s * 0.17, 1.48, 0.36); add(ear);
    const sh = new V3(s * 0.25, 1.02, 0.27), el = new V3(s * 0.32, 0.78, 0.62), ha = new V3(s * 0.13, 0.74, 0.98);
    add(limb(sh, el, 0.07, 0.06)); add(limb(el, ha, 0.06, 0.045)); add(sph(0.06, 1, 1, 1, ha.x, ha.y, ha.z));
    const band = new THREE.TorusGeometry(0.065, 0.018, 5, 10); band.rotateX(Math.PI / 2);
    band.translate(lerp(el.x, ha.x, 0.7), lerp(el.y, ha.y, 0.7), lerp(el.z, ha.z, 0.7));
    add(band, col('#e0b060'), col('#5ff2d6').multiplyScalar(1.5));
    const hip = new V3(s * 0.16, 0.12, 0), kn = new V3(s * 0.64, -0.06, 0.45), an = new V3(s * 0.62, -0.62, 0.22);
    add(limb(hip, kn, 0.1, 0.08)); add(limb(kn, an, 0.075, 0.055));
  }
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new V3(0, 1.52, 0.3), new V3(0, 1.36, 0.1), new V3(0, 1.0, -0.12), new V3(0.05, 0.6, -0.28), new V3(0.08, 0.3, -0.35)]), 16, 0.055, 6), hair, BLACK);
  add(sph(0.172, 0.9, 1.05, 1.08, 0, 1.47, 0.36), (_x, y, z) => (z > 0.48 && y < 1.55 ? S : hair), BLACK);
  const cloth = new THREE.CylinderGeometry(0.24, 0.28, 0.22, 10, 1, true); cloth.translate(0, 0.17, 0);
  add(cloth, col('#6b4a2a'), BLACK);
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geoOf(parts), riderMat);
  mesh.frustumCulled = false;
  g.add(mesh);
  g.scale.setScalar(1.3);
  const head = new THREE.Object3D(); head.position.set(0, 1.46, 0.62); g.add(head);
  return { group: g, head };
}

export function disposeTree(o: THREE.Object3D) {
  o.traverse(c => { const m = c as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
}

/**
 * Wing and tail animation shared by ridden and wild mounts.
 * amp is flap strength (0 glide, 1 full beat); tuck folds the wings back for a dive.
 */
export function animateMount(m: Pick<Mount, 'wings' | 'tail'>, flap: number, amp: number, t: number, roll: number, pitch: number, salt: number, tuck = 0) {
  const s = Math.sin(flap), flutter = Math.sin(t * 11 + salt) * 0.012 * (1 - amp);
  for (const w of m.wings) {
    w.inner.rotation.z = s * 0.62 * amp + 0.06 - tuck * 0.12 + flutter;
    w.inner.rotation.y = -Math.cos(flap) * 0.12 * amp - tuck * 0.5;
    w.outer.rotation.z = Math.sin(flap - 0.7) * 0.55 * amp + 0.04 + tuck * 0.3 + flutter * 1.5;
    w.outer.rotation.y = -tuck * 0.95;
  }
  m.tail.forEach((g, i) => {
    g.rotation.y = Math.sin(t * 1.4 - i * 0.55 + salt) * 0.07 - roll * 0.035;
    g.rotation.x = Math.sin(t * 1.1 - i * 0.4) * 0.035 + pitch * 0.05;
  });
}
