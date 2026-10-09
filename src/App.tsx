import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { engine, detectQuality } from './engine/Engine';
import { toast, useUI, type CamMode } from './state/store';
import { RIDERS } from './engine/creatures';
import { regrow } from './ui/actions';
import type { Weather } from './engine/palette';
import { Activities, Controls, Hud, Intro, Labels, Loading, PhotoBar, Roster, Toast, fade } from './ui/Panels';

const quality = detectQuality();
const startDpr = Math.min(devicePixelRatio, quality === 'low' ? 1 : 1.5);
engine.dpr = startDpr;
engine.maxDpr = startDpr;

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
  useFrame((_, dt) => {
    if (!engine.ready) return;
    engine.update(Math.min(dt, 0.05));
    engine.render();
    if (Math.abs(dpr - engine.dpr) > 0.01) setDpr(engine.dpr);
  }, 1);
  return null;
}

const CAMS: CamMode[] = ['chase', 'seat', 'orbit', 'cinema'];

function useKeys() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      engine.keys[e.code] = true;
      const s = useUI.getState();
      if (s.loading) return;
      if (/^Digit[1-6]$/.test(e.code)) engine.select(+e.code.slice(5) - 1);
      switch (e.code) {
        case 'Tab': e.preventDefault(); engine.select((s.sel + 1) % 6); break;
        case 'KeyC': engine.setCam(CAMS[(CAMS.indexOf(s.cam) + 1) % 4]); break;
        case 'KeyT': { const v = [0, 0.5, 1]; useUI.setState({ cycle: false, sky: v[(v.indexOf(s.sky) + 1) % 3] }); break; }
        case 'KeyF': engine.reins(!s.manual); break;
        case 'Escape': if (s.photo) useUI.setState({ photo: false }); else engine.reins(false); break;
        case 'KeyH': useUI.setState({ uiHidden: !s.uiHidden }); break;
        case 'KeyM': engine.toggleSound(); break;
        case 'KeyN': regrow((Math.random() * 99999) | 0); break;
        case 'KeyP': useUI.setState({ photo: !s.photo }); break;
        case 'KeyR': if (s.race.active) engine.stopRace(); else engine.startRace(fade); break;
        case 'KeyG': engine.findFlock(); break;
        case 'KeyB': engine.bondHold = true; break;
      }
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      engine.keys[e.code] = false;
      if (e.code === 'KeyB') engine.bondHold = false;
    };
    const blur = () => { engine.keys = {}; engine.bondHold = false; };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, []);
}

export function App() {
  const hidden = useUI(s => s.uiHidden || s.photo);
  const booted = useRef(false);
  useKeys();
  return (
    <div className={hidden ? 'app hidden-ui' : 'app'}>
      <Canvas
        className="gl"
        dpr={startDpr}
        gl={{ antialias: quality !== 'low', powerPreference: 'high-performance' }}
        camera={{ fov: 62, near: 0.3, far: 9500, position: [0, 200, 0] }}
        onCreated={({ gl, scene, camera }) => {
          engine.attach(gl, scene, camera as PerspectiveCamera);
          if (booted.current) return;
          booted.current = true;
          readUrl();
          void engine.grow(useUI.getState().seed, quality).then(() => {
            const r = RIDERS[useUI.getState().sel];
            setTimeout(() => toast(r.name, `riding ${r.pal.name} · click any rider to switch`), 900);
          });
        }}
      >
        <Loop />
      </Canvas>
      <Labels />
      <Intro />
      <Controls />
      <Roster />
      <Activities />
      <Hud />
      <PhotoBar />
      <Toast />
      <div id="fade" />
      <Loading />
    </div>
  );
}
