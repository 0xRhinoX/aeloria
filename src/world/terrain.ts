import { type Noise, type Rand, lerp, sm, clamp } from './noise';

export interface XZ { x: number; z: number }
export interface Regions { PK: XZ; TR: XZ; PL: XZ; LK: XZ; FO: XZ }

/** Water level, fine-terrain size, and the radius riders stay inside. */
export const WL = 2;
export const INNER = 2700;
export const BOUND = 1120;

export function makeRegions(rand: Rand): Regions {
  const j = () => (rand() - 0.5) * 160;
  return {
    PK: { x: -520 + j(), z: -360 + j() }, // Hanging Peaks
    TR: { x: 470 + j(), z: 330 + j() },   // Elder Tree
    PL: { x: 430 + j(), z: -520 + j() },  // Amber Plains
    LK: { x: -400 + j(), z: 470 + j() },  // Mirror Lake
    FO: { x: 40 + j(), z: 60 + j() },     // Lumen Forest
  };
}

/** Analytic height field plus a sampled grid that matches the rendered mesh exactly. */
export class Terrain {
  readonly cell: number;
  heights: Float32Array | null = null;

  constructor(public N: Noise, public R: Regions, public seg: number) {
    this.cell = INNER / seg;
  }

  H(x: number, z: number) {
    const { N, R } = this;
    let h = 16 + N.fbm(x * 0.0021, z * 0.0021, 5) * 78;
    h += Math.max(0, N.ridge(x * 0.0034 + 7, z * 0.0034 - 3, 4) - 0.56) * 70;
    const fp = sm(1 - Math.hypot(x - R.PL.x, z - R.PL.z) / 440);
    h = lerp(h, 9 + N.fbm(x * 0.007, z * 0.007, 3) * 9, fp * 0.9);
    const ft = sm(1 - Math.hypot(x - R.TR.x, z - R.TR.z) / 240);
    h = lerp(h, 14 + N.fbm(x * 0.01, z * 0.01, 2) * 5, ft * 0.85);
    const fl = sm(1 - Math.hypot(x - R.LK.x, z - R.LK.z) / 300);
    h = lerp(h, -24, fl * fl * 1.05);
    const r = Math.hypot(x, z);
    h += sm((r - 930) / 560) * (230 + N.ridge(x * 0.004 + 3, z * 0.004, 4) * 300);
    return h;
  }

  /** Height of the rendered triangle under (x, z); falls back to the analytic field outside the grid. */
  groundY(x: number, z: number) {
    const hs = this.heights;
    const S = this.seg;
    const fx = (x + INNER / 2) / this.cell, fz = (z + INNER / 2) / this.cell;
    if (!hs || fx < 0 || fz < 0 || fx >= S || fz >= S) return this.H(x, z);
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, W = S + 1;
    const ha = hs[iz * W + ix], hb = hs[(iz + 1) * W + ix], hc = hs[(iz + 1) * W + ix + 1], hd = hs[iz * W + ix + 1];
    return u + v <= 1 ? ha + u * (hd - ha) + v * (hb - ha) : hc + (1 - u) * (hb - hc) + (1 - v) * (hd - hc);
  }

  /** Ground or water surface, whichever is higher. */
  surface(x: number, z: number) {
    return Math.max(this.groundY(x, z), WL);
  }

  slopeAt(x: number, z: number) {
    const e = 3;
    return Math.hypot(this.groundY(x + e, z) - this.groundY(x - e, z), this.groundY(x, z + e) - this.groundY(x, z - e)) / (2 * e);
  }

  forestMask(x: number, z: number) {
    const { N, R } = this;
    const a = sm(1 - Math.hypot(x - R.TR.x, z - R.TR.z) / 560);
    const b = sm(1 - Math.hypot(x - R.FO.x, z - R.FO.z) / 420);
    const n = N.n2(x * 0.006 + 11, z * 0.006) * 0.9 + 0.5;
    return clamp(Math.max(a, b) * (0.55 + n * 0.6) + Math.max(0, n - 0.75) * 0.6, 0, 1) * (1 - sm((Math.hypot(x, z) - 900) / 150));
  }
  plainsMask(x: number, z: number) {
    return sm(1 - Math.hypot(x - this.R.PL.x, z - this.R.PL.z) / 420);
  }
  lakeMask(x: number, z: number) {
    return sm(1 - Math.hypot(x - this.R.LK.x, z - this.R.LK.z) / 420);
  }
}
