/** Fully procedural soundscape: wind, a slow pad, rain, creature chirps, wingbeats, chimes, thunder and flight cues. */
export class Sound {
  private ac: AudioContext | null = null;
  private master!: GainNode;
  private windF!: BiquadFilterNode;
  private windG!: GainNode;
  private rainG!: GainNode;
  private pad!: GainNode;
  private whistleF!: BiquadFilterNode;
  private whistleG!: GainNode;
  private bondO!: OscillatorNode;
  private bondG!: GainNode;
  on = false;

  private noiseBuffer(sec: number, brown: boolean) {
    const ac = this.ac!, len = (ac.sampleRate * sec) | 0, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  private init() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = (this.ac = new AC());
    this.master = ac.createGain();
    this.master.gain.value = 0;
    this.master.connect(ac.destination);
    const wind = ac.createBufferSource();
    wind.buffer = this.noiseBuffer(2, true);
    wind.loop = true;
    this.windF = ac.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 500;
    this.windG = ac.createGain(); this.windG.gain.value = 0.25;
    wind.connect(this.windF).connect(this.windG).connect(this.master);
    wind.start();
    const rain = ac.createBufferSource();
    rain.buffer = this.noiseBuffer(2, false);
    rain.loop = true;
    const rf = ac.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1800;
    this.rainG = ac.createGain(); this.rainG.gain.value = 0;
    rain.connect(rf).connect(this.rainG).connect(this.master);
    rain.start();
    const whistle = ac.createBufferSource();
    whistle.buffer = this.noiseBuffer(2, false);
    whistle.loop = true;
    this.whistleF = ac.createBiquadFilter(); this.whistleF.type = 'bandpass'; this.whistleF.frequency.value = 900; this.whistleF.Q.value = 6;
    this.whistleG = ac.createGain(); this.whistleG.gain.value = 0;
    whistle.connect(this.whistleF).connect(this.whistleG).connect(this.master);
    whistle.start();
    this.bondO = ac.createOscillator(); this.bondO.type = 'triangle'; this.bondO.frequency.value = 220;
    const bv = ac.createOscillator(); bv.frequency.value = 5.5;
    const bvg = ac.createGain(); bvg.gain.value = 6;
    bv.connect(bvg).connect(this.bondO.frequency); bv.start();
    this.bondG = ac.createGain(); this.bondG.gain.value = 0;
    this.bondO.connect(this.bondG).connect(this.master); this.bondO.start();
    this.pad = ac.createGain(); this.pad.gain.value = 0.05;
    const pf = ac.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 900;
    this.pad.connect(pf).connect(this.master);
    [110, 164.8, 220, 246.9, 329.6].forEach((f, i) => {
      const o = ac.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
      const g = ac.createGain(); g.gain.value = 0.2;
      const l = ac.createOscillator(); l.frequency.value = 0.05 + i * 0.03;
      const lg = ac.createGain(); lg.gain.value = 0.15;
      l.connect(lg).connect(g.gain); l.start();
      o.connect(g).connect(this.pad); o.start();
    });
  }

