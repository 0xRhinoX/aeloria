import * as THREE from 'three';
import { lerp, sm } from '../world/noise';

export type Weather = 'clear' | 'mist' | 'rain' | 'storm';

interface Key {
  zen: string; hor: string; fog: string; fd: number; sunC: string; sunI: number; el: number; az: number;
  hs: string; hg: string; hi: number; glow: number; cloud: string; stars: number; exp: number;
}
/** Day, dusk and night lighting keys; time of day blends between them. */
const RAW: Key[] = [
  { zen: '#3b7fcb', hor: '#a8d8ea', fog: '#9fcadb', fd: 0.0004, sunC: '#fff1d8', sunI: 2.7, el: 0.95, az: 0.6, hs: '#c3e8ff', hg: '#2c4a2a', hi: 1.15, glow: 0.05, cloud: '#ffffff', stars: 0, exp: 1.0 },
  { zen: '#3a4b8f', hor: '#f6b394', fog: '#c99aa7', fd: 0.00054, sunC: '#ffad78', sunI: 1.9, el: 0.1, az: 2.3, hs: '#b9a3d8', hg: '#3a2f46', hi: 0.85, glow: 0.3, cloud: '#ffc4ad', stars: 0.18, exp: 1.05 },
  { zen: '#030820', hor: '#132a63', fog: '#0c1c46', fd: 0.00066, sunC: '#86a9ff', sunI: 0.6, el: 0.7, az: 2.55, hs: '#3a5ab0', hg: '#0a1428', hi: 0.5, glow: 1, cloud: '#1b2a58', stars: 1, exp: 1.18 },
];
const COLS = ['zen', 'hor', 'fog', 'sunC', 'hs', 'hg', 'cloud'] as const;
const NUMS = ['fd', 'sunI', 'el', 'az', 'hi', 'glow', 'stars', 'exp'] as const;
type ColKey = (typeof COLS)[number];
type NumKey = (typeof NUMS)[number];
export type Pal = Record<ColKey, THREE.Color> & Record<NumKey, number> & { cover: number; wind: number; rain: number };

const KEYS = RAW.map(k => {
  const o = {} as Pal;
  for (const c of COLS) o[c] = new THREE.Color(k[c]);
  for (const n of NUMS) o[n] = k[n];
  return o;
});

export const WEATHER: Record<Weather, { fog: number; cover: number; dim: number; wind: number; rain: number; grey: number }> = {
  clear: { fog: 1, cover: 0, dim: 0, wind: 1, rain: 0, grey: 0 },
  mist: { fog: 2.6, cover: 0.3, dim: 0.15, wind: 0.7, rain: 0, grey: 0.25 },
  rain: { fog: 1.7, cover: 0.75, dim: 0.45, wind: 1.6, rain: 0.8, grey: 0.45 },
  storm: { fog: 2.0, cover: 1, dim: 0.62, wind: 2.6, rain: 1, grey: 0.6 },
};

const out = {} as Pal;
for (const c of COLS) out[c] = new THREE.Color();
const grey = new THREE.Color();
const w = { fog: 1, cover: 0, dim: 0, wind: 1, rain: 0, grey: 0 };

/** Blend lighting for a time of day (0 day, 0.5 dusk, 1 night) and ease weather toward its target. */
export function palette(t: number, weather: Weather, dt: number): Pal {
  const a = t < 0.5 ? KEYS[0] : KEYS[1], b = t < 0.5 ? KEYS[1] : KEYS[2];
  const u = sm(t < 0.5 ? t * 2 : (t - 0.5) * 2);
  for (const c of COLS) out[c].copy(a[c]).lerp(b[c], u);
  for (const n of NUMS) out[n] = lerp(a[n], b[n], u);
  const target = WEATHER[weather], k = 1 - Math.exp(-dt * 0.8);
  for (const key of Object.keys(w) as (keyof typeof w)[]) w[key] = lerp(w[key], target[key], k);
  // weather greys and dims the sky
  for (const c of ['zen', 'hor', 'fog', 'cloud'] as const) {
    const l = out[c].getHSL({ h: 0, s: 0, l: 0 }).l;
    grey.setRGB(l, l, l * 1.05);
    out[c].lerp(grey, w.grey);
  }
  out.zen.multiplyScalar(1 - w.dim * 0.5);
  out.hor.multiplyScalar(1 - w.dim * 0.35);
  out.fd *= w.fog;
  out.sunI *= 1 - w.dim;
  out.hi *= 1 - w.dim * 0.4;
  out.stars *= 1 - w.cover;
  out.cover = w.cover;
  out.wind = w.wind;
  out.rain = w.rain;
  return out;
}
