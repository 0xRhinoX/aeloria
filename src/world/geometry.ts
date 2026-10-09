import * as THREE from 'three';
import type { Noise } from './noise';

/** Plain typed arrays so geometry can cross the worker boundary without copies. */
export interface GeoData {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  glow: Float32Array;
  index?: Uint32Array;
  radius: number;
}
export interface Part { P: Float32Array; N: Float32Array; C: Float32Array; G: Float32Array }
export type Shade = THREE.Color | ((x: number, y: number, z: number, nx: number, ny: number, nz: number) => THREE.Color);

export const V3 = THREE.Vector3;
export const BLACK = new THREE.Color(0);
export const col = (h: string | number) => new THREE.Color(h);
export const mix3 = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));

/** Smooth normals for non-indexed geometry, welding vertices that share a key position. */
export function smoothNormals(geo: THREE.BufferGeometry, keys?: ArrayLike<number>) {
  const P = geo.attributes.position.array as Float32Array;
  const K = keys || P;
  const n = P.length / 3;
  const acc = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const a = i * 3, b = a + 3, c = a + 6;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (let k = 0; k < 3; k++) { acc[a + k * 3] = nx; acc[a + k * 3 + 1] = ny; acc[a + k * 3 + 2] = nz; }
  }
  const map = new Map<number, number>();
  const id = new Int32Array(n);
  const sum: number[] = [];
  for (let i = 0; i < n; i++) {
    const key =
      Math.round(K[i * 3] * 2000 + 8e3) * 2.56e8 + Math.round(K[i * 3 + 1] * 2000 + 8e3) * 16000 + Math.round(K[i * 3 + 2] * 2000 + 8e3);
    let s = map.get(key);
    if (s === undefined) { s = sum.length / 3; map.set(key, s); sum.push(0, 0, 0); }
    id[i] = s;
    sum[s * 3] += acc[i * 3]; sum[s * 3 + 1] += acc[i * 3 + 1]; sum[s * 3 + 2] += acc[i * 3 + 2];
  }
  const Nn = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = id[i] * 3;
    const l = Math.hypot(sum[s], sum[s + 1], sum[s + 2]) || 1;
    Nn[i * 3] = sum[s] / l; Nn[i * 3 + 1] = sum[s + 1] / l; Nn[i * 3 + 2] = sum[s + 2] / l;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  return geo;
}

/** Bake a geometry plus per-vertex colour and glow into a mergeable part. */
export function part(geo: THREE.BufferGeometry, c: Shade, gl: Shade = BLACK): Part {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const P = g.attributes.position.array as Float32Array, Nn = g.attributes.normal.array as Float32Array;
  const C = new Float32Array(n * 3), G = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = Nn[i * 3], ny = Nn[i * 3 + 1], nz = Nn[i * 3 + 2];
    const a = typeof c === 'function' ? c(x, y, z, nx, ny, nz) : c;
    const b = typeof gl === 'function' ? gl(x, y, z, nx, ny, nz) : gl;
    C[i * 3] = a.r; C[i * 3 + 1] = a.g; C[i * 3 + 2] = a.b;
    G[i * 3] = b.r; G[i * 3 + 1] = b.g; G[i * 3 + 2] = b.b;
  }
  return { P: Float32Array.from(P), N: Float32Array.from(Nn), C, G };
}

export function merge(parts: Part[]): GeoData {
  let n = 0;
  for (const p of parts) n += p.P.length;
  const position = new Float32Array(n), normal = new Float32Array(n), color = new Float32Array(n), glow = new Float32Array(n);
  let o = 0;
  for (const p of parts) { position.set(p.P, o); normal.set(p.N, o); color.set(p.C, o); glow.set(p.G, o); o += p.P.length; }
  let radius = 0;
  for (let i = 0; i < n; i += 3) radius = Math.max(radius, Math.hypot(position[i], position[i + 1], position[i + 2]));
  return { position, normal, color, glow, radius };
}

export function toBufferGeometry(d: GeoData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.color, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(d.glow, 3));
  if (d.index) g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeBoundingSphere();
  return g;
}

export function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, r2?: number, seg = 7) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r2 ?? r * 0.8, r, len, seg, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

export function blob(N: Noise, detail: number, sx: number, sy: number, sz: number, amp: number, off: number) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const P = g.attributes.position.array as Float32Array, K = Float32Array.from(P);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2], r = 1 + N.n3(x * 1.8 + off, y * 1.8, z * 1.8 - off) * amp;
    P[i] = x * r * sx; P[i + 1] = y * r * sy; P[i + 2] = z * r * sz;
  }
  return smoothNormals(g, K);
}

export function lathe(profile: [number, number][], seg: number) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)), seg);
  const ng = g.toNonIndexed();
  return smoothNormals(ng, Float32Array.from(ng.attributes.position.array as Float32Array));
}