  toggle(on: boolean) {
    this.on = on;
    if (on && !this.ac) {
      try { this.init(); } catch { this.on = false; return false; }
    }
    if (this.ac) { void this.ac.resume(); this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ac.currentTime, 0.4); }
    return this.on;
  }

  frame(speed: number, rain: number, tuck = 0) {
    if (!this.ac || !this.on) return;
    const t = this.ac.currentTime;
    this.windF.frequency.setTargetAtTime(300 + speed * 14, t, 0.3);
    this.windG.gain.setTargetAtTime(0.12 + speed / 180, t, 0.3);
    this.rainG.gain.setTargetAtTime(rain * 0.12, t, 0.5);
    const fast = Math.max(0, (speed - 45) / 50);
    this.whistleF.frequency.setTargetAtTime(700 + speed * 16, t, 0.3);
    this.whistleG.gain.setTargetAtTime(Math.min(0.09, fast * 0.05 + tuck * fast * 0.05), t, 0.4);
  }

  /** rising hum while holding to bond with a wild mount, 0..1 */
  bond(p: number) {
    if (!this.ac || !this.on) return;
    const t = this.ac.currentTime;
    this.bondO.frequency.setTargetAtTime(196 * Math.pow(2, p * 1.5), t, 0.1);
    this.bondG.gain.setTargetAtTime(p > 0.01 ? 0.03 + p * 0.05 : 0, t, 0.15);
  }

  /** a mount's cry: a falling then rising FM call */
  call() {
    if (!this.ac || !this.on) return;
    const ac = this.ac, t = ac.currentTime, o = ac.createOscillator(), m = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(340, t + 0.25); o.frequency.exponentialRampToValueAtTime(620, t + 0.7);
    m.frequency.value = 38; mg.gain.value = 60;
    m.connect(mg).connect(o.frequency);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.05); g.gain.setTargetAtTime(0.0001, t + 0.55, 0.12);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); m.start(t); o.stop(t + 1.1); m.stop(t + 1.1);
  }

  /** barrel roll: a noise sweep that pans across */
  roll(dir: number) {
    if (!this.ac || !this.on) return;
    const ac = this.ac, t = ac.currentTime, len = (ac.sampleRate * 0.85) | 0, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
    const s = ac.createBufferSource(); s.buffer = b;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.4); f.frequency.exponentialRampToValueAtTime(350, t + 0.85);
    const g = ac.createGain(); g.gain.value = 0.3;
    let out: AudioNode = g;
    if (ac.createStereoPanner) {
      const pn = ac.createStereoPanner();
      pn.pan.setValueAtTime(-dir * 0.8, t); pn.pan.linearRampToValueAtTime(dir * 0.8, t + 0.85);
      g.connect(pn); out = pn;
    }
    s.connect(f).connect(g); out.connect(this.master); s.start(t);
  }

  /** stall warning: wings fluttering against nothing */
  stall() {
    if (!this.ac || !this.on) return;
    const ac = this.ac, t = ac.currentTime;
    for (let i = 0; i < 4; i++) {
      const s = t + i * 0.09, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(140 - i * 12, s);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.035, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.07);
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
      o.connect(f).connect(g).connect(this.master); o.start(s); o.stop(s + 0.08);
    }
  }

  /** two soft notes: up when taking the reins, down when handing back */
  reins(on: boolean) {
    if (!this.ac || !this.on) return;
    const ac = this.ac, t = ac.currentTime, notes = on ? [392, 587.3] : [587.3, 392];
    notes.forEach((fr, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), s = t + i * 0.09;
      o.type = 'triangle'; o.frequency.value = fr;
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.06, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.35);
      o.connect(g).connect(this.master); o.start(s); o.stop(s + 0.4);
    });
  }

  /** race start: a low horn swelling into a fifth */
  horn() {
    if (!this.ac || !this.on) return;
    const ac = this.ac, t = ac.currentTime, f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(1800, t + 0.5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.25); g.gain.setTargetAtTime(0.0001, t + 0.9, 0.2);
    f.connect(g).connect(this.master);
    [146.8, 220, 293.7].forEach((fr, i) => {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = (i - 1) * 6;
      o.connect(f); o.start(t + i * 0.12); o.stop(t + 1.8);
    });
  }

  /** camera shutter for photo mode */
  shutter() {
    if (!this.ac || !this.on) return;
    const ac = this.ac, t = ac.currentTime;
    [0, 0.07].forEach((dt, i) => {
      const len = (ac.sampleRate * 0.03) | 0, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
      for (let j = 0; j < len; j++) d[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, 3);
      const s = ac.createBufferSource(); s.buffer = b;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = i ? 2600 : 3800; f.Q.value = 1.2;
      const g = ac.createGain(); g.gain.value = 0.35;
      s.connect(f).connect(g).connect(this.master); s.start(t + dt);
    });
  }

  thump(k: number) {
    if (!this.ac || !this.on) return;
    const ac = this.ac, t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    g.gain.setValueAtTime(0.5 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.5);
    this.whoosh(k * 1.5);
  }

  spray() {
    if (!this.ac || !this.on) return;
    const ac = this.ac, len = (ac.sampleRate * 0.35) | 0, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const s = ac.createBufferSource(); s.buffer = b;
    const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2400;
    const g = ac.createGain(); g.gain.value = 0.12;
    s.connect(f).connect(g).connect(this.master); s.start();
  }

  chirp() {
    if (!this.ac || !this.on) return;
    const ac = this.ac, t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    const f = 1800 + Math.random() * 2400;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (0.6 + Math.random() * 0.9), t + 0.12);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
  }

  whoosh(k: number) {
    if (!this.ac || !this.on) return;
    const ac = this.ac, len = (ac.sampleRate * 0.5) | 0, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
    const s = ac.createBufferSource(); s.buffer = b;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 0.8;
    const g = ac.createGain(); g.gain.value = 0.22 * k;
    s.connect(f).connect(g).connect(this.master); s.start();
  }

  chime(step = 0) {
    if (!this.ac || !this.on) return;
    const ac = this.ac, t = ac.currentTime;
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f * Math.pow(2, step / 12);
      const s = t + i * 0.06;
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.05, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.9);
      o.connect(g).connect(this.master); o.start(s); o.stop(s + 1);
    });
  }

  thunder(delay: number) {
    if (!this.ac || !this.on) return;
    const ac = this.ac, t = ac.currentTime + delay, s = ac.createBufferSource();
    s.buffer = this.noiseBuffer(3, true);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
    s.connect(f).connect(g).connect(this.master); s.start(t);
  }
}
