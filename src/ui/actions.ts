import { engine } from '../engine/Engine';
import { useUI } from '../state/store';

/** Grow a new world and keep the seed in the address bar so the link is shareable. */
export function regrow(seed: number) {
  const u = new URL(location.href);
  u.searchParams.set('seed', String(seed));
  history.replaceState(null, '', u);
  void engine.grow(seed, useUI.getState().quality);
}
