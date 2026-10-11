import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { engine } from '../engine/Engine';
import { RIDERS, swatch } from '../engine/creatures';
import type { Weather } from '../engine/palette';
import { store, useUI, type CamMode, type Gfx } from '../state/store';
import { canFullscreen, regrow, toggleFullscreen } from './actions';

const X_URL = 'https://x.com/0xRhinoX', POKEABLE_URL = 'https://pokeable.app/';
const ext = { target: '_blank', rel: 'noopener' } as const;

const Out = () => <svg className="out" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5h5v5M9.5 2.5 3 9" /></svg>;

/** Links to the author and Pokeable; both open in a new tab so the world keeps running here. */
function Credits() {
  return (
    <span className="credits">
      <span>by</span>
      <a href={X_URL} {...ext} title="0xRhinoX on X (opens in a new tab)">@0xRhinoX<Out /></a>
      <span>more worlds on</span>
      <a href={POKEABLE_URL} {...ext} title="Pokeable: AI-built worlds and toys (opens in a new tab)">Pokeable<Out /></a>
    </span>
  );
}

/** Fade to black, run the action, fade back. */
export const fade = () =>
  new Promise<void>(res => {
    const el = document.getElementById('fade');
    if (!el) return res();
    el.style.opacity = '1';
    setTimeout(() => { res(); setTimeout(() => (el.style.opacity = '0'), 80); }, 380);
  });

