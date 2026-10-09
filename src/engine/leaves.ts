import * as THREE from 'three';
import { mulberry32 } from '../world/noise';

/**
 * Procedural foliage atlas (512px). Quadrants match ATLAS in world/geometry.ts:
 * top-left broad leaves, top-right small round leaves, bottom-left hanging fronds,
 * bottom-right solid white for trunks and other opaque parts.
 * Leaves are drawn in greys so the per-vertex canopy colour tints them.
 */
export function makeLeafAtlas(anisotropy: number) {
  const S = 512, H = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const rand = mulberry32(911);
  g.clearRect(0, 0, S, S);

  const leaf = (x: number, y: number, len: number, wid: number, ang: number, tone: number) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    const grad = g.createLinearGradient(0, -wid, 0, wid);
    const c0 = Math.round(170 + tone * 70), c1 = Math.round(130 + tone * 60);
    grad.addColorStop(0, `rgb(${c0},${c0},${c0})`);
    grad.addColorStop(1, `rgb(${c1},${c1},${c1})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(len * 0.3, -wid, len * 0.75, -wid * 0.9, len, 0);
    g.bezierCurveTo(len * 0.75, wid * 0.9, len * 0.3, wid, 0, 0);
    g.fill();
    g.strokeStyle = `rgba(90,90,90,0.55)`;
    g.lineWidth = Math.max(1, wid * 0.12);
    g.beginPath();
    g.moveTo(len * 0.05, 0);
    g.lineTo(len * 0.92, 0);
    g.stroke();
    g.restore();
  };

  // broad leaves radiating from a few twigs
  for (let k = 0; k < 4; k++) {
    const cx = 60 + rand() * 136, cy = 60 + rand() * 136;
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2, len = 34 + rand() * 30;
      const x = cx + Math.cos(a) * 10, y = cy + Math.sin(a) * 10;
      if (x + Math.cos(a) * len < 10 || x + Math.cos(a) * len > H - 10 || y + Math.sin(a) * len < 10 || y + Math.sin(a) * len > H - 10) continue;
      leaf(x, y, len, 9 + rand() * 7, a, rand());
    }
  }

  // small round leaves in dense clumps
  for (let i = 0; i < 110; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 100;
    const x = H + H / 2 + Math.cos(a) * r, y = H / 2 + Math.sin(a) * r, s = 7 + rand() * 9;
    const t = Math.round(150 + rand() * 100);
    g.fillStyle = `rgb(${t},${t},${t})`;
    g.beginPath();
    g.ellipse(x, y, s, s * (0.7 + rand() * 0.3), rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }

  // hanging fronds: arched stems with paired leaflets
  for (let k = 0; k < 6; k++) {
    let x = 30 + rand() * 196, y = H + 18 + rand() * 30;
    let a = Math.PI / 2 + (rand() - 0.5) * 0.9;
    for (let s = 0; s < 14; s++) {
      const nx = x + Math.cos(a) * 12, ny = y + Math.sin(a) * 12;
      if (nx < 14 || nx > H - 14 || ny > S - 14) break;
      g.strokeStyle = 'rgb(150,150,150)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      const l = 16 - s * 0.6;
      leaf(nx, ny, l, 4, a - 1.1, rand());
      leaf(nx, ny, l, 4, a + 1.1, rand());
      x = nx; y = ny; a += (rand() - 0.3) * 0.18;
    }
  }

  // solid cell for opaque parts
  g.fillStyle = '#ffffff';
  g.fillRect(H, H, H, H);

  // Canvas pixels with zero alpha are black, which would darken leaf edges once mipmapped.
  // Bleed nearby leaf colour into the transparent texels (alpha stays 0) and flip rows so v=1 is the top.
  const src = g.getImageData(0, 0, S, S).data, out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, o = ((S - 1 - y) * S + x) * 4;
    let r = src[i], gg = src[i + 1], b = src[i + 2];
    if (src[i + 3] < 8) {
      let n = 0; r = gg = b = 0;
      for (let dy = -3; dy <= 3; dy += 3) for (let dx = -3; dx <= 3; dx += 3) {
        const xx = Math.min(S - 1, Math.max(0, x + dx)), yy = Math.min(S - 1, Math.max(0, y + dy)), j = (yy * S + xx) * 4;
        if (src[j + 3] > 8) { r += src[j]; gg += src[j + 1]; b += src[j + 2]; n++; }
      }
      if (n) { r /= n; gg /= n; b /= n; } else r = gg = b = 165;
    }
    out[o] = r; out[o + 1] = gg; out[o + 2] = b; out[o + 3] = src[i + 3];
  }
  const tex = new THREE.DataTexture(out, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
