import * as THREE from 'three';
import { type Noise, clamp, sm } from './noise';
import { BLACK, col, merge, mix3, part, smoothNormals, type GeoData } from './geometry';

export interface Isle {
  geo: GeoData;
  /** flat xyz of upward-facing top vertices (unit scale) */
  tops: number[];
  /** flat x,y,z,nx,nz of rim vertices where vines and waterfalls start */
  rims: number[];
}

/** A floating mountain: flattened grassy top, long tapering rock root, vertical striations. */
export function isleGeo(N: Noise, off: number, detail: number): Isle {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const P = g.attributes.position.array as Float32Array, K = Float32Array.from(P);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    const r = 1 + N.fbm3(x * 1.5 + off, y * 1.5, z * 1.5 + off, 4) * 0.42;
    let px = x * r, py = y * r, pz = z * r;
    if (py > 0) {
      py = py * 0.3 + N.fbm3(x * 3 + off, 1, z * 3, 3) * 0.07;
    } else {
      const t = -py, ta = Math.max(0.06, 1 - Math.pow(t, 1.1) * 0.88);
      px *= ta; pz *= ta;
      py = -Math.pow(t, 0.85) * (1.7 + N.n3(x * 2 + off, z * 2, 1) * 0.8);
      const s = N.n3(Math.atan2(z, x) * 3 + off, py * 5, 0) * 0.16;
      px *= 1 + s; pz *= 1 + s;
    }
    P[i] = px; P[i + 1] = py; P[i + 2] = pz;
  }
  smoothNormals(g, K);
  const geo = merge([part(g,
    (x, y, z, _nx, ny) => {
      const m = N.n3(x * 4 + off, y * 6, z * 4);
      if (ny > 0.55 && y > -0.05) return mix3(col('#2a5a2c'), col('#5a9a3e'), m + 0.5);
      const rock = mix3(col('#5b5650'), col('#7d776c'), N.n3(x * 2, y * 9, z * 2) + 0.5).lerp(col('#3a3836'), clamp(-y * 0.3, 0, 0.45));
      return m > 0.15 ? rock.lerp(col('#2f5a32'), 0.7) : rock;
    },
    (x, y, z, _nx, ny) => {
      const m = N.n3(x * 2.2 + off, y * 3, z * 2.2 + 9);
      return ny < 0.55 ? col('#2fffd0').multiplyScalar(sm((m + 0.05) / 0.3) * 0.9) : col('#a46bff').multiplyScalar(sm((m - 0.1) / 0.3) * 0.6);
    })]);
  const tops: number[] = [], rims: number[] = [];
  const Np = geo.normal, Pp = geo.position;
  for (let i = 0; i < Pp.length; i += 9) {
    const ny = Np[i + 1], y = Pp[i + 1];
    if (ny > 0.8 && y > 0) tops.push(Pp[i], Pp[i + 1], Pp[i + 2]);
    else if (ny < 0.25 && ny > -0.35 && y > -0.18 && y < 0.12) {
      const l = Math.hypot(Np[i], Np[i + 2]) || 1;
      rims.push(Pp[i], Pp[i + 1], Pp[i + 2], Np[i] / l, Np[i + 2] / l);
    }
  }
  return { geo, tops, rims };
}

/** A grounded karst pillar with a green crown. */
export function spireGeo(N: Noise, h: number, r: number, off: number): GeoData {
  const prof: [number, number][] = [];
  for (let j = 0; j <= 40; j++) {
    const t = j / 40;
    prof.push([r * (1.3 - t * 0.4 + Math.exp(-t * 20) * 0.5) * (t > 0.94 ? Math.sqrt(Math.max(0, (1 - t) / 0.06)) : 1), t * h]);
  }
  const lg = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(Math.max(a, 0.001), b)), 28).toNonIndexed();
  const P = lg.attributes.position.array as Float32Array, K = Float32Array.from(P);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2], a = Math.atan2(z, x);
    const d = 1 + N.n3(Math.cos(a) * 2 + off, (y / h) * 6, Math.sin(a) * 2) * 0.32 + N.n3(a * 4 + off, y * 0.08, 0) * 0.12;
    P[i] = x * d; P[i + 2] = z * d;
  }
  smoothNormals(lg, K);
  return merge([part(lg,
    (x, y, z, _nx, ny) => {
      if (ny > 0.5 || y > h * 0.95) return mix3(col('#2c5a2e'), col('#5a9a3e'), N.n3(x * 0.1, y * 0.1, z * 0.1) + 0.5);
      const rock = mix3(col('#56524c'), col('#827a6e'), N.n3(x * 0.2, y * 0.6, z * 0.2) + 0.5);
      return N.n3(x * 0.05 + off, y * 0.08, z * 0.05) > 0.2 ? rock.lerp(col('#2f5a32'), 0.65) : rock;
    },
    (x, y, z) => col('#2fffd0').multiplyScalar(sm((N.n3(x * 0.04, y * 0.05 + off, z * 0.04) + 0.05) / 0.3) * 0.9))]);
}

/** A natural stone arch standing in the xy plane. */
export function archGeo(N: Noise, R: number, tube: number, off: number): GeoData {
  const g = new THREE.TorusGeometry(R, tube, 14, 80, Math.PI).toNonIndexed();
  const P = g.attributes.position.array as Float32Array, K = Float32Array.from(P);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2], a = Math.atan2(y, x), cx = Math.cos(a) * R, cy = Math.sin(a) * R;
    const f = (1 + (1 - Math.sin(a)) * 0.9) * (1 + N.n3(x * 0.05 + off, y * 0.05, z * 0.05) * 0.5);
    P[i] = cx + (x - cx) * f; P[i + 1] = cy + (y - cy) * f; P[i + 2] = z * f;
  }
  smoothNormals(g, K);
  return merge([part(g,
    (x, y, z, _nx, ny) => (ny > 0.45 ? mix3(col('#2c5a2e'), col('#5a9a3e'), N.n3(x * 0.1, y * 0.1, z * 0.1) + 0.5) : mix3(col('#56524c'), col('#7a7266'), N.n3(x * 0.1, y * 0.4, z * 0.1) + 0.5)),
    (x, y, z, _nx, ny) => (ny > 0.45 ? BLACK : col('#2fffd0').multiplyScalar(sm((N.n3(x * 0.05, y * 0.05, z * 0.05) + 0.05) / 0.3) * 0.9)))]);
}