const fmtDist = (d: number) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`);
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function Seg<T extends string | number>({ label, hint, value, options, onPick, id }: {
  label: string; hint?: string; value: T | null; options: [T, string][]; onPick: (v: T) => void; id: string;
}) {
  return (
    <div className="grp">
      <div className="grp-head"><span className="label" id={id}>{label}</span>{hint && <span className="label">{hint}</span>}</div>
      <div className="seg" role="group" aria-labelledby={id}>
        {options.map(([v, l]) => (
          <button key={String(v)} aria-pressed={value === v} onClick={() => onPick(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export function Intro() {
  const seed = useUI(s => s.seed), stats = useUI(s => s.stats), tris = useUI(s => s.hud.tris), open = useUI(s => s.introOpen), manual = useUI(s => s.manual);
  useEffect(() => { if (manual) useUI.setState({ introOpen: false }); }, [manual]);
  useEffect(() => { const h = setTimeout(() => useUI.setState({ introOpen: false }), 16000); return () => clearTimeout(h); }, []);
  return (
    <header className={'panel intro' + (open ? '' : ' closed')}>
      <button className="intro-head" onClick={() => useUI.setState({ introOpen: !open })} aria-expanded={open}>
        <span className="eyebrow">Procedural world · seed {seed}</span>
        <h1>Aeloria</h1>
      </button>
      {open && <>
        <p>Every leaf, cliff, waterfall and glow here is grown in your browser from one number. <b>No models, no textures, no assets.</b> Click a rider to fly with them, or press <kbd>F</kbd> and fly yourself. <kbd>Esc</kbd> pauses and shows every control.</p>
        <dl className="stats">
          <div><dt>Floating isles</dt><dd>{stats.isles || '—'}</dd></div>
          <div><dt>Plants</dt><dd>{stats.plants ? (stats.plants / 1000).toFixed(1) + 'k' : '—'}</dd></div>
          <div><dt>Triangles</dt><dd>{tris ? (tris / 1e6).toFixed(1) + 'M' : '—'}</dd></div>
        </dl>
      </>}
    </header>
  );
}

function RideTab() {
  const s = useUI(useShallow(st => ({ cam: st.cam, assist: st.assist })));
  const places = useUI(st => st.places), dists = useUI(st => st.hud.dists), near = useUI(st => st.hud.near);
  const palettes = useUI(st => st.palettes), riderPal = useUI(st => st.riderPal), sel = useUI(st => st.sel);
  const [invert, setInvert] = useState(engine.input.invertY);
  return (
    <>
      <Seg id="l-cam" label="Camera" hint="C" value={s.cam} onPick={(v: CamMode) => engine.setCam(v)}
        options={[['chase', 'Chase'], ['seat', 'Saddle'], ['drone', 'Drone'], ['orbit', 'Orbit'], ['cinema', 'Film']]} />
      <div className="grp">
        <div className="grp-head"><span className="label">Fly to</span><span className="label">M map</span></div>
        <div className="places">
          {places.map((p, i) => (
            <button key={p.name} title={p.sub} className={i === near ? 'here' : ''} onClick={() => engine.flyTo(i, fade)}>
              <span>{p.name}</span><small>{dists[i] != null ? fmtDist(dists[i]) : '—'}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="grp">
        <div className="grp-head"><span className="label">Mount colours · {RIDERS[sel].name}</span></div>
        <div className="swatches">
          {palettes.map(p => (
            <button key={p.id} className="sw" title={p.name} aria-label={p.name} aria-pressed={riderPal[sel] === p.id}
              style={{ background: swatch(p) }} onClick={() => engine.applyPalette(p.id)} />
          ))}
        </div>
        <small className="hint">Collect drift seeds or bond with wild mounts to unlock more.</small>
      </div>
      <div className="grp">
        <div className="grp-head"><span className="label">Flying yourself</span></div>
        <label className="check"><input type="checkbox" checked={s.assist} onChange={e => useUI.setState({ assist: e.target.checked })} /> Flight assist (steer around rock, pull up near ground)</label>
        <label className="check"><input type="checkbox" checked={invert} onChange={e => { engine.input.invertY = e.target.checked; setInvert(e.target.checked); }} /> Invert mouse up and down</label>
      </div>
    </>
  );
}

function WorldTab() {
  const s = useUI(useShallow(st => ({ sky: st.sky, cycle: st.cycle, weather: st.weather, gfx: st.gfx, sound: st.sound, seed: st.seed, fps: st.hud.fps })));
  const [seedIn, setSeedIn] = useState(String(s.seed));
  useEffect(() => setSeedIn(String(s.seed)), [s.seed]);
  const grow = () => { const v = parseInt(seedIn, 10); if (Number.isFinite(v)) regrow(Math.abs(v) % 1_000_000); };
  return (
    <>
      <Seg id="l-sky" label="Sky" hint="T" value={s.cycle ? 'cycle' : String(s.sky)}
        onPick={v => useUI.setState(v === 'cycle' ? { cycle: !s.cycle } : { cycle: false, sky: +v })}
        options={[['0', 'Day'], ['0.5', 'Dusk'], ['1', 'Night'], ['cycle', 'Cycle']]} />
      <Seg id="l-wx" label="Weather" value={s.weather} onPick={(v: Weather) => useUI.setState({ weather: v })}
        options={[['clear', 'Clear'], ['mist', 'Mist'], ['rain', 'Rain'], ['storm', 'Storm']]} />
      <div className="grp">
        <div className="grp-head"><span className="label">World seed</span><span className="label">N</span></div>
        <div className="row">
          <input id="seed-in" inputMode="numeric" aria-label="World seed" value={seedIn}
            onChange={e => setSeedIn(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') grow(); }} />
          <button className="btn" onClick={grow}>Grow</button>
          <button className="btn primary" onClick={() => regrow((Math.random() * 99999) | 0)}>New world</button>
        </div>
        <button className="btn" onClick={() => void engine.share()}>Copy link to this world</button>
      </div>
      <Seg id="l-gfx" label="Graphics" hint={s.fps ? `${s.fps} fps` : undefined} value={s.gfx} onPick={(v: Gfx) => useUI.setState({ gfx: v })}
        options={[['fast', 'Fast'], ['balanced', 'Balanced'], ['high', 'High']]} />
      <small className="hint">High adds shadows, 4× anti-aliasing and denser grass. Fast turns off glow for older phones.</small>
      <div className="row">
        <button className="btn grow" data-sound aria-pressed={s.sound} onClick={() => engine.toggleSound()}>{s.sound ? 'Sound on' : 'Sound off'}</button>
        <button className="btn grow" onClick={() => useUI.setState({ photo: true })}>Photo mode</button>
        <button className="btn grow" onClick={() => useUI.setState({ uiHidden: true })}>Hide UI</button>
      </div>
    </>
  );
}

function Online() {
  const n = useUI(s => s.online);
  if (n == null) return null;
  return <div className="panel online" title="Players in Aeloria right now"><i aria-hidden="true" />{n} online</div>;
}

export function Controls() {
  const open = useUI(s => s.panelOpen), tab = useUI(s => s.tab);
  return (
    <>
      <div className="top-right">
        <Online />
        {canFullscreen() && <FullscreenButton />}
        <button className="btn panel icon" onClick={() => engine.pause(true)} aria-label="Pause and show controls" title="Pause, controls and help (Esc)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
        </button>
        <button className="btn panel ctrl-toggle" aria-expanded={open} aria-controls="ctrl" onClick={() => useUI.setState({ panelOpen: !open })}>{open ? 'Close' : 'Settings'}</button>
      </div>
      <aside id="ctrl" className={'panel ctrl' + (open ? ' open' : '')} aria-label="World controls">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'ride'} onClick={() => useUI.setState({ tab: 'ride' })}>Ride</button>
          <button role="tab" aria-selected={tab === 'world'} onClick={() => useUI.setState({ tab: 'world' })}>World</button>
        </div>
        {tab === 'ride' ? <RideTab /> : <WorldTab />}
      </aside>
    </>
  );
}

export function Roster() {
  const sel = useUI(s => s.sel), palettes = useUI(s => s.palettes), riderPal = useUI(s => s.riderPal);
  return (
    <nav className="panel roster" aria-label="Riders">
      {RIDERS.map((r, i) => {
        const p = palettes.find(x => x.id === riderPal[i]) ?? r.pal;
        return (
          <button key={r.name} className="rider" aria-pressed={i === sel} onClick={() => engine.select(i)}>
            <span className="sw" style={{ background: swatch(p) }} />
            <span><b>{r.name}</b><small>{i + 1} · {p.name}</small></span>
          </button>
        );
      })}
    </nav>
  );
}

function BondButton() {
  const bond = useUI(s => s.bond);
  const close = bond.dist < 40;
  const hold = (on: boolean) => () => { engine.bondHold = on; };
  if (!bond.name || bond.dist > 160) return null;
  return (
    <div className="chip bond">
      <span className="sw sm" style={{ background: bond.swatch ?? undefined }} />
      <span><b>{bond.name}</b><small>wild · {Math.round(bond.dist)} m</small></span>
      {close ? (
        <button className="btn primary hold" onPointerDown={hold(true)} onPointerUp={hold(false)} onPointerLeave={hold(false)} onPointerCancel={hold(false)}
          style={{ ['--p' as string]: String(Math.min(1, bond.progress)) }}>
          Hold to bond <kbd>B</kbd>
        </button>
      ) : <small className="hint">fly closer to bond</small>}
    </div>
  );
}

export function Activities() {
  const race = useUI(s => s.race), seeds = useUI(s => s.seeds);
  return (
    <section className="panel acts" aria-label="Activities">
      {race.active ? (
        <div className="chip race">
          <span className="label">Skyveil Run</span>
          <strong>{fmtTime(race.time)}</strong>
          <small>ring {Math.min(race.next + 1, race.total)} / {race.total}</small>
          <button className="btn" onClick={() => engine.stopRace()}>Quit</button>
        </div>
      ) : (
        <button className="act" onClick={() => engine.startRace(fade)} disabled={!race.total}>
          <b>Race the rings</b>
          <small>{race.last != null ? `last ${fmtTime(race.last)} · ` : ''}{race.best != null ? `best ${fmtTime(race.best)}` : `${race.total} rings · R`}</small>
        </button>
      )}
      <button className="act" onClick={() => engine.findLeviathan()}>
        <b>Ride with the Leviathan</b><small>a 300 m sky whale · L</small>
      </button>
      <button className="act" onClick={() => engine.findFlock()}>
        <b>Find wild mounts</b><small>bond to take a new mount · G</small>
      </button>
      <button className="act" onClick={() => engine.findSeed()}>
        <b>Drift seeds {seeds.got}/{seeds.total}</b><small>{seeds.nearest != null ? `nearest ${fmtDist(seeds.nearest)}` : 'all collected'}</small>
      </button>
      <BondButton />
    </section>
  );
}

function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { engine.minimap = ref.current; return () => { engine.minimap = null; }; }, []);
  return (
    <button className="minimap" onClick={() => useUI.setState({ mapOpen: true })} aria-label="Open world map" title="World map (M)">
      <canvas ref={ref} />
    </button>
  );
}

export function Hud() {
  const hud = useUI(s => s.hud), manual = useUI(s => s.manual), touch = useUI(s => s.touch);
  return (
    <div className="panel hud">
      <Minimap />
      <div className="hud-main">
        <div className="gauges">
          <div className="gauge wide"><span className={'label mode' + (manual ? ' manual' : '')}>{manual ? 'Your reins' : 'Autopilot'}</span><strong className="where">{hud.where}</strong></div>
          <div className="gauge"><span className="label">Altitude</span><strong>{hud.alt}<sub>m</sub></strong></div>
          <div className="gauge"><span className="label">Speed</span><strong>{hud.spd}<sub>km/h</sub></strong></div>
        </div>
        {manual && (
          <div className="stamina" aria-label={`Stamina ${Math.round(hud.stamina * 100)} percent`}>
            <span className="label">Stamina</span>
            <div className="bar"><i style={{ transform: `scaleX(${hud.stamina})` }} className={hud.stamina < 0.2 ? 'low' : ''} /></div>
          </div>
        )}
        {hud.pin != null && <div className="pin-row"><span className="label">Map pin</span><b>{fmtDist(hud.pin)}</b><button className="link" onClick={() => engine.clearPin()}>Clear</button></div>}
        <div className="hud-actions">
          <button className="btn" aria-pressed={manual} onClick={() => engine.reins(!manual)}>{manual ? 'Autopilot' : 'Take reins'} <kbd>F</kbd></button>
          <button className="btn" onClick={() => useUI.setState({ mapOpen: true })}>Map <kbd>M</kbd></button>
        </div>
        {!touch && (
          <div className="keys">
            {manual
              ? hud.pad
                ? <><span><kbd>Stick</kbd>steer</span><span><kbd>A/RT</kbd>flap</span><span><kbd>B/LT</kbd>dive</span><span><kbd>X</kbd>roll</span></>
                : <><span><kbd>{hud.locked ? 'Mouse' : 'WASD'}</kbd>steer</span><span><kbd>Space</kbd>flap</span><span><kbd>Shift</kbd>dive</span><span><kbd>Q E</kbd>roll</span>{!hud.locked && <span>click the view to aim with the mouse</span>}</>
              : <><span><kbd>1–6</kbd>rider</span><span><kbd>C</kbd>camera</span><span><kbd>R</kbd>race</span><span><kbd>P</kbd>photo</span><span><kbd>H</kbd>hide</span></>}
          </div>
        )}
      </div>
    </div>
  );
}

export function Compass() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { engine.compass = ref.current; return () => { engine.compass = null; }; }, []);
  return <canvas ref={ref} className="compass" aria-hidden="true" />;
}

export function Reticle() {
  const manual = useUI(s => s.manual), locked = useUI(s => s.hud.locked);
  if (!manual || !locked) return null;
  return (
    <div className="reticle" aria-hidden="true">
      <i />
      <small>Esc frees the cursor, Esc again pauses · F hands back to autopilot</small>
    </div>
  );
}

export function WorldMap() {
  const open = useUI(s => s.mapOpen), places = useUI(s => s.places);
  const ref = useRef<HTMLCanvasElement>(null);
  const [picked, setPicked] = useState<{ x: number; z: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const draw = () => ref.current && engine.drawWorldMap(ref.current);
    draw();
    const h = setInterval(draw, 200);
    return () => clearInterval(h);
  }, [open]);
  if (!open) return null;
  const close = () => useUI.setState({ mapOpen: false });
  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = engine.mapToWorld((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    setPicked(p);
    engine.flyToPoint(p.x, p.z, false);
  };
  return (
    <div className="map-overlay" role="dialog" aria-label="World map" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="panel map-card">
        <div className="map-head">
          <div><span className="eyebrow">World map</span><h2>Click anywhere to fly there</h2></div>
          <button className="btn" onClick={close}>Close <kbd>Esc</kbd></button>
        </div>
        <canvas ref={ref} className="map-canvas" onClick={click} />
        <div className="map-foot">
          <div className="legend">
            <span><i className="dot" style={{ background: '#ffd36a' }} />Drift seeds</span>
            <span><i className="dot" style={{ background: '#ff6ad5' }} />Wild mounts</span>
            <span><i className="dot" style={{ background: '#5ff2d6' }} />Places and race course</span>
          </div>
          <div className="row">
            {picked && <button className="btn primary" onClick={() => { engine.flyToPoint(picked.x, picked.z, true, fade); close(); }}>Jump there now</button>}
            {places.map((p, i) => <button key={p.name} className="btn" onClick={() => { engine.flyTo(i, fade); close(); }}>{p.name}</button>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** On-screen stick and buttons for flying on phones and tablets. */
export function TouchControls() {
  const manual = useUI(s => s.manual), touch = useUI(s => s.touch);
  const knob = useRef<HTMLDivElement>(null);
  const base = useRef<{ x: number; y: number; id: number } | null>(null);
  if (!touch || !manual) return null;
  const move = (e: React.PointerEvent) => {
    if (!base.current || e.pointerId !== base.current.id) return;
    const dx = Math.max(-1, Math.min(1, (e.clientX - base.current.x) / 56)), dy = Math.max(-1, Math.min(1, (e.clientY - base.current.y) / 56));
    engine.input.touch.x = dx; engine.input.touch.y = -dy;
    if (knob.current) knob.current.style.transform = `translate(${dx * 40}px,${dy * 40}px)`;
  };
  const end = () => { base.current = null; engine.input.touch.x = engine.input.touch.y = 0; if (knob.current) knob.current.style.transform = ''; };
  const hold = (k: 'flap' | 'dive', on: boolean) => () => { engine.input.touch[k] = on; };
  return (
    <div className="touch">
      <div className="stick" onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); base.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId }; move(e); }}
        onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-label="Steer">
        <div ref={knob} className="knob" />
      </div>
      <div className="touch-btns">
        <button className="tbtn" onPointerDown={() => (engine.input.trick = 1)}>Roll</button>
        <button className="tbtn" onPointerDown={hold('dive', true)} onPointerUp={hold('dive', false)} onPointerCancel={hold('dive', false)} onPointerLeave={hold('dive', false)}>Dive</button>
        <button className="tbtn big" onPointerDown={hold('flap', true)} onPointerUp={hold('flap', false)} onPointerCancel={hold('flap', false)} onPointerLeave={hold('flap', false)}>Flap</button>
      </div>
    </div>
  );
}

export function Labels() {
  const sel = useUI(s => s.sel), palettes = useUI(s => s.palettes), riderPal = useUI(s => s.riderPal);
  const refs = useRef<HTMLElement[]>([]);
  useEffect(() => { engine.labels = refs.current; }, []);
  return (
    <div className="labels">
      {RIDERS.map((r, i) => {
        const p = palettes.find(x => x.id === riderPal[i]) ?? r.pal;
        return (
          <button key={r.name} ref={el => { if (el) refs.current[i] = el; }} className={'tag' + (i === sel ? ' sel' : '')} onClick={() => engine.select(i)} style={{ display: 'none' }}>
            <i style={{ background: swatch(p) }} />{r.name}
          </button>
        );
      })}
    </div>
  );
}

export function Toast() {
  const t = useUI(s => s.toast);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!t) return;
    setShow(true);
    const h = setTimeout(() => setShow(false), 2400);
    return () => clearTimeout(h);
  }, [t]);
  return (
    <div className="toast" style={{ opacity: show ? 1 : 0 }} role="status" aria-live="polite">
      {t && <>{t.title}<small>{t.sub}</small></>}
    </div>
  );
}

export function Loading() {
  const loading = useUI(s => s.loading), msg = useUI(s => s.loadMsg), err = useUI(s => s.error);
  return (
    <div className={'loading' + (loading ? '' : ' done')} aria-hidden={!loading}>
      <div className="t">AELORIA</div>
      <div className="by"><Credits /></div>
      <div className="s">{msg}</div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

export function PhotoBar() {
  const photo = useUI(s => s.photo), hidden = useUI(s => s.uiHidden);
  if (!photo && !hidden) return null;
  return (
    <div className="photobar">
      {photo && <button className="btn primary" onClick={() => engine.savePhoto()}>Save image</button>}
      <button className="btn" onClick={() => useUI.setState({ photo: false, uiHidden: false })}>{photo ? 'Exit photo mode' : 'Show UI'}</button>
    </div>
  );
}

function FullscreenButton() {
  const on = useUI(s => s.fullscreen);
  return (
    <button className="btn panel icon" onClick={toggleFullscreen} aria-pressed={on} aria-label={on ? 'Exit full screen' : 'Full screen'} title={(on ? 'Exit full screen' : 'Full screen') + ' (K)'}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {on ? <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" /> : <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />}
      </svg>
    </button>
  );
}

type Row = [string, string, string?, string?];
/** action, keyboard + mouse, gamepad, touch */
const FLY: Row[] = [
  ['Take the reins / autopilot', 'F', 'Start', 'Take reins button'],
  ['Steer', 'Mouse (click the view first) or WASD / arrows', 'Left stick', 'Left stick on screen'],
  ['Flap: thrust, uses stamina', 'Space', 'A or RT', 'Flap'],
  ['Dive: tuck the wings', 'Shift', 'B or LT', 'Dive'],
  ['Barrel roll', 'Q / E', 'X', 'Roll'],
];
const EXPLORE: Row[] = [
  ['Switch rider', '1–6, Tab, or click a rider', 'LB / RB', 'Tap a rider'],
  ['Camera: chase, saddle, drone, orbit, film', 'C (Shift+C back)', 'Y', 'Settings → Ride'],
  ['World map, fly anywhere', 'M', 'Back', 'Minimap'],
  ['Ring race', 'R', '', 'Race button'],
  ['Seek a wild flock / hold to bond', 'G / hold B', '', 'Activity buttons'],
  ['Ride with the Leviathan', 'L', '', 'Activity buttons'],
  ['Sky: day, dusk, night', 'T', '', 'Settings → World'],
  ['Photo mode', 'P', '', 'Settings → World'],
  ['Hide the interface', 'H', '', ''],
  ['Sound', 'O', '', 'Below'],
  ['Full screen', 'K', '', 'Below'],
  ['New world', 'N', '', 'Settings → World'],
  ['Pause and this help', 'Esc (twice while aiming with the mouse)', '', 'Pause button, top right'],
  ['Resume', 'Esc', 'Start', 'Resume'],
];

function KeyTable({ title, rows, touch, pad }: { title: string; rows: Row[]; touch: boolean; pad: boolean }) {
  return (
    <div className="grp">
      <span className="label">{title}</span>
      <table className="keytable">
        <tbody>
          {rows.map(([what, kb, gp, tc]) => {
            const how = touch ? tc : pad ? gp : kb;
            return how ? <tr key={what}><th scope="row">{what}</th><td>{how}</td></tr> : null;
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Esc menu: freezes the world and explains every control for the input in use, plus credits. */
export function PauseMenu() {
  const s = useUI(useShallow(st => ({ paused: st.paused, touch: st.touch, pad: st.hud.pad, sound: st.sound, fs: st.fullscreen, manual: st.manual })));
  const resume = useRef<HTMLButtonElement>(null);
  const [input, setInput] = useState<'kb' | 'pad' | 'touch'>('kb');
  useEffect(() => {
    if (!s.paused) return;
    setInput(s.touch ? 'touch' : s.pad ? 'pad' : 'kb');
    resume.current?.focus();
  }, [s.paused]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s.paused) return null;
  const close = () => engine.pause(false);
  return (
    <div className="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="panel pause-card">
        <div className="pause-head">
          <div><span className="eyebrow">Paused</span><h2 id="pause-title">How to fly</h2></div>
          <button ref={resume} className="btn primary" onClick={close}>Resume {!s.touch && <kbd>Esc</kbd>}</button>
        </div>
        <p className="hint">Flight runs on energy. Diving trades height for speed, climbing spends it. Flapping gives thrust but drains stamina, which refills while you glide, collect drift seeds or pass race rings. Fly too slow and you stall. Flight assist (Settings → Ride) steers you around rock.</p>
        <div className="seg" role="group" aria-label="Show controls for">
          {([['kb', 'Keyboard + mouse'], ['pad', 'Gamepad'], ['touch', 'Touch']] as const).map(([k, l]) =>
            <button key={k} aria-pressed={input === k} onClick={() => setInput(k)}>{l}</button>)}
        </div>
        <div className="pause-cols">
          <KeyTable title={s.manual ? 'Flying (your reins)' : 'Flying yourself'} rows={FLY} touch={input === 'touch'} pad={input === 'pad'} />
          <KeyTable title="Exploring" rows={EXPLORE} touch={input === 'touch'} pad={input === 'pad'} />
        </div>
        <div className="row">
          {canFullscreen() && <button className="btn grow" aria-pressed={s.fs} onClick={toggleFullscreen}>{s.fs ? 'Exit full screen' : 'Full screen'}{!s.touch && <kbd>K</kbd>}</button>}
          <button className="btn grow" data-sound aria-pressed={s.sound} onClick={() => engine.toggleSound()}>{s.sound ? 'Sound on' : 'Sound off'}{!s.touch && <kbd>O</kbd>}</button>
        </div>
        <div className="by pause-by"><Credits /></div>
      </div>
    </div>
  );
}

/** First visits only: say plainly that the mount is on autopilot and how to take over, until the player has flown once. */
export function ReinsHint() {
  const loading = useUI(s => s.loading), manual = useUI(s => s.manual), touch = useUI(s => s.touch);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (loading || store.get('took-reins', false)) return;
    const on = setTimeout(() => setShow(true), 3600), off = setTimeout(() => setShow(false), 3600 + 10000);
    return () => { clearTimeout(on); clearTimeout(off); };
  }, [loading]);
  useEffect(() => { if (manual) { store.set('took-reins', true); setShow(false); } }, [manual]);
  if (!show || manual) return null;
  return (
    <div className="panel reins-hint" role="status">
      <span className="eyebrow">Autopilot</span>
      <p>Your mount is flying itself. {touch ? <>Tap <b>Take reins</b> to fly yourself.</> : <>Press <kbd>F</kbd> to take the reins and fly yourself.</>}</p>
      <div className="row">
        <button className="btn primary" onClick={() => engine.reins(true)}>Take reins{!touch && <kbd>F</kbd>}</button>
        <button className="btn" onClick={() => setShow(false)}>Keep watching</button>
      </div>
    </div>
  );
}
