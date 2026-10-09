import * as THREE from 'three';
import { type Noise, type Rand, TAU, clamp, sm } from './noise';
import { BLACK, V3, blob, col, lathe, limb, merge, mix3, part, type GeoData, type Part } from './geometry';

export interface Ctx { N: Noise; rand: Rand }

/* ------------------------------------------------------------ ground plants */

/** Cluster of glowing teardrop pods. */
export function podGeo({ rand }: Ctx): GeoData {
  const parts: Part[] = [];
  for (let i = 0; i < 5; i++) {
    const h = 1 + rand() * 1.7, r = 0.26 + rand() * 0.2;
    const prof: [number, number][] = [];
    for (let j = 0; j <= 10; j++) {
      const t = j / 10;
      prof.push([r * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.85) * (t < 0.12 ? 0.5 + t / 0.24 : 1), t * h]);
    }
    const g = lathe(prof, 10);
    const a = (i / 5) * TAU + rand(), d = i ? 0.42 + rand() * 0.2 : 0;
    g.rotateZ((rand() - 0.5) * 0.35); g.rotateX((rand() - 0.5) * 0.35); g.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    parts.push(part(g, (_x, y) => mix3(col('#1b3a44'), col('#a6dfe9'), y / h), (_x, y) => col('#2fe8ff').multiplyScalar(Math.pow(clamp(y / h, 0, 1), 1.4) * 1.5)));
  }
  return merge(parts);
}

/** Magenta trumpet flowers. */
export function trumpetGeo({ rand }: Ctx): GeoData {
  const parts: Part[] = [];
  for (let i = 0; i < 3; i++) {
    const h = 1.6 + rand() * 1.4, prof: [number, number][] = [];
    for (let j = 0; j <= 12; j++) { const t = j / 12; prof.push([0.06 + Math.pow(t, 3.2) * 0.8, t * h]); }
    const g = lathe(prof, 12);
    g.rotateZ((rand() - 0.5) * 0.4); g.translate((rand() - 0.5) * 0.8, 0, (rand() - 0.5) * 0.8);
    parts.push(part(g,
      (_x, y) => (y / h < 0.55 ? mix3(col('#2d5a30'), col('#7a2a6e'), (y / h) * 1.6) : mix3(col('#a9338f'), col('#ff9ad8'), (y / h - 0.55) * 2.2)),
      (_x, y) => col('#ff3fd0').multiplyScalar(sm((y / h - 0.6) / 0.4) * 1.4)));
  }
  return merge(parts);
}

/** Spiral fiddlehead ferns. */
export function fernGeo({ rand }: Ctx): GeoData {
  const parts: Part[] = [];
  for (let i = 0; i < 3; i++) {
    const pts: THREE.Vector3[] = [], H0 = 1.2 + rand() * 0.8, R0 = 0.35 + rand() * 0.15;
    for (let j = 0; j <= 28; j++) {
      const s = j / 28;
      if (s < 0.5) pts.push(new V3(0, s * 2 * H0, 0));
      else {
        const u = (s - 0.5) / 0.5, ang = u * Math.PI * 2.4, rad = R0 * (1 - u * 0.85);
        pts.push(new V3(0, H0 + R0 + Math.sin(ang - Math.PI / 2) * rad, Math.cos(ang - Math.PI / 2) * rad));
      }
    }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.055, 5);
    g.rotateY((i / 3) * TAU + rand()); g.translate((rand() - 0.5) * 0.6, 0, (rand() - 0.5) * 0.6);
    parts.push(part(g, (_x, y) => mix3(col('#24502a'), col('#7ab84a'), y / 2), (_x, y) => col('#5dffb0').multiplyScalar(sm((y - H0) / R0) * 1.2)));
  }
  return merge(parts);
}

/** Broad-leaf rosette with glowing midribs. */
export function leafGeo({ rand }: Ctx): GeoData {
  const parts: Part[] = [], k = 6 + ((rand() * 3) | 0);
  for (let i = 0; i < k; i++) {
    const L = 1.8 + rand() * 1.4, g = new THREE.PlaneGeometry(0.75, L, 2, 7);
    const P = g.attributes.position.array as Float32Array;
    for (let j = 0; j < P.length; j += 3) {
      const t = (P[j + 1] + L / 2) / L;
      P[j] *= Math.pow(Math.sin(Math.PI * clamp(t * 0.95 + 0.05, 0, 1)), 0.7);
      P[j + 1] = t * L;
      P[j + 2] = -Math.abs(P[j]) * 0.25;
    }
    g.rotateX(-0.75 - rand() * 0.3);
    const P2 = g.attributes.position.array as Float32Array;
    for (let j = 0; j < P2.length; j += 3) { const t = P2[j + 2] / L; P2[j + 1] -= t * t * 1.1 * L * 0.3; }
    g.computeVertexNormals();
    const rot = (i / k) * TAU + rand() * 0.4;
    g.rotateY(rot);
    parts.push(part(g, (x, _y, z) => mix3(col('#1a4426'), col('#3f7f3a'), Math.hypot(x, z) / L), (x, _y, z) => {
      const r = Math.hypot(x, z), a = Math.atan2(x, z) - rot;
      return col('#33ffd6').multiplyScalar(Math.abs(Math.sin(a)) * r < 0.05 ? 0.8 : 0.05);
    }));
  }
  return merge(parts);
}

