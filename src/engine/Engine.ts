import * as THREE from 'three';
import { TAU, clamp, lerp, makeNoise, sm } from '../world/noise';
import { Terrain, WL } from '../world/terrain';
import { toBufferGeometry } from '../world/geometry';
import type { MatKey, PointsData, Quality, WorldData } from '../world/generate';
import { U, bioMat, makeFallMaterial, makePointsMaterial, makeRain, makeSkyMaterial, makeWaterMaterial } from './materials';
import { palette } from './palette';
import { RIDERS, SEED_PALETTES, swatch, type MountPalette } from './creatures';
import { Rider, type FlightInput } from './rider';
import { Wilds } from './wild';
import { Race, Seeds } from './collectibles';
import { Sound } from './audio';
import { store, toast, useUI, type CamMode } from '../state/store';

const V3 = THREE.Vector3;
const UPV = new V3(0, 1, 0);

export function detectQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) || (nav.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  if (mobile) return 'low';
  if ((nav.hardwareConcurrency || 4) >= 8 && (nav.deviceMemory ?? 8) >= 8) return 'high';
  return 'medium';
}

/** Small ambient birds circling the regions; cheap instanced silhouettes. */
class Birds {
  B: THREE.InstancedMesh; L: THREE.InstancedMesh; R: THREE.InstancedMesh;
  birds: { c: THREE.Vector3; rad: number; ph: number; sp: number; dy: number; fl: number; dir: number }[] = [];
  private m = new THREE.Matrix4(); private w = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new V3(); private f = new V3();
  private bank = new THREE.Quaternion(); private one = new V3(1, 1, 1); private mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
  constructor(group: THREE.Group, centres: THREE.Vector3[], mat: THREE.Material) {
    const body = new THREE.ConeGeometry(0.6, 4, 6); body.rotateX(Math.PI / 2);
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1, 5, 0, -0.6, 0, 0, -1.4, 5, 0, -0.6, 7, 0, -1.8, 0, 0, -1.4], 3));
    wing.computeVertexNormals();
    const paint = (g: THREE.BufferGeometry, c: string, gl: (x: number) => number) => {
      const P = g.attributes.position.array, n = P.length / 3, C = new Float32Array(n * 3), G = new Float32Array(n * 3);
      const cc = new THREE.Color(c), gg = new THREE.Color('#ff8a3f');
      for (let i = 0; i < n; i++) { cc.toArray(C, i * 3); gg.clone().multiplyScalar(gl(P[i * 3])).toArray(G, i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('aGlow', new THREE.BufferAttribute(G, 3));
    };
    paint(body, '#1a1f2e', () => 0.3); paint(wing, '#2a2440', x => (x > 4 ? 0.35 : 0));
    const n = centres.length * 10;
    this.B = new THREE.InstancedMesh(body, mat, n); this.L = new THREE.InstancedMesh(wing, mat, n); this.R = new THREE.InstancedMesh(wing, mat, n);
    for (const m of [this.B, this.L, this.R]) { m.frustumCulled = false; group.add(m); }
    centres.forEach((c, k) => {
      const rad = 90 + Math.random() * 120;
      for (let i = 0; i < 10; i++) this.birds.push({ c, rad: rad + (Math.random() - 0.5) * 40, ph: Math.random() * TAU, sp: 0.12 + Math.random() * 0.03, dy: (Math.random() - 0.5) * 30, fl: Math.random() * TAU, dir: k % 2 ? 1 : -1 });
    });
  }
  update(t: number) {
    this.birds.forEach((b, i) => {
      const a = b.ph + t * b.sp * b.dir;
      this.p.set(b.c.x + Math.cos(a) * b.rad, b.c.y + b.dy + Math.sin(t * 0.3 + b.ph) * 12, b.c.z + Math.sin(a) * b.rad);
      this.f.set(-Math.sin(a) * b.dir, 0, Math.cos(a) * b.dir);
      this.m.lookAt(new V3(), this.f, UPV);
      this.q.setFromRotationMatrix(this.m).multiply(this.bank.setFromAxisAngle(new V3(0, 0, 1), 0.35 * b.dir));
      this.m.compose(this.p, this.q, this.one);
      this.B.setMatrixAt(i, this.m);
      const fl = Math.sin(t * 5 + b.fl) * 0.6;
      this.R.setMatrixAt(i, this.w.copy(this.m).multiply(new THREE.Matrix4().makeRotationZ(fl)));
      this.L.setMatrixAt(i, this.w.copy(this.m).multiply(this.mirror).multiply(new THREE.Matrix4().makeRotationZ(fl)));
    });
    this.B.instanceMatrix.needsUpdate = this.L.instanceMatrix.needsUpdate = this.R.instanceMatrix.needsUpdate = true;
  }
}

