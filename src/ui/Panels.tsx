import { useEffect, useRef, useState } from 'react';
import { engine } from '../engine/Engine';
import { RIDERS, swatch } from '../engine/creatures';
import type { Weather } from '../engine/palette';
import { useUI, type CamMode, type Gfx } from '../state/store';
import { regrow } from './actions';
import { useShallow } from 'zustand/react/shallow';

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
  const seed = useUI(s => s.seed), stats = useUI(s => s.stats), tris = useUI(s => s.hud.tris);
  return (
    <header className="panel intro">
      <div className="eyebrow">Procedural world · seed {seed}</div>
      <h1>Aeloria</h1>
      <p>Every leaf, cliff, waterfall and glow here is grown in your browser from one number. <b>No models, no textures, no assets.</b> Click a rider to fly with them. Fly low at night and the forest lights up under the wings.</p>
      <dl className="stats">
        <div><dt>Floating isles</dt><dd>{stats.isles || '—'}</dd></div>
        <div><dt>Plants</dt><dd>{stats.plants ? (stats.plants / 1000).toFixed(1) + 'k' : '—'}</dd></div>
        <div><dt>Triangles</dt><dd>{tris ? (tris / 1e6).toFixed(1) + 'M' : '—'}</dd></div>
      </dl>
    </header>
  );
}

export function Controls() {
  const s = useUI(useShallow(st => ({ cam: st.cam, sky: st.sky, cycle: st.cycle, weather: st.weather, gfx: st.gfx, sound: st.sound, seed: st.seed, fps: st.hud.fps })));
  const places = useUI(st => st.places), dists = useUI(st => st.hud.dists), near = useUI(st => st.hud.near);
  const palettes = useUI(st => st.palettes), riderPal = useUI(st => st.riderPal), sel = useUI(st => st.sel);
  const [open, setOpen] = useState(false);
  const [seedIn, setSeedIn] = useState(String(s.seed));
  useEffect(() => setSeedIn(String(s.seed)), [s.seed]);
  const grow = () => { const v = parseInt(seedIn, 10); if (Number.isFinite(v)) regrow(Math.abs(v) % 1_000_000); };
  return (
    <>
      <button className="btn panel ctrl-toggle" aria-expanded={open} aria-controls="ctrl" onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Controls'}</button>
      <aside id="ctrl" className={'panel ctrl' + (open ? ' open' : '')} aria-label="World controls">
        <Seg id="l-cam" label="Camera" hint="C" value={s.cam} onPick={(v: CamMode) => engine.setCam(v)}
          options={[['chase', 'Chase'], ['seat', 'Saddle'], ['orbit', 'Orbit'], ['cinema', 'Film']]} />
        <Seg id="l-sky" label="Sky" hint="T" value={s.cycle ? 'cycle' : String(s.sky)}
          onPick={v => useUI.setState(v === 'cycle' ? { cycle: !s.cycle } : { cycle: false, sky: +v })}
          options={[['0', 'Day'], ['0.5', 'Dusk'], ['1', 'Night'], ['cycle', 'Cycle']]} />
        <Seg id="l-wx" label="Weather" value={s.weather} onPick={(v: Weather) => useUI.setState({ weather: v })}
          options={[['clear', 'Clear'], ['mist', 'Mist'], ['rain', 'Rain'], ['storm', 'Storm']]} />
        <div className="grp">
          <div className="grp-head"><span className="label">Fly to</span></div>
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
          options={[['auto', 'Auto'], ['fast', 'Fast'], ['high', 'High']]} />
        <div className="row">
          <button className="btn grow" aria-pressed={s.sound} onClick={() => engine.toggleSound()}>{s.sound ? 'Sound on' : 'Sound off'}</button>
          <button className="btn grow" onClick={() => useUI.setState({ photo: true })}>Photo mode</button>
          <button className="btn grow" onClick={() => useUI.setState({ uiHidden: true })}>Hide UI</button>
        </div>
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

export function Hud() {
  const hud = useUI(s => s.hud), manual = useUI(s => s.manual);
  return (
    <div className="panel hud">
      <div className="gauge"><span className={'label mode' + (manual ? ' manual' : '')}>{manual ? 'Your reins' : 'Autopilot'}</span><strong className="where">{hud.where}</strong></div>
      <div className="gauge"><span className="label">Altitude</span><strong>{hud.alt}<sub>m</sub></strong></div>
      <div className="gauge"><span className="label">Speed</span><strong>{hud.spd}<sub>km/h</sub></strong></div>
      <button className="btn" aria-pressed={manual} onClick={() => engine.reins(!manual)}>{manual ? 'Autopilot' : 'Take reins'}</button>
      <div className="keys">
        {manual
          ? <><span><kbd>WASD</kbd>steer</span><span><kbd>Shift</kbd>dive fast</span><span><kbd>Esc</kbd>autopilot</span></>
          : <><span><kbd>1–6</kbd>rider</span><span><kbd>F</kbd>reins</span><span><kbd>P</kbd>photo</span><span><kbd>H</kbd>hide</span></>}
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