/** Small glowing mushrooms. */
export function shroomGeo({ rand }: Ctx): GeoData {
  const parts: Part[] = [];
  for (let i = 0; i < 4; i++) {
    const h = 0.4 + rand() * 0.9, x = (rand() - 0.5) * 1.2, z = (rand() - 0.5) * 1.2, r = 0.18 + rand() * 0.28;
    const st = new THREE.CylinderGeometry(0.05, 0.08, h, 6, 1, true); st.translate(x, h / 2, z);
    parts.push(part(st, col('#d8d0e8')));
    const cap = new THREE.SphereGeometry(r, 10, 5, 0, TAU, 0, Math.PI / 2); cap.scale(1, 0.55, 1); cap.translate(x, h, z);
    parts.push(part(cap, col('#b9a8e8'), col(rand() < 0.5 ? '#8b6bff' : '#3fb8ff').multiplyScalar(1.3)));
  }
  return merge(parts);
}

/** A clump of nine bent grass blades with glowing tips. */
export function grassGeo({ rand }: Ctx): GeoData {
  const P: number[] = [], C: number[] = [], G: number[] = [];
  const base = col('#1c3a1d'), tip = col('#7dae45'), glow = col('#6dff8a').multiplyScalar(0.7);
  for (let b = 0; b < 9; b++) {
    const a = rand() * TAU, d = rand() * 1.2, x0 = Math.cos(a) * d, z0 = Math.sin(a) * d;
    const h = 0.6 + rand() * 1.1, w = 0.06 + rand() * 0.04, ba = rand() * TAU, bend = 0.2 + rand() * 0.4;
    const dx = Math.cos(ba), dz = Math.sin(ba), px = -dz, pz = dx;
    const pt = (t: number) => [x0 + dx * bend * t * t * h, t * h, z0 + dz * bend * t * t * h];
    for (let s = 0; s < 3; s++) {
      const t0 = s / 3, t1 = (s + 1) / 3, w0 = w * (1 - t0), w1 = w * (1 - t1);
      const a0 = pt(t0), a1 = pt(t1);
      const L0 = [a0[0] - px * w0, a0[1], a0[2] - pz * w0], R0 = [a0[0] + px * w0, a0[1], a0[2] + pz * w0];
      const L1 = [a1[0] - px * w1, a1[1], a1[2] - pz * w1], R1 = [a1[0] + px * w1, a1[1], a1[2] + pz * w1];
      const tri = (A: number[], B: number[], Cc: number[], ts: number[]) => {
        P.push(...A, ...B, ...Cc);
        for (const t of ts) {
          const c = mix3(base, tip, t);
          C.push(c.r, c.g, c.b);
          const g = t > 0.85 ? glow : BLACK;
          G.push(g.r, g.g, g.b);
        }
      };
      tri(L0, R0, L1, [t0, t0, t1]);
      tri(R0, R1, L1, [t0, t1, t1]);
    }
  }
  const normal = new Float32Array(P.length);
  for (let i = 1; i < P.length; i += 3) normal[i] = 1;
  return { position: new Float32Array(P), normal, color: new Float32Array(C), glow: new Float32Array(G), radius: 3 };
}

export function vineGeo(): GeoData {
  const g = new THREE.BoxGeometry(0.3, 1, 0.3, 1, 6, 1); g.translate(0, -0.5, 0);
  return merge([part(g, (_x, y) => mix3(col('#4c7a3c'), col('#2a4a2a'), -y), (_x, y) => col('#3dffd2').multiplyScalar(sm((-y - 0.75) / 0.25) * 1.6))]);
}

export function tendrilGeo(): GeoData {
  const g = new THREE.BoxGeometry(0.16, 1, 0.16, 1, 8, 1); g.translate(0, -0.5, 0);
  return merge([part(g, (_x, y) => mix3(col('#c8b8f0'), col('#e0f8ff'), -y), (_x, y) => mix3(col('#6a4dff'), col('#3ff0ff'), -y).multiplyScalar(0.4 + -y * 1.4))]);
}

/* ------------------------------------------------------------ trees */

