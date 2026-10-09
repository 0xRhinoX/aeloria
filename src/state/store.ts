import { create } from 'zustand';
import type { Weather } from '../engine/palette';
import type { MountPalette } from '../engine/creatures';
import type { Quality } from '../world/generate';

export type CamMode = 'chase' | 'seat' | 'orbit' | 'cinema';
export type Gfx = 'auto' | 'fast' | 'high';

export interface Hud {
  alt: number;
  spd: number;
  where: string;
  dists: number[];
  near: number;
  fps: number;
  tris: number;
}

export interface UIState {
  loading: boolean;
  loadMsg: string;
  error: string | null;
  quality: Quality;
  seed: number;
  sel: number;
  cam: CamMode;
  sky: number;
  cycle: boolean;
  weather: Weather;
  gfx: Gfx;
  sound: boolean;
  manual: boolean;
  uiHidden: boolean;
  photo: boolean;
  places: { name: string; sub: string }[];
  stats: { isles: number; plants: number };
  hud: Hud;
  race: { active: boolean; next: number; total: number; time: number; best: number | null; last: number | null };
  bond: { name: string | null; dist: number; progress: number; swatch: string | null };
  seeds: { got: number; total: number; nearest: number | null };
  palettes: MountPalette[];
  riderPal: string[];
  toast: { title: string; sub: string; id: number } | null;
}

export const useUI = create<UIState>(() => ({
  loading: true,
  loadMsg: 'Growing the world…',
  error: null,
  quality: 'high',
  seed: 7319,
  sel: 0,
  cam: 'chase',
  sky: 0.5,
  cycle: false,
  weather: 'clear',
  gfx: 'auto',
  sound: false,
  manual: false,
  uiHidden: false,
  photo: false,
  places: [],
  stats: { isles: 0, plants: 0 },
  hud: { alt: 0, spd: 0, where: '—', dists: [], near: -1, fps: 0, tris: 0 },
  race: { active: false, next: 0, total: 0, time: 0, best: null, last: null },
  bond: { name: null, dist: Infinity, progress: 0, swatch: null },
  seeds: { got: 0, total: 0, nearest: null },
  palettes: [],
  riderPal: [],
  toast: null,
}));

let toastId = 0;
export function toast(title: string, sub: string) {
  useUI.setState({ toast: { title, sub, id: ++toastId } });
}

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get<T>(k: string, d: T): T {
    try { const v = localStorage.getItem('aeloria:' + k); return v == null ? d : (JSON.parse(v) as T); } catch { return d; }
  },
  set(k: string, v: unknown) {
    try { localStorage.setItem('aeloria:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
};