export class Engine {
  gl!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  ready = false;

  data: WorldData | null = null;
  terrain: Terrain | null = null;
  world: THREE.Group | null = null;
  chunks: THREE.InstancedMesh[] = [];
  pts: { ff?: THREE.ShaderMaterial; halo?: THREE.ShaderMaterial; mist?: THREE.ShaderMaterial } = {};
  riders: Rider[] = [];
  wilds!: Wilds;
  seeds: Seeds | null = null;
  race: Race | null = null;
  birds: Birds | null = null;
  sound = new Sound();

  private skyMat = makeSkyMaterial();
  private sky = new THREE.Mesh(new THREE.SphereGeometry(4600, 48, 24), this.skyMat);
  private waterMat = makeWaterMaterial(this.skyMat);
  private water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), this.waterMat);
  private fallMat = makeFallMaterial();
  private rain = makeRain(5000);
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
  private mats: Record<MatKey, THREE.Material> = {
    terrain: bioMat({ roughness: 0.95 }, { ripple: true, k: 1.5, detail: 0.07 }),
    outer: bioMat({ roughness: 1 }),
    rock: bioMat({ roughness: 0.92 }, { k: 1.1, speck: 0.32, detail: 0.05 }),
    elder: bioMat({ roughness: 0.9 }, { k: 1.5, speck: 0.4, detail: 0.06 }),
    tree: bioMat({ roughness: 0.85, side: THREE.DoubleSide }, { k: 1.5, sway: 0.6, swayH: 50, speck: 0.6, detail: 0.2 }),
    flora: bioMat({ roughness: 0.7, side: THREE.DoubleSide }, { k: 1.8, ripple: true, sway: 0.12, swayH: 2.5 }),
    grass: bioMat({ roughness: 0.9, side: THREE.DoubleSide }, { k: 1.2, ripple: true, sway: 0.35, swayH: 1.6 }),
    vine: bioMat({ roughness: 0.9 }, { k: 1.5, sway: 1.2, swayH: 1, hang: true }),
    tendril: bioMat({ roughness: 0.6 }, { base: 0.15, k: 1.4, sway: 2.2, swayH: 1, hang: true }),
  };
  private birdMat = bioMat({ roughness: 0.7, side: THREE.DoubleSide }, { base: 0.4, k: 1.2 });

  // simulation state
  private tod = 0.5;
  private cycleP = 0.25;
  private flash = 0;
  private boltT = 6;
  private bondT = 0;
  bondHold = false;
  private hudT = 0;
  private fps = { acc: 0, n: 0, t: 0 };
  dpr = 1;
  maxDpr = 1.5;
  private chirpT = 0;
  private captureNext = false;
  private worker: Worker | null = null;
  private reqId = 0;

  // input
  keys: Record<string, boolean> = {};
  steer = { x: 0, y: 0 };
  private drag: { x: number; y: number; sx: number; sy: number } | null = null;
  private lastDrag = 0;
  labels: HTMLElement[] = [];

  // camera
  private snap = true;
  private camPos = new V3();
  private camLook = new V3();
  private lookYaw = 0;
  private lookPitch = 0;
  private orbitYaw = 0;
  private orbitPitch = 0.25;
  private orbitDist = 34;
  private chaseDist = 30;
  private shot = 0;
  private shotT = 0;
  private shotPos = new V3();
  private qFlip = new THREE.Quaternion().setFromAxisAngle(UPV, Math.PI);

  attach(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (this.ready) return;
    this.gl = gl; this.scene = scene; this.camera = camera;
    camera.near = 0.3; camera.far = 9500; camera.fov = 62; camera.updateProjectionMatrix();
    scene.fog = new THREE.FogExp2(0x000000, 0.0005);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.water.position.y = WL;
    scene.add(this.sky, this.water, this.sun, this.sun.target, this.hemi, this.rain);
    this.wilds = new Wilds(scene);
    this.bindInput(gl.domElement);
    this.ready = true;
  }

  /* ------------------------------------------------------------ world lifecycle */

  grow(seed: number, quality: Quality) {
    useUI.setState({ loading: true, loadMsg: `Growing seed ${seed}…`, error: null });
    this.worker ??= new Worker(new URL('../world/worker.ts', import.meta.url), { type: 'module' });
    const id = ++this.reqId;
    return new Promise<void>((resolve) => {
      this.worker!.onmessage = (e: MessageEvent<{ id: number; world?: WorldData; error?: string }>) => {
        if (e.data.id !== id) return;
        if (e.data.error || !e.data.world) {
          useUI.setState({ error: e.data.error || 'Generation failed', loadMsg: 'This device could not grow the world.' });
          return resolve();
        }
        this.build(e.data.world);
        useUI.setState({ loading: false });
        resolve();
      };
      this.worker!.postMessage({ seed, quality, id });
    });
  }

  private disposeWorld() {
    if (!this.world) return;
    this.world.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if ((o as THREE.Points).isPoints) ((o as THREE.Points).material as THREE.Material).dispose();
    });
    this.seeds?.dispose(this.world);
    this.race?.dispose(this.world);
    this.scene.remove(this.world);
    this.world = null;
    this.chunks = [];
  }

  private build(d: WorldData) {
    this.disposeWorld();
    this.data = d;
    const T = new Terrain(makeNoise(d.seed), d.regions, d.seg);
    T.heights = d.heights;
    this.terrain = T;
    const g = (this.world = new THREE.Group());
    this.scene.add(g);

    g.add(new THREE.Mesh(toBufferGeometry(d.terrain), this.mats.terrain));
    g.add(new THREE.Mesh(toBufferGeometry(d.outer), this.mats.outer));
    const geos = d.geos.map(toBufferGeometry);
    for (const m of d.meshes) {
      const mesh = new THREE.Mesh(geos[m.geo], this.mats[m.mat]);
      mesh.position.set(...m.pos); mesh.rotation.y = m.rotY; mesh.scale.setScalar(m.scale);
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      g.add(mesh);
    }
    for (const c of d.chunks) {
      const n = c.matrices.length / 16;
      const im = new THREE.InstancedMesh(geos[c.geo], this.mats[c.mat], n);
      im.instanceMatrix = new THREE.InstancedBufferAttribute(c.matrices, 16);
      if (c.colors) im.instanceColor = new THREE.InstancedBufferAttribute(c.colors, 3);
      im.boundingSphere = new THREE.Sphere(new V3(...c.center), c.radius);
      im.userData = { c: new V3(...c.center), r: c.radius, max: c.maxDist, grass: c.grass };
      im.matrixAutoUpdate = false;
      this.chunks.push(im);
      g.add(im);
    }
    if (d.falls.index.length) {
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.BufferAttribute(d.falls.position, 3));
      fg.setAttribute('uv', new THREE.BufferAttribute(d.falls.uv, 2));
      fg.setIndex(new THREE.BufferAttribute(d.falls.index, 1));
      fg.computeBoundingSphere();
      const fm = new THREE.Mesh(fg, this.fallMat); fm.renderOrder = 2; g.add(fm);
    }
    const points = (p: PointsData, additive: boolean) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(p.size, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(p.phase, 1));
      geo.setAttribute('aColor', new THREE.BufferAttribute(p.color, 3));
      const mat = makePointsMaterial(additive);
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
      g.add(pts);
      return { pts, mat };
    };
    this.pts.ff = points(d.points.ff, true).mat;
    const halo = points(d.points.halo, true); halo.mat.uniforms.uBlink.value = 0.35; halo.mat.uniforms.uDrift.value = 0; this.pts.halo = halo.mat;
    const mist = points(d.points.mist, false); mist.mat.uniforms.uBlink.value = 0; mist.mat.uniforms.uDrift.value = 3; mist.mat.uniforms.uFar.value = 0.0002; mist.pts.renderOrder = 3; this.pts.mist = mist.mat;

    this.birds = new Birds(g, [d.regions.PK, d.regions.PL, d.regions.LK, d.regions.TR].map(r => new V3(r.x, T.surface(r.x, r.z) + 180 + Math.random() * 160, r.z)), this.birdMat);
    this.seeds = new Seeds(g, d.seeds, store.get<number[]>(`seeds-${d.seed}`, []));
    this.race = new Race(g, d.rings);
    this.wilds.build(d.seed, d.flocks);

    if (!this.riders.length) this.riders = RIDERS.map((r, i) => new Rider(r, i, this.scene));
    const saved = store.get<Record<number, string>>('rider-pal', {});
    this.riders.forEach((r, i) => {
      r.manual = false; r.follow = null; r.cruiseOverride = null;
      const p = saved[i] && this.allPalettes().find(x => x.id === saved[i]);
      if (p && p.id !== r.pal.id) r.setPalette(p);
      r.spawn(this.flight, i % d.places.length);
    });
    this.snap = true;
    useUI.setState({
      seed: d.seed,
      places: d.places.map(p => ({ name: p.name, sub: p.sub })),
      stats: d.stats,
      manual: false,
      race: { active: false, next: 0, total: d.rings.length, time: 0, best: store.get<number | null>(`best-${d.seed}`, null), last: null },
      seeds: { got: this.seeds.got.size, total: d.seeds.length, nearest: null },
    });
    this.syncPalettes();
  }

  get flight() { return { terrain: this.terrain!, obstacles: this.data!.obstacles, places: this.data!.places }; }

  /* ------------------------------------------------------------ palettes */

  allPalettes(): MountPalette[] {
    const got = store.get<number>('seed-total', 0);
    const wild = store.get<MountPalette[]>('bonded', []);
    return [...RIDERS.map(r => r.pal), ...SEED_PALETTES.filter(s => got >= s.at).map(s => s.pal), ...wild];
  }
  syncPalettes() {
    useUI.setState({ palettes: this.allPalettes(), riderPal: this.riders.map(r => r.pal.id) });
  }
  applyPalette(id: string) {
    const p = this.allPalettes().find(x => x.id === id), r = this.cur;
    if (!p || !r) return;
    r.setPalette(p);
    const saved = store.get<Record<number, string>>('rider-pal', {}); saved[r.i] = id; store.set('rider-pal', saved);
    this.syncPalettes();
  }

  /* ------------------------------------------------------------ actions */

  get cur() { return this.riders[useUI.getState().sel]; }

  select(i: number) {
    const s = useUI.getState();
    if (i === s.sel || !this.riders[i]) return;
    this.reins(false);
    if (s.race.active) this.stopRace();
    useUI.setState({ sel: i });
    this.snap = true;
    toast(RIDERS[i].name, 'riding ' + this.riders[i].pal.name);
  }
  setCam(c: CamMode) { useUI.setState({ cam: c }); this.snap = true; this.shotT = 0; }
  reins(on: boolean) {
    const r = this.cur;
    if (!r) return;
    r.manual = on;
    if (on) { r.yaw = Math.atan2(r.fwd.x, r.fwd.z); r.pitch = Math.asin(clamp(r.fwd.y, -1, 1)); r.follow = null; r.cruiseOverride = null; }
    useUI.setState({ manual: on });
  }
  flyTo(i: number, fade?: () => Promise<void>) {
    const go = () => {
      const r = this.cur;
      if (!r || !this.data) return;
      if (useUI.getState().race.active) this.stopRace();
      r.follow = null; r.cruiseOverride = null;
      r.spawn(this.flight, i);
      r.nextTarget(this.flight);
      this.snap = true;
      toast(this.data.places[i].name, this.data.places[i].sub);
    };
    if (fade) void fade().then(go); else go();
  }
  startRace(fade?: () => Promise<void>) {
    const go = () => {
      const r = this.cur, race = this.race;
      if (!r || !race || !race.total) return;
      const r0 = race.rings[0];
      r.placeAt(r0.p.clone().addScaledVector(r0.n, -140).add(new V3(0, 6, 0)), r0.n);
      r.follow = () => race.aim();
      race.begin();
      this.snap = true;
      useUI.setState(s => ({ race: { ...s.race, active: true, next: 0, time: 0, last: null } }));
      toast('Skyveil Run', `${race.total} rings through the Hanging Peaks`);
    };
    if (fade) void fade().then(go); else go();
  }
  stopRace() {
    this.race?.stop();
    const r = this.cur; if (r) r.follow = null;
    useUI.setState(s => ({ race: { ...s.race, active: false } }));
  }
  findFlock() {
    const r = this.cur; if (!r) return;
    this.reins(false);
    r.follow = () => {
      const { mount } = this.wilds.nearest(r.pos);
      if (!mount) return null;
      const side = new V3().crossVectors(mount.fwd, UPV).normalize();
      return mount.pos.clone().addScaledVector(mount.fwd, -12).addScaledVector(side, 14);
    };
    toast('Seeking a wild flock', 'hold B or the Bond button when you are close');
  }
  findSeed() {
    const r = this.cur; if (!r || !this.seeds) return;
    this.reins(false);
    const seeds = this.seeds;
    r.follow = () => seeds.nearestOpen(r.pos)?.p ?? null;
    toast('Seeking drift seeds', 'your rider will fly through the nearest ones');
  }
  stopFollow() { const r = this.cur; if (r) { r.follow = null; r.cruiseOverride = null; } }
  async share() {
    const s = useUI.getState();
    const url = `${location.origin}${location.pathname}?seed=${s.seed}&rider=${s.sel + 1}&sky=${s.cycle ? 'cycle' : s.sky}&weather=${s.weather}`;
    try { await navigator.clipboard.writeText(url); toast('Link copied', 'anyone opening it gets this exact world'); }
    catch { toast('Copy this link', url); }
    return url;
  }
  savePhoto() { this.captureNext = true; }
  toggleSound() {
    const on = this.sound.toggle(!useUI.getState().sound);
    useUI.setState({ sound: on });
  }

  private bond() {
    const r = this.cur, { mount } = this.wilds.nearest(r.pos);
    if (!mount) return;
    const old = r.pal, gained = mount.pal;
    r.setPalette(gained);
    this.wilds.release(mount, old);
    const bonded = store.get<MountPalette[]>('bonded', []);
    if (!bonded.some(b => b.id === gained.id) && !RIDERS.some(x => x.pal.id === gained.id)) { bonded.push(gained); store.set('bonded', bonded); }
    const saved = store.get<Record<number, string>>('rider-pal', {}); saved[r.i] = gained.id; store.set('rider-pal', saved);
    r.follow = null; r.cruiseOverride = null;
    this.syncPalettes();
    this.sound.chime(7);
    toast(`Bonded with ${gained.name}`, `${old.name} returns to the wild`);
  }

  /* ------------------------------------------------------------ input */

  private bindInput(el: HTMLCanvasElement) {
    el.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }; el.setPointerCapture(e.pointerId); el.classList.add('drag'); });
    el.addEventListener('pointermove', e => {
      if (!this.drag) { el.classList.toggle('hover', this.pick(e) >= 0); return; }
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY; this.lastDrag = performance.now();
      if (this.cur?.manual) { this.steer.x = clamp((e.clientX - this.drag.sx) / 110, -1, 1); this.steer.y = clamp(-(e.clientY - this.drag.sy) / 110, -1, 1); return; }
      if (useUI.getState().cam === 'orbit') { this.orbitYaw -= dx * 0.006; this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, -0.4, 1.3); }
      else { this.lookYaw -= dx * 0.005; this.lookPitch = clamp(this.lookPitch - dy * 0.004, -0.8, 0.8); }
    });
    const up = (e: PointerEvent) => {
      el.classList.remove('drag');
      this.steer.x = this.steer.y = 0;
      if (this.drag && Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) < 6) { const i = this.pick(e); if (i >= 0) this.select(i); }
      this.drag = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => {
      this.orbitDist = clamp(this.orbitDist * (1 + e.deltaY * 0.001), 12, 160);
      this.chaseDist = clamp(this.chaseDist * (1 + e.deltaY * 0.001), 10, 80);
    }, { passive: true });
  }

  pick(e: { clientX: number; clientY: number }) {
    const rect = this.gl.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    let best = -1, bd = Infinity;
    this.riders.forEach((r, i) => {
      const t = r.pos.clone().sub(ray.ray.origin).dot(ray.ray.direction);
      if (t < 0) return;
      const d = ray.ray.distanceToPoint(r.pos);
      if (d < Math.max(9, t * 0.025) && t < bd) { bd = t; best = i; }
    });
    return best;
  }

  private input(): FlightInput {
    const k = this.keys;
    return {
      x: (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + this.steer.x,
      y: (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) + this.steer.y,
      boost: !!(k.ShiftLeft || k.ShiftRight || k.Space),
    };
  }

  /* ------------------------------------------------------------ frame */

  update(dt: number) {
    if (!this.data || !this.terrain) return;
    const s = useUI.getState();
    const T = this.terrain;
    const t = (U.uTime.value += dt);

    // time of day + weather
    let target = s.sky;
    if (s.cycle) { this.cycleP = (this.cycleP + dt / 240) % 1; target = 1 - Math.abs(Math.cos(this.cycleP * Math.PI)); }
    this.tod = s.cycle ? target : lerp(this.tod, target, 1 - Math.exp(-dt * 1.4));
    const p = palette(this.tod, s.weather, dt);
    if (s.weather === 'storm') {
      this.boltT -= dt;
      if (this.boltT < 0) { this.flash = 1; this.boltT = 4 + Math.random() * 9; this.sound.thunder(0.4 + Math.random() * 1.8); }
    }
    this.flash *= Math.exp(-dt * 5);
    const fl = this.flash * (0.6 + 0.4 * Math.sin(t * 60));
    const sunDir = new V3(Math.cos(p.el) * Math.sin(p.az), Math.sin(p.el), Math.cos(p.el) * Math.cos(p.az)).normalize();
    const su = this.skyMat.uniforms;
    su.uZen.value.copy(p.zen); su.uHor.value.copy(p.hor); su.uSunDir.value.copy(sunDir); su.uSunC.value.copy(p.sunC);
    su.uCloud.value.copy(p.cloud); su.uStars.value = p.stars; su.uNight.value = sm((this.tod - 0.5) * 2); su.uCover.value = p.cover; su.uFlash.value = fl;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(p.fog); fog.density = p.fd;
    this.sun.color.copy(p.sunC); this.sun.intensity = p.sunI;
    this.hemi.color.copy(p.hs); this.hemi.groundColor.copy(p.hg); this.hemi.intensity = p.hi + fl * 3;
    this.gl.toneMappingExposure = p.exp + fl * 0.3;
    U.uNight.value = p.glow;
    U.uWind.value = p.wind;

    // riders
    const inp = this.input();
    const flight = this.flight;
    this.riders.forEach((r, i) => {
      if (r.follow && r === this.cur && !s.race.active) {
        const f = r.follow();
        r.cruiseOverride = f && f.distanceTo(r.pos) < 40 ? 25 : null;
      }
      r.update(dt, i === s.sel ? inp : undefined, flight);
      U.uRip.value[i].set(r.pos.x, T.surface(r.pos.x, r.pos.z), r.pos.z, r.low);
    });
    const r = this.cur;
    this.wilds.update(dt, T, this.data.obstacles);
    this.birds?.update(t);

    // drift seeds
    if (this.seeds) {
      const hit = this.seeds.update(r.pos);
      if (hit >= 0) {
        store.set(`seeds-${this.data.seed}`, [...this.seeds.got]);
        const total = store.get<number>('seed-total', 0) + 1;
        store.set('seed-total', total);
        this.sound.chime(this.seeds.got.size % 5);
        const unlock = SEED_PALETTES.find(x => x.at === total);
        if (unlock) { toast(`${unlock.pal.name} unlocked`, 'a new mount colourway is in the roster'); this.syncPalettes(); }
        else toast('Drift seed', `${this.seeds.got.size} of ${this.seeds.pos.length} in this world`);
      }
    }

    // ring race
    if (this.race?.active) {
      const res = this.race.update(r.pos);
      if (res === 'ring') this.sound.chime(this.race.next);
      if (res === 'done') {
        const time = this.race.elapsed, best = store.get<number | null>(`best-${this.data.seed}`, null);
        const nb = best == null || time < best;
        if (nb) store.set(`best-${this.data.seed}`, time);
        r.follow = null;
        this.sound.chime(12);
        toast(nb ? 'New best time' : 'Run complete', `${time.toFixed(2)} s`);
        useUI.setState(st => ({ race: { ...st.race, active: false, last: time, best: nb ? time : best } }));
      }
    }

    // bonding with wild mounts
    const near = this.wilds.nearest(r.pos);
    if (this.bondHold && near.dist < 40) this.bondT += dt; else this.bondT = Math.max(0, this.bondT - dt * 2);
    if (this.bondT >= 2.5) { this.bondT = 0; this.bondHold = false; this.bond(); }

    this.updateCamera(dt, s.cam, s.photo);
    this.sun.position.copy(this.camera.position).addScaledVector(sunDir, 1000);
    this.sun.target.position.copy(this.camera.position);
    this.sky.position.copy(this.camera.position);

    // particles + rain respond to hour and weather
    const scale = this.gl.getDrawingBufferSize(new THREE.Vector2()).y * 0.5;
    if (this.pts.ff) { this.pts.ff.uniforms.uInt.value = 0.15 + p.glow * 1.3 * (1 - p.rain * 0.6); this.pts.ff.uniforms.uScale.value = scale; }
    if (this.pts.halo) { this.pts.halo.uniforms.uInt.value = Math.pow(p.glow, 1.4) * 0.55; this.pts.halo.uniforms.uScale.value = scale; }
    if (this.pts.mist) {
      const m = this.pts.mist.uniforms;
      m.uTint.value.copy(p.fog).lerp(p.hor, 0.3); m.uOp.value = 0.22 + p.glow * 0.06 + p.cover * 0.12; m.uScale.value = scale;
    }
    const rm = this.rain.material as THREE.ShaderMaterial;
    rm.uniforms.uRain.value = p.rain; rm.uniforms.uCam.value.copy(this.camera.position);
    rm.uniforms.uColor.value.copy(p.fog).lerp(new THREE.Color(1, 1, 1), 0.5);
    this.rain.visible = p.rain > 0.01;
    this.waterMat.uniforms.uRain.value = p.rain;

    // distance culling on top of frustum culling
    const fast = s.gfx === 'fast';
    for (const c of this.chunks) {
      const d = c.userData.c.distanceTo(this.camera.position) - c.userData.r;
      c.visible = d < c.userData.max * (fast ? 0.7 : 1) && !(c.userData.grass && fast);
    }

    this.updateLabels(s.sel, s.cam);

    this.sound.frame(r.speed, p.rain);
    if (this.sound.on) {
      if (r.flapped && s.cam !== 'cinema' && !s.photo) this.sound.whoosh(r.amp);
      this.chirpT -= dt;
      if (this.chirpT < 0) { this.chirpT = 0.3 + Math.random() * (3 - p.glow * 2.2); if ((r.low > 0.2 || p.glow > 0.4) && p.rain < 0.5) this.sound.chirp(); }
    }

    this.syncHud(dt, near.mount?.pal ?? null, near.dist);
    this.adaptDpr(dt, s.gfx);
  }

  render() {
    this.gl.render(this.scene, this.camera);
    if (this.captureNext) {
      this.captureNext = false;
      this.gl.domElement.toBlob(b => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `aeloria-${useUI.getState().seed}-${Date.now()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('Photo saved', 'check your downloads');
      }, 'image/png');
    }
  }

  private syncHud(dt: number, wildPal: MountPalette | null, wildDist: number) {
    this.hudT -= dt;
    if (this.hudT > 0 || !this.data || !this.terrain) return;
    this.hudT = 0.2;
    const r = this.cur, places = this.data.places;
    const dists = places.map(pl => Math.hypot(pl.c[0] - r.pos.x, pl.c[2] - r.pos.z));
    let near = 0;
    dists.forEach((d, i) => { if (d < dists[near]) near = i; });
    const seedNear = this.seeds?.nearestOpen(r.pos);
    useUI.setState(s => ({
      hud: {
        alt: Math.round(r.pos.y - this.terrain!.surface(r.pos.x, r.pos.z)),
        spd: Math.round(r.speed * 3.6),
        where: dists[near] < 520 ? places[near].name : 'Open sky',
        dists, near, fps: s.hud.fps, tris: this.gl.info.render.triangles,
      },
      race: this.race?.active ? { ...s.race, next: this.race.next, time: this.race.elapsed } : s.race,
      bond: { name: wildPal?.name ?? null, dist: wildDist, progress: this.bondT / 2.5, swatch: wildPal ? swatch(wildPal) : null },
      seeds: { got: this.seeds?.got.size ?? 0, total: this.seeds?.pos.length ?? 0, nearest: seedNear ? Math.round(seedNear.d) : null },
    }));
  }

  private adaptDpr(dt: number, gfx: string) {
    const f = this.fps;
    f.acc += dt; f.n++; f.t += dt;
    if (f.t < 2) return;
    const fps = f.n / f.acc;
    f.t = f.acc = f.n = 0;
    useUI.setState(s => ({ hud: { ...s.hud, fps: Math.round(fps) } }));
    const cap = gfx === 'high' ? Math.min(devicePixelRatio, 2) : gfx === 'fast' ? Math.min(devicePixelRatio, 1) * 0.75 : this.maxDpr;
    if (gfx !== 'auto') { this.dpr = cap; return; }
    if (fps < 32 && this.dpr > 0.55) this.dpr = Math.max(0.55, this.dpr - 0.15);
    else if (fps > 55 && this.dpr < cap) this.dpr = Math.min(cap, this.dpr + 0.1);
  }

  private updateLabels(sel: number, cam: CamMode) {
    const w = this.gl.domElement.clientWidth, h = this.gl.domElement.clientHeight, v = new V3();
    this.riders.forEach((r, i) => {
      const el = this.labels[i];
      if (!el) return;
      v.copy(r.pos).add(new V3(0, 6, 0)).project(this.camera);
      const dist = r.pos.distanceTo(this.camera.position);
      const show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && dist < 1600 && !(i === sel && cam === 'seat');
      el.style.display = show ? 'flex' : 'none';
      if (show) el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px,${(-v.y * 0.5 + 0.5) * h - 14}px) translate(-50%,-100%)`;
    });
  }

  /* ------------------------------------------------------------ camera */

  /** Pull the camera toward the rider when rock sits between them. */
  private unocclude(from: THREE.Vector3, to: THREE.Vector3) {
    const obs = this.data!.obstacles, p = new V3();
    let tMax = 1;
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      p.lerpVectors(from, to, t);
      const hit = obs.some(o => o.t === 's'
        ? Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z) < o.r * 0.9
        : p.y < o.top && Math.hypot(p.x - o.x, p.z - o.z) < o.r * 0.85);
      if (hit) { tMax = Math.max(0.12, (i - 1) / 10); break; }
    }
    if (tMax < 1) to.lerpVectors(from, to, tMax);
  }

  private updateCamera(dt: number, mode: CamMode, photo: boolean) {
    const r = this.cur, cam = this.camera, T = this.terrain!;
    if (!r) return;
    const right = new V3().crossVectors(r.fwd, UPV).normalize();
    const idle = performance.now() - this.lastDrag > 2500;
    if (idle && !this.drag) { this.lookYaw *= 1 - dt * 1.2; this.lookPitch *= 1 - dt * 1.2; }
    if (photo) mode = 'cinema';
    let fov = 62, k = 3;
    const pos = new V3(), look = new V3();
    if (mode === 'chase') {
      const back = r.fwd.clone().applyAxisAngle(UPV, this.lookYaw);
      pos.copy(r.pos).addScaledVector(back, -this.chaseDist).add(new V3(0, this.chaseDist * 0.32 + this.lookPitch * 20, 0));
      look.copy(r.pos).addScaledVector(r.fwd, 10).add(new V3(0, 2, 0));
      k = 3.2;
    } else if (mode === 'seat') {
      r.root.updateMatrixWorld(true);
      r.head.getWorldPosition(pos);
      cam.position.copy(pos);
      cam.quaternion.copy(r.root.quaternion).multiply(this.qFlip);
      cam.rotateY(this.lookYaw);
      cam.rotateX(-0.1 + this.lookPitch);
      cam.fov = lerp(cam.fov, 72, 0.1); cam.updateProjectionMatrix();
      this.camPos.copy(pos); this.camLook.copy(pos).addScaledVector(r.fwd, 10);
      this.snap = false;
      return;
    } else if (mode === 'orbit') {
      if (idle && !this.drag) this.orbitYaw += dt * 0.12;
      const yaw = Math.atan2(r.fwd.x, r.fwd.z) + Math.PI + this.orbitYaw;
      pos.set(Math.sin(yaw) * Math.cos(this.orbitPitch), Math.sin(this.orbitPitch), Math.cos(yaw) * Math.cos(this.orbitPitch)).multiplyScalar(this.orbitDist).add(r.pos);
      look.copy(r.pos); k = 6;
    } else {
      const slow = photo ? 1.6 : 1;
      this.shotT -= dt;
      if (this.shotT <= 0) {
        this.shot = (this.shot + 1) % 4;
        this.shotT = (7 + Math.random() * 3) * slow;
        if (this.shot === 1) this.shotPos.copy(r.pos).addScaledVector(r.fwd, r.speed * 4.5).addScaledVector(right, (Math.random() < 0.5 ? -1 : 1) * 30).add(new V3(0, -6, 0));
        if (this.shot === 2) this.shotPos.copy(r.pos).addScaledVector(r.fwd, -60).addScaledVector(right, -80).add(new V3(0, 60, 0));
        this.snap = true;
      }
      if (this.shot === 0) { pos.copy(r.pos).addScaledVector(right, 26).addScaledVector(r.fwd, -4).add(new V3(0, 3, 0)); look.copy(r.pos); fov = 40; k = 4; }
      else if (this.shot === 1) { pos.copy(this.shotPos); look.copy(r.pos); fov = lerp(48, 30, clamp(1 - r.pos.distanceTo(this.shotPos) / 200, 0, 1)); k = 50; }
      else if (this.shot === 2) { this.shotPos.addScaledVector(r.fwd, r.speed * 0.85 * dt); pos.copy(this.shotPos); look.copy(r.pos); fov = 34; k = 50; }
      else { pos.copy(r.pos).addScaledVector(r.fwd, 15).add(new V3(0, 3.5, 0)).addScaledVector(right, 4); look.copy(r.pos).add(new V3(0, 1.5, 0)); fov = 55; k = 5; }
    }
    if (mode !== 'cinema' || this.shot === 0 || this.shot === 3) this.unocclude(r.pos, pos);
    const minY = T.surface(pos.x, pos.z) + 2.5;
    if (pos.y < minY) pos.y = minY;
    const a = this.snap ? 1 : 1 - Math.exp(-dt * k);
    this.camPos.lerp(pos, a);
    this.camLook.lerp(look, this.snap ? 1 : 1 - Math.exp(-dt * 8));
    this.snap = false;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    cam.fov = lerp(cam.fov, fov, 0.06);
    cam.updateProjectionMatrix();
  }
}

export const engine = new Engine();
