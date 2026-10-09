import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { engine, detectQuality, defaultGfx } from './engine/Engine';
import { store, toast, useUI, type Gfx } from './state/store';
import { RIDERS } from './engine/creatures';
import { regrow } from './ui/actions';
import type { Weather } from './engine/palette';
import { Activities, Compass, Controls, Hud, Intro, Labels, Loading, PhotoBar, Reticle, Roster, Toast, TouchControls, WorldMap, fade } from './ui/Panels';

const quality = detectQuality();
const gfx = store.get<Gfx | null>('gfx', null) ?? defaultGfx(quality);
const startDpr = Math.min(devicePixelRatio, quality === 'low' ? 1 : 1.5);
engine.dpr = startDpr;
engine.maxDpr = startDpr;
useUI.setState({ gfx: ['fast', 'balanced', 'high'].includes(gfx) ? gfx : defaultGfx(quality) });

/** Read ?seed=&rider=&sky=&weather= so shared links open the same world. */
function readUrl() {
  const q = new URLSearchParams(location.search);
  const seed = parseInt(q.get('seed') || '', 10);
  const rider = parseInt(q.get('rider') || '', 10);
  const sky = q.get('sky');
  const weather = q.get('weather') as Weather | null;
  useUI.setState({
    quality,
    seed: Number.isFinite(seed) ? Math.abs(seed) % 1_000_000 : 7319,
    sel: Number.isFinite(rider) ? Math.max(0, Math.min(5, rider - 1)) : 0,
    ...(sky === 'cycle' ? { cycle: true } : sky != null && !isNaN(+sky) ? { sky: Math.max(0, Math.min(1, +sky)) } : {}),
    ...(weather && ['clear', 'mist', 'rain', 'storm'].includes(weather) ? { weather } : {}),
  });
}

function Loop() {
  const setDpr = useThree(s => s.setDpr);
  const dpr = useThree(s => s.viewport.dpr);
  useFrame((_, delta) => {
    if (!engine.ready) return;
    const dt = Math.min(delta, 0.05);
    engine.update(dt);
    engine.render(dt);
    if (Math.abs(dpr - engine.dpr) > 0.01) setDpr(engine.dpr);
  }, 1);
  return null;
}

function useKeys() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      // flight keys must not activate whichever interface button still has focus
      if ((e.code === 'Space' || e.code === 'Enter') && document.activeElement instanceof HTMLButtonElement && useUI.getState().manual) document.activeElement.blur();
      engine.input.keys[e.code] = true;
      const s = useUI.getState();
      if (s.loading) return;
      if (/^Digit[1-6]$/.test(e.code)) engine.select(+e.code.slice(5) - 1);
      switch (e.code) {
        case 'Tab': e.preventDefault(); engine.select((s.sel + (e.shiftKey ? 5 : 1)) % 6); break;
        case 'KeyC': engine.cycleCam(e.shiftKey ? -1 : 1); break;
        case 'KeyT': { const v = [0, 0.5, 1]; useUI.setState({ cycle: false, sky: v[(v.indexOf(s.sky) + 1) % 3] }); break; }
        case 'KeyF': engine.reins(!s.manual); break;
        case 'Escape':
          if (s.mapOpen) useUI.setState({ mapOpen: false });
          else if (s.photo) useUI.setState({ photo: false });
          else if (!engine.input.locked) engine.reins(false);
          break;
        case 'KeyH': useUI.setState({ uiHidden: !s.uiHidden }); break;
        case 'KeyM': useUI.setState({ mapOpen: !s.mapOpen }); if (!s.mapOpen) engine.input.releaseLock(); break;
        case 'KeyO': engine.toggleSound(); break;
        case 'KeyN': regrow((Math.random() * 99999) | 0); break;
        case 'KeyP': useUI.setState({ photo: !s.photo }); break;
        case 'KeyR': if (s.race.active) engine.stopRace(); else engine.startRace(fade); break;
        case 'KeyG': engine.findFlock(); break;
        case 'KeyB': engine.bondHold = true; break;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      engine.input.keys[e.code] = false;
      if (e.code === 'KeyB') engine.bondHold = false;
    };
    const blur = () => { engine.input.keys = {}; engine.bondHold = false; };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, []);
}

export function App() {
  const hidden = useUI(s => s.uiHidden || s.photo), manual = useUI(s => s.manual), touch = useUI(s => s.touch);
  const booted = useRef(false);
  useKeys();
  useEffect(() => useUI.subscribe((s, prev) => { if (s.gfx !== prev.gfx) store.set('gfx', s.gfx); }), []);
  return (
    <div className={['app', hidden && 'hidden-ui', manual && 'manual', touch && 'touch-device'].filter(Boolean).join(' ')}>
      <Canvas
        className="gl"
        dpr={startDpr}
        gl={{ antialias: quality !== 'low', powerPreference: 'high-performance' }}
        shadows={false}
        camera={{ fov: 60, near: 0.3, far: 9500, position: [0, 200, 0] }}
        onCreated={({ gl, scene, camera }) => {
          engine.attach(gl, scene, camera as PerspectiveCamera, quality);
          if (booted.current) return;
          booted.current = true;
          readUrl();
          void engine.grow(useUI.getState().seed, quality).then(() => {
            const r = RIDERS[useUI.getState().sel];
            setTimeout(() => toast(r.name, `riding ${r.pal.name} · press F to take the reins`), 900);
          });
        }}
      >
        <Loop />
      </Canvas>
      <Labels />
      <Reticle />
      <Compass />
      <Intro />
      <Controls />
      <Roster />
      <Activities />
      <Hud />
      <TouchControls />
      <WorldMap />
      <PhotoBar />
      <Toast />
      <div id="fade" />
      <Loading />
    </div>
  );
}
