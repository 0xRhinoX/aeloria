import * as THREE from 'three';
import type { Noise } from './noise';

/** Plain typed arrays so geometry can cross the worker boundary without copies. */
export interface GeoData {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  glow: Float32Array;
  uv?: Float32Array;
  index?: Uint32Array;
  radius: number;
}
/** P positions, N normals, C colours, G glow, U optional atlas uvs. */
export interface Part { P: Float32Array; N: Float32Array; C: Float32Array; G: Float32Array; U?: Float32Array }

/**
 * Foliage atlas layout (built on the main thread in engine/leaves.ts):
 * three leaf-cluster cells and one solid cell that opaque parts sample.
 */
export const ATLAS = {
  broad: [0, 0.5],
  round: [0.5, 0.5],
  frond: [0, 0],
  solid: [0.75, 0.25],
} as const;
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
  const withUV = parts.some(p => p.U);
  const uv = withUV ? new Float32Array((n / 3) * 2) : undefined;
  let o = 0;
  for (const p of parts) {
    position.set(p.P, o); normal.set(p.N, o); color.set(p.C, o); glow.set(p.G, o);
    if (uv) {
      if (p.U) uv.set(p.U, (o / 3) * 2);
      else for (let i = (o / 3) * 2, e = ((o + p.P.length) / 3) * 2; i < e; i += 2) { uv[i] = ATLAS.solid[0]; uv[i + 1] = ATLAS.solid[1]; }
    }
    o += p.P.length;
  }
  let radius = 0;
  for (let i = 0; i < n; i += 3) radius = Math.max(radius, Math.hypot(position[i], position[i + 1], position[i + 2]));
  return { position, normal, color, glow, uv, radius };
}

/**
 * Leaf cards scattered over an ellipsoid canopy blob. Each card keeps the blob's outward
 * normal so the canopy shades as one soft volume while its silhouette breaks into leaves.
 */
export function cards(
  rand: () => number,
  c: THREE.Vector3, rx: number, ry: number, rz: number, count: number, size: number,
  cell: readonly [number, number],
  shade: (nx: number, ny: number, nz: number, depth: number) => THREE.Color,
  glow: (nx: number, ny: number, nz: number) => THREE.Color,
): Part {
  const P = new Float32Array(count * 18), Nn = new Float32Array(count * 18), C = new Float32Array(count * 18), G = new Float32Array(count * 18), U = new Float32Array(count * 12);
  const d = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Vector3();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < count; k++) {
    // directions biased upward and outward, a few hanging below
    const yy = rand() * 1.55 - 0.55, a = rand() * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - yy * yy));
    d.set(Math.cos(a) * r, yy, Math.sin(a) * r);
    const depth = 0.72 + rand() * 0.38;
    const px = c.x + d.x * rx * depth, py = c.y + d.y * ry * depth, pz = c.z + d.z * rz * depth;
    n.set(d.x / rx, d.y / ry, d.z / rz).normalize();
    // card plane: outward normal tilted at random, spun around it
    q.set(n.x + (rand() - 0.5) * 1.6, n.y + (rand() - 0.5) * 1.2, n.z + (rand() - 0.5) * 1.6).normalize();
    t.set(0, 1, 0).cross(q);
    if (t.lengthSq() < 1e-4) t.set(1, 0, 0);
    t.normalize();
    b.crossVectors(q, t).normalize();
    const spin = rand() * Math.PI * 2, cs = Math.cos(spin), sn = Math.sin(spin);
    const s = size * (0.7 + rand() * 0.6) * 0.5;
    const col = shade(n.x, n.y, n.z, depth), gl = glow(n.x, n.y, n.z);
    corners.forEach(([u, w], j) => {
      const cu = u * cs - w * sn, cw = u * sn + w * cs;
      const o = k * 18 + j * 3;
      P[o] = px + (t.x * cu + b.x * cw) * s;
      P[o + 1] = py + (t.y * cu + b.y * cw) * s;
      P[o + 2] = pz + (t.z * cu + b.z * cw) * s;
      Nn[o] = n.x; Nn[o + 1] = n.y; Nn[o + 2] = n.z;
      C[o] = col.r; C[o + 1] = col.g; C[o + 2] = col.b;
      G[o] = gl.r; G[o + 1] = gl.g; G[o + 2] = gl.b;
      U[k * 12 + j * 2] = cell[0] + ((u + 1) / 2) * 0.5;
      U[k * 12 + j * 2 + 1] = cell[1] + ((w + 1) / 2) * 0.5;
    });
  }
  return { P, N: Nn, C, G, U };
}

export function toBufferGeometry(d: GeoData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.color, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(d.glow, 3));
  if (d.uv) g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
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
