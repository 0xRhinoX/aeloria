export type Rand = () => number;

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sm = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function mulberry32(seed: number): Rand {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Noise {
  n3(x: number, y: number, z: number): number;
  n2(x: number, y: number): number;
  fbm(x: number, y: number, octaves?: number): number;
  fbm3(x: number, y: number, z: number, octaves?: number): number;
  ridge(x: number, y: number, octaves?: number): number;
}

const G = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1];

/** Seeded 3D Perlin noise with fbm and ridged variants. */
export function makeNoise(seed: number): Noise {
  const r = mulberry32(seed * 9301 + 49297);
  const p: number[] = [];
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const g = (h: number, x: number, y: number, z: number) => {
    const k = (h % 12) * 3;
    return G[k] * x + G[k + 1] * y + G[k + 2] * z;
  };
  function n3(x: number, y: number, z: number) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi;
    const B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
    return lerp(
      lerp(lerp(g(perm[AA], x, y, z), g(perm[BA], x - 1, y, z), u), lerp(g(perm[AB], x, y - 1, z), g(perm[BB], x - 1, y - 1, z), u), v),
      lerp(
        lerp(g(perm[AA + 1], x, y, z - 1), g(perm[BA + 1], x - 1, y, z - 1), u),
        lerp(g(perm[AB + 1], x, y - 1, z - 1), g(perm[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  }
  const n2 = (x: number, y: number) => n3(x, y, 0.37);
  function fbm(x: number, y: number, o = 5) {
    let a = 0.5, f = 1, s = 0;
    for (let i = 0; i < o; i++) { s += a * n2(x * f, y * f); f *= 2.03; a *= 0.5; }
    return s;
  }
  function fbm3(x: number, y: number, z: number, o = 4) {
    let a = 0.5, f = 1, s = 0;
    for (let i = 0; i < o; i++) { s += a * n3(x * f, y * f, z * f); f *= 2.07; a *= 0.5; }
    return s;
  }
  function ridge(x: number, y: number, o = 4) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < o; i++) { s += a * (1 - Math.abs(n2(x * f, y * f)) * 1.6); n += a; f *= 2.1; a *= 0.5; }
    return s / n;
  }
  return { n3, n2, fbm, fbm3, ridge };
}