const barkFn = (N: Noise) => (x: number, y: number, z: number) => mix3(col('#3a2e26'), col('#6a5a4a'), N.n3(x * 0.6, y * 0.08, z * 0.6) * 0.8 + 0.5);

/** Rainforest giant: buttress roots, tall bent trunk, layered canopy, glowing moss strands. */
export function treeA({ N, rand }: Ctx): GeoData {
  const bark = barkFn(N), parts: Part[] = [], H0 = 46;
  const prof: [number, number][] = [];
  for (let j = 0; j <= 16; j++) { const t = j / 16, y = t * H0; prof.push([1.1 + 2.8 * Math.exp(-y / 2.6) - t * 0.5, y]); }
  const tr = lathe(prof, 10);
  const P = tr.attributes.position.array as Float32Array;
  for (let i = 0; i < P.length; i += 3) P[i] += Math.sin(P[i + 1] * 0.05) * 1.6;
  parts.push(part(tr, bark, (x, y, z) => col('#3fffd8').multiplyScalar(sm((N.n3(x * 0.3, y * 0.08, z * 0.3) + 0.1) / 0.35) * 0.7)));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + rand() * 0.4;
    parts.push(part(limb(new V3(Math.cos(a) * 1.2, 4, Math.sin(a) * 1.2), new V3(Math.cos(a) * 6.5, -0.6, Math.sin(a) * 6.5), 0.9, 0.25), bark));
  }
  const tops: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rand(), y0 = 30 + i * 2.4;
    const e = new V3(Math.cos(a) * (9 + rand() * 3), y0 + 8 + rand() * 5, Math.sin(a) * (9 + rand() * 3));
    parts.push(part(limb(new V3(Math.sin(y0 * 0.05) * 1.6, y0, 0), e, 0.75, 0.3), bark));
    tops.push(e);
  }
  tops.push(new V3(Math.sin(H0 * 0.05) * 1.6, H0 + 3, 0));
  for (const t of tops) {
    const b = blob(N, 2, 8 + rand() * 3, 3.6 + rand() * 1.5, 8 + rand() * 3, 0.35, rand() * 50);
    b.translate(t.x, t.y, t.z);
    parts.push(part(b,
      (x, y, z, _nx, ny) => mix3(col('#1d4a2c'), col('#4a8a3a'), ny * 0.6 + 0.4 + N.n3(x * 0.3, y * 0.3, z * 0.3) * 0.4),
      (_x, _y, _z, _nx, ny) => col('#8c4dff').multiplyScalar(sm((-ny - 0.1) / 0.4) * 0.7)));
  }
  for (let i = 0; i < 12; i++) {
    const t = tops[i % tops.length], L = 5 + rand() * 9, g = new THREE.BoxGeometry(0.14, L, 0.14, 1, 4, 1);
    g.translate(t.x + (rand() - 0.5) * 10, t.y - 2 - L / 2, t.z + (rand() - 0.5) * 10);
    parts.push(part(g, col('#5c7a4a'), (_x, y) => col('#3dffd2').multiplyScalar(y < t.y - 2 - L * 0.75 ? 1.4 : 0)));
  }
  return merge(parts);
}

/** Bottle-trunk umbrella tree of the open plains. */
export function treeB({ N, rand }: Ctx): GeoData {
  const bark = barkFn(N), parts: Part[] = [], H0 = 22, prof: [number, number][] = [];
  for (let j = 0; j <= 14; j++) { const t = j / 14; prof.push([2.4 + Math.sin(t * Math.PI) * 0.9 - t * 1.5 + Math.exp(-t * 12) * 1.4, t * H0]); }
  parts.push(part(lathe(prof, 12), bark, (x, y, z) => col('#ff9a3f').multiplyScalar(N.n3(x * 0.7, y * 0.3, z * 0.7) > 0.45 ? 0.4 : 0)));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rand() * 0.5, e = new V3(Math.cos(a) * 11, H0 + 9 + rand() * 3, Math.sin(a) * 11);
    parts.push(part(limb(new V3(0, H0 - 1, 0), e, 1.2, 0.45), bark));
  }
  for (let i = 0; i < 11; i++) {
    const a = rand() * TAU, r = i ? 4 + rand() * 9 : 0, b = blob(N, 2, 7 + rand() * 3, 2.2 + rand(), 7 + rand() * 3, 0.3, rand() * 50);
    b.translate(Math.cos(a) * r, H0 + 10 + rand() * 2.5 - r * 0.12, Math.sin(a) * r);
    parts.push(part(b,
      (_x, _y, _z, _nx, ny) => mix3(col('#1f4a26'), col('#5a9440'), ny * 0.5 + 0.5),
      (_x, _y, _z, _nx, ny) => col('#36f5d0').multiplyScalar(sm((-ny - 0.1) / 0.4) * 0.6)));
  }
  return merge(parts);
}

