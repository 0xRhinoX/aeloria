import { engine } from '../engine/Engine';
import { useUI } from '../state/store';

/** Grow a new world and keep the seed in the address bar so the link is shareable. */
export function regrow(seed: number) {
  const u = new URL(location.href);
  u.searchParams.set('seed', String(seed));
  history.replaceState(null, '', u);
  void engine.grow(seed, useUI.getState().quality);
}

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

/** Element fullscreen is missing on iPhone Safari; hide the button there. */
export const canFullscreen = () => !!(document.fullscreenEnabled || (document as FsDoc).webkitFullscreenEnabled);

export function toggleFullscreen() {
  const d = document as FsDoc, el = document.documentElement as FsEl;
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      if (d.exitFullscreen) void d.exitFullscreen(); else d.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch { /* not allowed here, e.g. inside a sandboxed frame */ }
}