/** Small lantern tree with violet or teal glowing foliage. */
export function treeC({ N, rand }: Ctx): GeoData {
  const bark = barkFn(N), parts: Part[] = [], H0 = 12, prof: [number, number][] = [];
  for (let j = 0; j <= 10; j++) { const t = j / 10; prof.push([0.55 - t * 0.3 + Math.exp(-t * 10) * 0.5, t * H0]); }
  const tr = lathe(prof, 8);
  const P = tr.attributes.position.array as Float32Array;
  for (let i = 0; i < P.length; i += 3) P[i] += Math.pow(P[i + 1] / H0, 2) * 2;
  parts.push(part(tr, bark));
  const violet = rand() < 0.5;
  for (let i = 0; i < 4; i++) {
    const a = rand() * TAU, b = blob(N, 2, 3.4 + rand() * 1.6, 2.4 + rand(), 3.4 + rand() * 1.6, 0.3, rand() * 50);
    b.translate(2 + Math.cos(a) * 2.4, H0 + 1 + rand() * 3, Math.sin(a) * 2.4);
    parts.push(part(b,
      (_x, _y, _z, _nx, ny) => (violet ? mix3(col('#5a2a72'), col('#b45aa8'), ny * 0.5 + 0.5) : mix3(col('#1b4f4c'), col('#3a9c8a'), ny * 0.5 + 0.5)),
      (x, y, z, _nx, ny) => col(violet ? '#ff4fd8' : '#3fffe0').multiplyScalar(ny < -0.3 ? 0.6 : N.n3(x, y, z) > 0.42 ? 0.35 : 0.03)));
  }
  for (let i = 0; i < 8; i++) {
    const L = 2 + rand() * 4, g = new THREE.BoxGeometry(0.1, L, 0.1);
    g.translate(2 + (rand() - 0.5) * 6, H0 - L / 2, (rand() - 0.5) * 6);
    parts.push(part(g, col('#d8c0ff'), col(violet ? '#ff6ae0' : '#5fffe8').multiplyScalar(1.2)));
  }
  return merge(parts);
}

/** The Elder Tree: braided trunk, sprawling roots and a vast glowing canopy. */
export function elderTreeGeo({ N, rand }: Ctx): GeoData {
  const bark = barkFn(N), parts: Part[] = [];
  for (let k = 0; k < 9; k++) {
    const a0 = (k / 9) * TAU, pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 12; j++) {
      const t = j / 12, y = t * 150;
      const rad = t < 0.45 ? 24 + (8 - 24) * sm(t / 0.45) : 8 + (34 - 8) * sm((t - 0.45) / 0.55);
      const a = a0 + t * 1.6;
      pts.push(new V3(Math.cos(a) * rad, y - 4, Math.sin(a) * rad));
    }
    parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 5.2, 8), bark,
      (x, y, z) => col('#4dfff0').multiplyScalar(sm((N.n3(x * 0.05, y * 0.03, z * 0.05) + 0.05) / 0.3) * 1.2)));
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + rand() * 0.3, pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 8; j++) { const t = j / 8, r = 20 + t * 55; pts.push(new V3(Math.cos(a + t * 0.3) * r, 12 * (1 - t) * (1 - t) - 3, Math.sin(a + t * 0.3) * r)); }
    parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 3.2, 6), bark,
      (x, y, z) => col('#4dfff0').multiplyScalar(sm((N.n3(x * 0.06, y * 0.06, z * 0.06) + 0.05) / 0.3) * 1.0)));
  }
  for (let k = 0; k < 38; k++) {
    const a = rand() * TAU, r = Math.sqrt(rand()) * 100, y = 146 + Math.cos((r / 100) * 1.4) * 42 + rand() * 10;
    const b = blob(N, 3, 22 + rand() * 16, 9 + rand() * 6, 22 + rand() * 16, 0.35, rand() * 50);
    b.translate(Math.cos(a) * r, y, Math.sin(a) * r);
    parts.push(part(b,
      (x, y, z, _nx, ny) => mix3(col('#173f2e'), col('#3d8a52'), ny * 0.5 + 0.5 + N.n3(x * 0.05, y * 0.05, z * 0.05) * 0.6),
      (x, y, z, _nx, ny) => col('#7a5cff').multiplyScalar(sm((-ny - 0.1) / 0.4) * 0.8).add(col('#3fffe0').multiplyScalar(sm((N.n3(x * 0.04, y * 0.04, z * 0.04) - 0.05) / 0.3) * 0.5))));
  }
  return merge(parts);
}
