import * as THREE from 'three';
import { TAU, clamp, lerp, makeNoise, sm } from '../world/noise';
import { INNER, Terrain, WL } from '../world/terrain';
import { toBufferGeometry } from '../world/geometry';
import { MAP_SIZE, type MatKey, type PointsData, type Quality, type WorldData } from '../world/generate';
import { U, bioMat, makeFallMaterial, makePointsMaterial, makeRain, makeSkyMaterial, makeWaterMaterial } from './materials';
import { palette } from './palette';
import { RIDERS, SEED_PALETTES, swatch, type MountPalette } from './creatures';
import { NO_CONTROLS, Rider, type FlightWorld, type Solids } from './rider';
import { Wilds } from './wild';
import { Leviathan } from './leviathan';
import { Race, Seeds } from './collectibles';
import { Sound } from './audio';
import { Input } from './input';
import { CameraRig } from './camera';
import { Post } from './post';
import { makeGrassField } from './grass';
import { makeLeafAtlas } from './leaves';
import { Splash, Trails, makeSpeedLines } from './effects';
import { store, toast, useUI, type CamMode, type Gfx } from '../state/store';

const V3 = THREE.Vector3;
const UPV = new V3(0, 1, 0);
const CAMS: CamMode[] = ['chase', 'seat', 'drone', 'orbit', 'cinema'];

const fmtKm = (d: number) => (d < 1000 ? `${Math.max(0, Math.round(d / 10) * 10)} m` : `${(d / 1000).toFixed(1)} km`);

export function detectQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) || (nav.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  if (mobile) return 'low';
  if ((nav.hardwareConcurrency || 4) >= 8 && (nav.deviceMemory ?? 8) >= 8) return 'high';
  return 'medium';
}
export const defaultGfx = (q: Quality): Gfx => (q === 'low' ? 'fast' : q === 'medium' ? 'balanced' : 'high');

/** Small ambient birds circling the regions; cheap instanced silhouettes. */
class Birds {
  B: THREE.InstancedMesh; L: THREE.InstancedMesh; R: THREE.InstancedMesh;
  birds: { c: THREE.Vector3; rad: number; ph: number; sp: number; dy: number; fl: number; dir: number }[] = [];
  private m = new THREE.Matrix4(); private w = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new V3(); private f = new V3();
  private bank = new THREE.Quaternion(); private one = new V3(1, 1, 1); private mirror = new THREE.Matrix4().makeScale(-1, 1, 1); private rz = new THREE.Matrix4();
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
      this.rz.makeRotationZ(Math.sin(t * 5 + b.fl) * 0.6);
      this.R.setMatrixAt(i, this.w.copy(this.m).multiply(this.rz));
      this.L.setMatrixAt(i, this.w.copy(this.m).multiply(this.mirror).multiply(this.rz));
    });
    this.B.instanceMatrix.needsUpdate = this.L.instanceMatrix.needsUpdate = this.R.instanceMatrix.needsUpdate = true;
  }
}

export class Engine {
  gl!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  ready = false;
  quality: Quality = 'medium';

  data: WorldData | null = null;
  terrain: Terrain | null = null;
  world: THREE.Group | null = null;
  chunks: THREE.InstancedMesh[] = [];
  pts: { ff?: THREE.ShaderMaterial; halo?: THREE.ShaderMaterial; mist?: THREE.ShaderMaterial } = {};
  riders: Rider[] = [];
  wilds!: Wilds;
  leviathan = new Leviathan();
  /** the autopilot target used while riding alongside the Leviathan */
  private levFollow: (() => THREE.Vector3 | null) | null = null;
  /** where the escorting rider should sit: beside the whale's front flank */
  private levEscort: (() => THREE.Vector3) | null = null;
  private inWake = false;
  private heardSong = false;
  seeds: Seeds | null = null;
  race: Race | null = null;
  birds: Birds | null = null;
  sound = new Sound();
  input = new Input();
  rig = new CameraRig((a, b) => this.unocclude(a, b));
  solids: Solids | null = null;
  pin: THREE.Vector3 | null = null;

  private skyMat = makeSkyMaterial();
  private sky = new THREE.Mesh(new THREE.SphereGeometry(4600, 48, 24), this.skyMat);
  private waterMat = makeWaterMaterial(this.skyMat);
  private water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), this.waterMat);
  private fallMat = makeFallMaterial();
  private rain = makeRain(5000);
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
  private mats!: Record<MatKey, THREE.Material>;
  private birdMat = bioMat({ roughness: 0.7, side: THREE.DoubleSide }, { base: 0.4, k: 1.2 });
  private post: Post | null = null;
  private grass: ReturnType<typeof makeGrassField> | null = null;
  private trails = new Trails();
  private speedLines = makeSpeedLines();
  private splash = new Splash();
  private fieldTex: THREE.DataTexture | null = null;
  private mapCanvas: HTMLCanvasElement | null = null;
  private gfx: Gfx | null = null;

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
  private dprHold = 0;
  private chirpT = 0;
  private sprayT = 0;
  private captureNext = false;
  private worker: Worker | null = null;
  private reqId = 0;
  private sunDir = new V3(0, 1, 0);
  private lastImpact = 0;
  private lastTrick = 0;
  private pausedAt = 0;
  lockLostAt = -1e9;
  private stallT = 0;

  // pointer
  private drag: { x: number; y: number; sx: number; sy: number } | null = null;
  private lastDrag = 0;
  labels: HTMLElement[] = [];
  minimap: HTMLCanvasElement | null = null;
  compass: HTMLCanvasElement | null = null;
  private miniT = 0;

  attach(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: Quality) {
    if (this.ready) return;
    this.gl = gl; this.scene = scene; this.camera = camera; this.quality = quality;
    camera.near = 0.3; camera.far = 9500; camera.fov = 60; camera.updateProjectionMatrix();
    scene.fog = new THREE.FogExp2(0x000000, 0.0005);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.water.position.y = WL;
    this.water.receiveShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(2048, 2048);
    Object.assign(sh.camera, { left: -230, right: 230, top: 230, bottom: -230, near: 1, far: 3200 });
    sh.bias = -0.0004; sh.normalBias = 0.8;
    scene.add(this.sky, this.water, this.sun, this.sun.target, this.hemi, this.rain, this.trails.mesh, this.speedLines, this.splash.points, this.leviathan.group);

    const bump = quality === 'low' ? 0 : 1;
    const leaves = makeLeafAtlas(Math.min(8, gl.capabilities.getMaxAnisotropy()));
    this.mats = {
      terrain: bioMat({ roughness: 0.95 }, { ripple: true, k: 1.5, detail: 0.07, bump: 0.55 * bump, bumpF: 0.18 }),
      outer: bioMat({ roughness: 1 }),
      rock: bioMat({ roughness: 0.92 }, { k: 0.75, speck: 0.36, detail: 0.05, bump: 0.9 * bump, bumpF: 0.22 }),
      elder: bioMat({ roughness: 0.9, side: THREE.DoubleSide, map: leaves, alphaTest: 0.5 }, { k: 1.5, speck: 0.4, detail: 0.06, leaf: true }),
      tree: bioMat({ roughness: 0.85, side: THREE.DoubleSide, map: leaves, alphaTest: 0.5 }, { k: 1.5, sway: 0.6, swayH: 50, speck: 0.6, detail: 0.2, leaf: true }),
      flora: bioMat({ roughness: 0.7, side: THREE.DoubleSide }, { k: 1.8, ripple: true, sway: 0.12, swayH: 2.5 }),
      grass: bioMat({ roughness: 0.9, side: THREE.DoubleSide }, { k: 1.2, ripple: true, sway: 0.35, swayH: 1.6 }),
      vine: bioMat({ roughness: 0.9 }, { k: 1.5, sway: 1.2, swayH: 1, hang: true }),
      tendril: bioMat({ roughness: 0.6 }, { base: 0.15, k: 1.4, sway: 2.2, swayH: 1, hang: true }),
    };
    this.wilds = new Wilds(scene);
    this.bindPointer(gl.domElement);
    this.armSound();
    // the browser frees the cursor on Esc; that Esc should only do that, a second one opens the menu
    this.input.onLockLost = () => { this.lockLostAt = performance.now(); };
    this.applyGfx(useUI.getState().gfx);
    this.ready = true;
  }

  /** Switch graphics preset: post-processing, MSAA, shadows, grass density and resolution cap. */
  applyGfx(g: Gfx) {
    if (g === this.gfx) return;
    this.gfx = g;
    const usePost = g !== 'fast';
    if (usePost && !this.post) this.post = new Post(this.gl, this.scene, this.camera, g === 'high' ? 4 : 2);
    if (this.post) this.post.msaa = g === 'high' ? 4 : 2;
    this.gl.toneMapping = usePost ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    const shadows = g === 'high';
    this.gl.shadowMap.enabled = shadows;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = shadows;
    this.scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (m) [m].flat().forEach(x => (x.needsUpdate = true)); });
    if (this.grass) { this.scene.remove(this.grass.mesh); this.grass.mesh.geometry.dispose(); (this.grass.mesh.material as THREE.Material).dispose(); this.grass = null; }
    const blades = g === 'fast' ? (this.quality === 'low' ? 14000 : 24000) : g === 'balanced' ? 60000 : 130000;
    this.grass = makeGrassField(blades, g === 'high' ? 150 : g === 'balanced' ? 120 : 80);
    this.scene.add(this.grass.mesh);
    this.maxDpr = g === 'high' ? Math.min(devicePixelRatio, 2) : g === 'balanced' ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 1) * 0.85;
    this.dpr = Math.min(this.dpr, this.maxDpr);
  }

  /* ------------------------------------------------------------ world lifecycle */

  grow(seed: number, quality: Quality) {
    useUI.setState({ loading: true, loadMsg: `Growing seed ${seed}…`, error: null });
    this.worker ??= new Worker(new URL('../world/worker.ts', import.meta.url), { type: 'module' });
    const id = ++this.reqId;
    return new Promise<void>(resolve => {
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
    this.fieldTex?.dispose();
  }

  private build(d: WorldData) {
    this.disposeWorld();
    this.data = d;
    const T = new Terrain(makeNoise(d.seed), d.regions, d.seg);
    T.heights = d.heights;
    this.terrain = T;
    const g = (this.world = new THREE.Group());
    this.scene.add(g);

    // ground field for GPU grass and water depth
    const W = d.seg + 1;
    const tex = new THREE.DataTexture(d.field, W, W, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.fieldTex = tex;
    U.uField.value = tex;
    U.uFieldInfo.value.set(INNER, W, INNER / d.seg, 0);

    // overview map image
    const mc = document.createElement('canvas');
    mc.width = mc.height = MAP_SIZE;
    mc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(d.map), MAP_SIZE, MAP_SIZE), 0, 0);
    this.mapCanvas = mc;

    const terrain = new THREE.Mesh(toBufferGeometry(d.terrain), this.mats.terrain);
    terrain.receiveShadow = true;
    g.add(terrain, new THREE.Mesh(toBufferGeometry(d.outer), this.mats.outer));
    const geos = d.geos.map(toBufferGeometry);
    for (const m of d.meshes) {
      const mesh = new THREE.Mesh(geos[m.geo], this.mats[m.mat]);
      mesh.position.set(...m.pos); mesh.rotation.y = m.rotY; mesh.scale.setScalar(m.scale);
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.castShadow = mesh.receiveShadow = true;
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
      im.castShadow = c.mat === 'tree' || c.mat === 'rock';
      im.receiveShadow = c.mat !== 'tendril';
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
    this.leviathan.build(d.seed, T, d.isles, d.elder);
    this.levFollow = null;

    const [ex, ey, ez] = d.elder;
    this.solids = {
      isles: d.isles,
      arches: d.arches.map(a => {
        const ax = new V3(...a.ax);
        return { base: new V3(...a.c).add(new V3(0, -a.R * 0.45, 0)), side: new V3(ax.z, 0, -ax.x), R: a.R, tube: a.tube };
      }),
      pillars: d.obstacles.filter(o => o.t === 'c' && Math.hypot(o.x - ex, o.z - ez) > 5).map(o => ({ x: o.x, z: o.z, r: (o.r / 1.4) * 1.08, top: o.top })),
      elder: { x: ex, y: ey, z: ez },
      movers: this.leviathan.spheres,
    };

    if (!this.riders.length) this.riders = RIDERS.map((r, i) => new Rider(r, i, this.scene));
    const saved = store.get<Record<number, string>>('rider-pal', {});
    const keepReins = useUI.getState().manual, sel = useUI.getState().sel;
    this.riders.forEach((r, i) => {
      r.manual = keepReins && i === sel; r.follow = null; r.cruiseOverride = null;
      const p = saved[i] && this.allPalettes().find(x => x.id === saved[i]);
      if (p && p.id !== r.pal.id) r.setPalette(p);
      r.spawn(this.flight, i % d.places.length);
    });
    if (keepReins) this.input.syncAim(this.riders[sel].yaw, this.riders[sel].pitch);
    this.pin = null;
    this.trails.reset();
    this.rig.snap = true;
    useUI.setState({
      seed: d.seed,
      places: d.places.map(p => ({ name: p.name, sub: p.sub })),
      stats: d.stats,
      race: { active: false, next: 0, total: d.rings.length, time: 0, best: store.get<number | null>(`best-${d.seed}`, null), last: null },
      seeds: { got: this.seeds.got.size, total: d.seeds.length, nearest: null },
    });
    this.syncPalettes();
  }

  get flight(): FlightWorld {
    return { terrain: this.terrain!, obstacles: this.data!.obstacles, places: this.data!.places, solids: this.solids!, assist: useUI.getState().assist };
  }

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
    this.trails.reset();
    const saved = store.get<Record<number, string>>('rider-pal', {}); saved[r.i] = id; store.set('rider-pal', saved);
    this.syncPalettes();
  }

  /* ------------------------------------------------------------ actions */

  get cur() { return this.riders[useUI.getState().sel]; }

  select(i: number) {
    const s = useUI.getState();
    if (i === s.sel || !this.riders[i]) return;
    if (s.race.active) this.stopRace();
    // flying yourself carries over to the new rider
    const old = this.riders[s.sel], next = this.riders[i];
    if (old) { old.manual = false; old.resetSmoothing(); }
    if (s.manual) {
      next.manual = true; next.follow = null; next.cruiseOverride = null;
      this.input.syncAim(next.yaw, next.pitch);
    }
    useUI.setState({ sel: i });
    this.rig.snap = true;
    this.trails.reset();
    toast(RIDERS[i].name, 'riding ' + this.riders[i].pal.name);
  }
  cycleCam(dir = 1) { const c = useUI.getState().cam; this.setCam(CAMS[(CAMS.indexOf(c) + dir + CAMS.length) % CAMS.length]); }
  setCam(c: CamMode) { useUI.setState({ cam: c }); this.rig.snap = true; }
  reins(on: boolean) {
    const r = this.cur;
    if (!r) return;
    r.manual = on;
    r.resetSmoothing();
    if (on) {
      r.follow = null; r.cruiseOverride = null; r.stamina = 1;
      this.input.syncAim(r.yaw, r.pitch);
      if (!useUI.getState().touch) this.input.requestLock(this.gl.domElement);
      if (useUI.getState().cam === 'cinema' || useUI.getState().cam === 'orbit') this.setCam('chase');
    } else this.input.releaseLock();
    if (r.manual !== useUI.getState().manual) this.sound.reins(on);
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
      this.rig.snap = true;
      this.trails.reset();
      toast(this.data.places[i].name, this.data.places[i].sub);
    };
    if (fade) void fade().then(go); else go();
  }
  /** Send the rider to any point on the map: fly there on autopilot, or jump straight there. */
  flyToPoint(x: number, z: number, jump: boolean, fade?: () => Promise<void>) {
    const r = this.cur, T = this.terrain;
    if (!r || !T) return;
    const p = new V3(x, T.surface(x, z) + 55, z);
    for (let k = 0; k < 14 && this.solidAt(p); k++) p.y += 20;
    this.pin = p;
    if (useUI.getState().race.active) this.stopRace();
    const go = () => {
      if (jump) {
        const from = new V3(r.pos.x - p.x, 0, r.pos.z - p.z);
        if (from.lengthSq() < 1) from.set(1, 0, 0);
        from.normalize();
        const start = p.clone().addScaledVector(from, 220);
        start.y = Math.max(p.y + 30, T.surface(start.x, start.z) + 50);
        r.placeAt(start, p.clone().sub(start));
        this.rig.snap = true;
        this.trails.reset();
      }
      if (!r.manual) r.follow = () => {
        if (!this.pin) return null;
        if (r.pos.distanceTo(this.pin) < 60) { this.pin = null; r.follow = null; toast('Arrived', 'autopilot resumes the tour'); return null; }
        return this.pin;
      };
    };
    if (jump && fade) void fade().then(go); else go();
    toast(jump ? 'Jumping' : 'Course set', `${Math.round(Math.hypot(x - r.pos.x, z - r.pos.z))} m away`);
  }
  clearPin() { this.pin = null; const r = this.cur; if (r && r.follow) r.follow = null; }
  startRace(fade?: () => Promise<void>) {
    const go = () => {
      const r = this.cur, race = this.race;
      if (!r || !race || !race.total) return;
      const r0 = race.rings[0];
      r.placeAt(r0.p.clone().addScaledVector(r0.n, -140).add(new V3(0, 6, 0)), r0.n);
      r.speed = 34;
      r.stamina = 1;
      if (!r.manual) r.follow = () => race.aim();
      race.begin();
      this.rig.snap = true;
      this.trails.reset();
      useUI.setState(s => ({ race: { ...s.race, active: true, next: 0, time: 0, last: null } }));
      this.sound.horn();
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
    if (r.manual) {
      const { mount } = this.wilds.nearest(r.pos);
      if (!mount) return;
      this.pin = mount.pos.clone();
      toast('Wild flock marked', 'follow the pin on your compass, hold B when you are close');
      return;
    }
    r.follow = () => {
      const { mount } = this.wilds.nearest(r.pos);
      if (!mount) return null;
      const side = new V3().crossVectors(mount.fwd, UPV).normalize();
      return mount.pos.clone().addScaledVector(mount.fwd, -12).addScaledVector(side, 14);
    };
    toast('Seeking a wild flock', 'hold B or the Bond button when you are close');
  }
  /** Autopilot escorts the Leviathan; flying yourself, the compass marks it. */
  findLeviathan() {
    const r = this.cur; if (!r) return;
    const lv = this.leviathan, d = lv.nearest(r.pos).skin;
    if (r.manual) { toast('The Leviathan', `${fmtKm(d)} away · follow the violet marker on your compass`); return; }
    if (useUI.getState().race.active) this.stopRace();
    let side = 1;
    this.levEscort = () => {
      // ride above its back, a little off to whichever side we are already on, with the body stretching ahead in view
      const f = lv.frameAt(0.62);
      side = Math.sign(r.pos.clone().sub(f.c).dot(f.side)) || side;
      return f.c.clone().addScaledVector(f.up, f.r * 0.85 + 32).addScaledVector(f.side, side * 22);
    };
    // steer at a carrot ahead of the escort spot, so the rider settles in beside the whale instead of circling the spot
    this.levFollow = () => {
      const e = this.levEscort!(), d = e.distanceTo(r.pos);
      return d > 220 ? e : e.addScaledVector(lv.dir, 90);
    };
    r.follow = this.levFollow;
    toast(d > 150 ? 'Flying to the Leviathan' : 'Riding with the Leviathan', d > 150 ? `${fmtKm(d)} away` : 'its slipstream carries you');
  }
  findSeed() {
    const r = this.cur; if (!r || !this.seeds) return;
    const seeds = this.seeds;
    if (r.manual) {
      const s = seeds.nearestOpen(r.pos);
      if (!s) return;
      this.pin = s.p.clone();
      toast('Drift seed marked', 'follow the pin on your compass');
      return;
    }
    r.follow = () => seeds.nearestOpen(r.pos)?.p ?? null;
    toast('Seeking drift seeds', 'your rider will fly through the nearest ones');
  }
  async share() {
    const s = useUI.getState();
    const url = `${location.origin}${location.pathname}?seed=${s.seed}&rider=${s.sel + 1}&sky=${s.cycle ? 'cycle' : s.sky}&weather=${s.weather}`;
    try { await navigator.clipboard.writeText(url); toast('Link copied', 'anyone opening it gets this exact world'); }
    catch { toast('Copy this link', url); }
    return url;
  }
  savePhoto() { this.captureNext = true; this.sound.shutter(); }
  toggleSound() {
    const on = this.sound.toggle(!useUI.getState().sound);
    if (useUI.getState().paused) this.sound.suspend(true);
    useUI.setState({ sound: on });
    store.set('sound', on);
  }
  /** Freeze the world, free the mouse and silence it; on resume pick the reins back up where they were. */
  pause(on: boolean) {
    const s = useUI.getState();
    if (on === s.paused) return;
    if (on) {
      this.pausedAt = performance.now();
      this.input.keys = {}; this.bondHold = false;
      this.input.releaseLock();
    } else {
      this.race?.hold(performance.now() - this.pausedAt);
      if (s.manual && !s.touch) this.input.requestLock(this.gl.domElement);
    }
    this.sound.suspend(on);
    useUI.setState({ paused: on });
  }
  /** While paused only the gamepad's Start button is listened to, and it resumes. */
  pollPaused() {
    for (const ev of this.input.pollPad()) if (ev === 'reins') this.pause(false);
  }
  /** Sound is on by default, but browsers only allow audio after a user gesture, so start it on the first one. */
  private armSound() {
    if (!store.get('sound', true)) return;
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const;
    const start = (e: Event) => {
      evs.forEach(n => window.removeEventListener(n, start, true));
      // the gesture is the sound toggle itself: let it decide instead of fighting it
      if ((e as KeyboardEvent).code === 'KeyO' || (e.target as Element | null)?.closest?.('[data-sound]')) return;
      if (!useUI.getState().sound) useUI.setState({ sound: this.sound.toggle(true) });
      if (useUI.getState().paused) this.sound.suspend(true);
    };
    evs.forEach(e => window.addEventListener(e, start, true));
  }

  private bond() {
    const r = this.cur, { mount } = this.wilds.nearest(r.pos);
    if (!mount) return;
    const old = r.pal, gained = mount.pal;
    r.setPalette(gained);
    this.wilds.release(mount, old);
    this.trails.reset();
    const bonded = store.get<MountPalette[]>('bonded', []);
    if (!bonded.some(b => b.id === gained.id) && !RIDERS.some(x => x.pal.id === gained.id)) { bonded.push(gained); store.set('bonded', bonded); }
    const saved = store.get<Record<number, string>>('rider-pal', {}); saved[r.i] = gained.id; store.set('rider-pal', saved);
    r.follow = null; r.cruiseOverride = null;
    this.syncPalettes();
    this.sound.chime(7);
    this.sound.call();
    toast(`Bonded with ${gained.name}`, `${old.name} returns to the wild`);
  }

  /* ------------------------------------------------------------ pointer */

  private bindPointer(el: HTMLCanvasElement) {
    el.addEventListener('pointerdown', e => {
      if (this.cur?.manual && e.pointerType === 'mouse' && !this.input.locked && !this.input.lockFailed) { this.input.requestLock(el); return; }
      if (this.input.locked) return;
      this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
      el.setPointerCapture(e.pointerId);
      el.classList.add('drag');
    });
    el.addEventListener('pointermove', e => {
      if (this.input.locked) return;
      if (!this.drag) { el.classList.toggle('hover', this.pick(e) >= 0); return; }
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY; this.lastDrag = performance.now();
      if (this.cur?.manual && e.pointerType === 'mouse') {
        this.input.drag.x = clamp((e.clientX - this.drag.sx) / 110, -1, 1);
        this.input.drag.y = clamp(-(e.clientY - this.drag.sy) / 110, -1, 1);
        return;
      }
      this.rig.drag(dx, dy, useUI.getState().cam);
    });
    const up = (e: PointerEvent) => {
      el.classList.remove('drag');
      this.input.drag.x = this.input.drag.y = 0;
      if (this.drag && Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) < 6) { const i = this.pick(e); if (i >= 0) this.select(i); }
      this.drag = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => this.rig.zoom(e.deltaY), { passive: true });
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

  /** True when a point sits inside terrain or any obstacle's avoidance volume. */
  private solidAt(p: THREE.Vector3) {
    if (!this.data || !this.terrain) return false;
    if (p.y < this.terrain.surface(p.x, p.z) + 3) return true;
    return this.data.obstacles.some(ob => (ob.t === 's' ? Math.hypot(p.x - ob.x, p.y - ob.y, p.z - ob.z) < ob.r : p.y < ob.top && Math.hypot(p.x - ob.x, p.z - ob.z) < ob.r));
  }

  /** True if a camera at p would sit inside or right against rock (isle outlines padded for their bumps). */
  private camBlocked(p: THREE.Vector3) {
    const S = this.solids;
    if (!S) return false;
    for (const [x, y, z, R] of S.isles) {
      const h = Math.hypot(p.x - x, p.z - z);
      if (h > R * 1.35 + 4 || p.y > y + R * 0.45 + 4 || p.y < y - R * 2.2) continue;
      const t = Math.min(1, h / (R * 1.35));
      if (p.y < y + R * 0.4 * (1 - t * t) + 4 && p.y > y - R * 2.1 * Math.pow(1 - t, 0.8) - 2) return true;
    }
    for (const c of S.pillars) if (p.y < c.top + 4 && Math.hypot(p.x - c.x, p.z - c.z) < c.r * 1.35 + 3) return true;
    for (const [x, y, z, r] of S.movers) if (Math.hypot(p.x - x, p.y - y, p.z - z) < r * 1.2 + 4) return true;
    const e = S.elder, dx = p.x - e.x, dz = p.z - e.z;
    if ((dx * dx + dz * dz) / (128 * 128) + ((p.y - e.y - 162) ** 2) / (55 * 55) < 1) return true;
    return false;
  }

  /** Keep rock out of the shot: try the wanted spot, then higher, then closer to the rider. */
  private unocclude(from: THREE.Vector3, to: THREE.Vector3) {
    if (!this.data) return;
    const p = new V3();
    const clear = (target: THREE.Vector3) => {
      for (let i = 2; i <= 12; i++) { p.lerpVectors(from, target, i / 12); if (this.camBlocked(p)) return false; }
      return true;
    };
    if (clear(to)) return;
    const dist = from.distanceTo(to);
    const raised = to.clone().add(new V3(0, dist * 0.7, 0));
    if (clear(raised)) { to.copy(raised); return; }
    for (const t of [0.7, 0.5, 0.35]) {
      const c = new V3().lerpVectors(from, raised, t);
      if (clear(c)) { to.copy(c); return; }
    }
    to.lerpVectors(from, to, 0.35);
  }

  /* ------------------------------------------------------------ frame */

  update(dt: number) {
    if (!this.data || !this.terrain) return;
    const s = useUI.getState();
    if (s.gfx !== this.gfx) this.applyGfx(s.gfx);
    const T = this.terrain;
    const t = (U.uTime.value += dt);

    // gamepad
    for (const ev of this.input.pollPad()) {
      if (ev === 'reins') this.reins(!s.manual);
      if (ev === 'camera') this.cycleCam();
      if (ev === 'next') this.select((s.sel + 1) % this.riders.length);
      if (ev === 'prev') this.select((s.sel + this.riders.length - 1) % this.riders.length);
      if (ev === 'map') useUI.setState({ mapOpen: !s.mapOpen });
    }

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
    const sunDir = this.sunDir.set(Math.cos(p.el) * Math.sin(p.az), Math.sin(p.el), Math.cos(p.el) * Math.cos(p.az)).normalize();
    const su = this.skyMat.uniforms;
    su.uZen.value.copy(p.zen); su.uHor.value.copy(p.hor); su.uSunDir.value.copy(sunDir); su.uSunC.value.copy(p.sunC);
    su.uCloud.value.copy(p.cloud); su.uStars.value = p.stars; su.uNight.value = sm((this.tod - 0.5) * 2); su.uCover.value = p.cover; su.uFlash.value = fl;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(p.fog); fog.density = p.fd;
    U.uSunDir.value.copy(sunDir);
    U.uSunCol.value.copy(p.sunC).lerp(p.fog, 0.35);
    const mistK = s.weather === 'mist' ? 2.6 : s.weather === 'rain' ? 1.6 : s.weather === 'storm' ? 1.9 : 1;
    U.uFogH.value.set(WL + 6, 0.011, 0.0011 * mistK * (1 + p.glow * 0.3));
    U.uFogScatter.value = lerp(0.45, 0.9, 1 - Math.abs(this.tod - 0.5) * 2) * (1 - p.cover * 0.7);
    this.sun.color.copy(p.sunC); this.sun.intensity = p.sunI;
    this.hemi.color.copy(p.hs); this.hemi.groundColor.copy(p.hg); this.hemi.intensity = p.hi + fl * 3;
    this.gl.toneMappingExposure = p.exp + fl * 0.3;
    U.uNight.value = p.glow + this.leviathan.pulse * 0.55;
    U.uWind.value = p.wind;

    // the Leviathan moves first so riders collide with where it is this frame
    const lv = this.leviathan;
    lv.update(dt, t, p.glow, this.gl.getDrawingBufferSize(new THREE.Vector2()).y * 0.5);

    // riders
    const flight = this.flight;
    const sel = this.cur;
    const ctl = sel.manual ? this.input.controls(sel.yaw, sel.pitch) : NO_CONTROLS;
    this.riders.forEach((r, i) => {
      if (r.follow && r.follow === this.levFollow && !r.manual) {
        // match the whale's pace: hurry when the escort spot is far ahead, settle to its speed alongside
        const e = this.levEscort!(), ahead = e.clone().sub(r.pos).dot(lv.dir), far = e.distanceTo(r.pos);
        r.cruiseOverride = far > 220 ? 40 : clamp(lv.speed + ahead * 0.12, 19, 36);
      } else if (r.follow && r === sel && !s.race.active && !r.manual) {
        const f = r.follow();
        r.cruiseOverride = f && f.distanceTo(r.pos) < 40 ? 25 : null;
      } else if (!r.follow) r.cruiseOverride = null;
      r.update(dt, i === s.sel ? ctl : NO_CONTROLS, flight);
      U.uRip.value[i].set(r.pos.x, T.surface(r.pos.x, r.pos.z), r.pos.z, r.low);
    });
    this.wilds.update(dt, T, this.data.obstacles);
    this.birds?.update(t);

    // the Leviathan's song, and its slipstream: fly close alongside for a push and stamina
    const lvN = lv.nearest(sel.pos);
    if (lv.sang) {
      const near = clamp(1 - lvN.skin / 1600, 0, 1);
      this.sound.song(near);
      if (!this.heardSong || near > 0.5) toast('The Leviathan sings', near > 0.5 ? 'the whole world answers in light' : `${fmtKm(lvN.skin)} away · press L to ride with it`);
      this.heardSong = true;
    }
    const wake = lvN.skin > 0 && lvN.skin < 70 ? 1 - lvN.skin / 70 : 0, along = sel.fwd.dot(lvN.frame.t);
    // the push is for players; the autopilot is already matching the whale's pace
    if (wake > 0 && along > 0.3 && sel.manual) {
      sel.speed = Math.min(sel.speed + 7 * wake * along * dt, 60);
      sel.stamina = Math.min(1, sel.stamina + dt * 0.3 * wake);
    }
    const wakeNow = wake > 0.15 && along > 0.3;
    if (wakeNow && !this.inWake) toast("Leviathan's slipstream", sel.manual ? 'riding its wake restores stamina' : 'gliding alongside the Leviathan');
    this.inWake = wakeNow ? true : wake === 0 ? false : this.inWake;

    // impacts, spray, trails
    if (sel.impact > this.lastImpact + 0.15) this.sound.thump(sel.impact);
    this.lastImpact = sel.impact;
    const overWater = T.groundY(sel.pos.x, sel.pos.z) < WL && sel.pos.y - WL < 5;
    this.sprayT -= dt;
    if (overWater && sel.speed > 12) {
      this.splash.emit(new V3(sel.pos.x, WL + 0.3, sel.pos.z), sel.fwd, sel.speed, sel.pos.y - WL < 3 ? 6 : 2);
      if (this.sprayT < 0) { this.sound.spray(); this.sprayT = 0.4; }
    }
    this.splash.update(dt);
    this.trails.update(sel.mount.tips, sel.mount.body, new THREE.Color(sel.pal.glow), clamp((sel.speed - 26) / 40, 0, 1) * (s.cam === 'seat' ? 0.35 : 0.8));

    // flying yourself, nobody else clears the pin: drop it on arrival
    if (sel.manual && this.pin && sel.pos.distanceTo(this.pin) < 60) { this.pin = null; toast('Arrived', 'pin cleared'); }

    // drift seeds
    if (this.seeds) {
      const hit = this.seeds.update(sel.pos);
      if (hit >= 0) {
        store.set(`seeds-${this.data.seed}`, [...this.seeds.got]);
        const total = store.get<number>('seed-total', 0) + 1;
        store.set('seed-total', total);
        this.sound.chime(this.seeds.got.size % 5);
        if (sel.manual) sel.stamina = Math.min(1, sel.stamina + 0.35);
        const unlock = SEED_PALETTES.find(x => x.at === total);
        if (unlock) { toast(`${unlock.pal.name} unlocked`, 'a new mount colourway is in the roster'); this.syncPalettes(); }
        else toast('Drift seed', `${this.seeds.got.size} of ${this.seeds.pos.length} in this world · stamina restored`);
      }
    }

    // ring race
    if (this.race?.active) {
      const res = this.race.update(sel.pos);
      if (res === 'ring') { this.sound.chime(this.race.next); if (sel.manual) sel.stamina = Math.min(1, sel.stamina + 0.2); }
      if (res === 'done') {
        const time = this.race.elapsed, best = store.get<number | null>(`best-${this.data.seed}`, null);
        const nb = best == null || time < best;
        if (nb) store.set(`best-${this.data.seed}`, time);
        sel.follow = null;
        this.sound.chime(12);
        toast(nb ? 'New best time' : 'Run complete', `${time.toFixed(2)} s`);
        useUI.setState(st => ({ race: { ...st.race, active: false, last: time, best: nb ? time : best } }));
      }
    }

    // bonding with wild mounts
    const near = this.wilds.nearest(sel.pos);
    if (this.bondHold && near.dist < 40) this.bondT += dt; else this.bondT = Math.max(0, this.bondT - dt * 2);
    if (this.bondT >= 2.5) { this.bondT = 0; this.bondHold = false; this.bond(); }
    this.sound.bond(this.bondT / 2.5);

    // camera
    this.rig.update(dt, this.camera, sel, T, {
      mode: s.cam, photo: s.photo,
      aim: sel.manual && this.input.locked ? this.input.aimDir() : null,
      dragging: !!this.drag, idle: performance.now() - this.lastDrag > 2500,
    });
    const focus = sel.pos;
    this.sun.position.copy(focus).addScaledVector(sunDir, 1500);
    this.sun.target.position.copy(focus);
    this.sky.position.copy(this.camera.position);

    // particles, rain, grass, speed lines respond to hour, weather and motion
    const scale = this.gl.getDrawingBufferSize(new THREE.Vector2()).y * 0.5;
    if (this.pts.ff) { this.pts.ff.uniforms.uInt.value = 0.15 + p.glow * 1.3 * (1 - p.rain * 0.6); this.pts.ff.uniforms.uScale.value = scale; }
    if (this.pts.halo) { this.pts.halo.uniforms.uInt.value = Math.pow(p.glow, 1.4) * 0.55; this.pts.halo.uniforms.uScale.value = scale; }
    if (this.pts.mist) {
      const m = this.pts.mist.uniforms;
      m.uTint.value.copy(p.fog).lerp(p.hor, 0.3); m.uOp.value = 0.22 + p.glow * 0.06 + p.cover * 0.12; m.uScale.value = scale;
    }
    this.splash.material.uniforms.uScale.value = scale;
    const rm = this.rain.material as THREE.ShaderMaterial;
    rm.uniforms.uRain.value = p.rain; rm.uniforms.uCam.value.copy(this.camera.position);
    rm.uniforms.uColor.value.copy(p.fog).lerp(new THREE.Color(1, 1, 1), 0.5);
    this.rain.visible = p.rain > 0.01;
    this.waterMat.uniforms.uRain.value = p.rain;
    if (this.grass) {
      this.grass.uCam.value.copy(this.camera.position);
      this.grass.mesh.visible = this.camera.position.y - T.surface(this.camera.position.x, this.camera.position.z) < 170;
    }
    const sl = this.speedLines.material as THREE.ShaderMaterial;
    const lineCam = s.cam === 'chase' || s.cam === 'seat';
    sl.uniforms.uAmt.value = lerp(sl.uniforms.uAmt.value, lineCam && !s.photo ? clamp((sel.speed - 34) / 40, 0, 1) : 0, 1 - Math.exp(-dt * 4));
    sl.uniforms.uSpeed.value = sel.speed;
    sl.uniforms.uColor.value.setRGB(1, 1, 1).lerp(new THREE.Color(0.5, 1, 0.9), p.glow * 0.6);

    // distance culling on top of frustum culling
    const fast = s.gfx === 'fast';
    for (const c of this.chunks) {
      const d = c.userData.c.distanceTo(this.camera.position) - c.userData.r;
      c.visible = d < c.userData.max * (fast ? 0.7 : 1) && !(c.userData.grass && fast);
    }

    if (this.post && this.gfx !== 'fast') {
      this.post.bloom.luminanceMaterial.threshold = lerp(1.15, 0.55, p.glow);
      this.post.bloom.intensity = 0.5 + p.glow * 0.9 + fl * 0.8;
      this.post.grade.exposure = p.exp + fl * 0.35;
      this.post.grade.saturation = 1.06 + p.glow * 0.08;
      this.post.focus(s.photo, sel.pos.distanceTo(this.camera.position));
    }

    this.updateLabels(s.sel, s.cam);
    this.miniT -= dt;
    if (this.miniT < 0) { this.miniT = 1 / 30; this.drawMinimap(); this.drawCompass(); }

    this.sound.frame(sel.speed, p.rain, sel.tuck);
    if (this.sound.on) {
      if (sel.flapped && s.cam !== 'cinema' && !s.photo) this.sound.whoosh(sel.amp);
      if (sel.trickRoll !== 0 && this.lastTrick === 0) this.sound.roll(Math.sign(sel.trickRoll));
      this.stallT -= dt;
      if (sel.manual && sel.speed < 14.5 && this.stallT < 0) { this.sound.stall(); this.stallT = 1.2; }
      this.chirpT -= dt;
      if (this.chirpT < 0) { this.chirpT = 0.3 + Math.random() * (3 - p.glow * 2.2); if ((sel.low > 0.2 || p.glow > 0.4) && p.rain < 0.5) this.sound.chirp(); }
    }

    this.lastTrick = sel.trickRoll;
    this.syncHud(dt, near.mount?.pal ?? null, near.dist);
    this.adaptDpr(dt);
  }

  render(dt: number) {
    if (this.post && this.gfx !== 'fast') this.post.render(dt);
    else this.gl.render(this.scene, this.camera);
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
    this.hudT = 0.15;
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
        stamina: r.stamina, locked: this.input.locked, pad: this.input.padActive,
        pin: this.pin ? Math.round(Math.hypot(this.pin.x - r.pos.x, this.pin.z - r.pos.z)) : null,
        pitch: r.pitch,
      },
      race: this.race?.active ? { ...s.race, next: this.race.next, time: this.race.elapsed } : s.race,
      bond: { name: wildPal?.name ?? null, dist: wildDist, progress: this.bondT / 2.5, swatch: wildPal ? swatch(wildPal) : null },
      seeds: { got: this.seeds?.got.size ?? 0, total: this.seeds?.pos.length ?? 0, nearest: seedNear ? Math.round(seedNear.d) : null },
    }));
  }

  private adaptDpr(dt: number) {
    const f = this.fps;
    f.acc += dt; f.n++; f.t += dt;
    this.dprHold -= dt;
    if (f.t < 2) return;
    const fps = f.n / f.acc;
    f.t = f.acc = f.n = 0;
    useUI.setState(s => ({ hud: { ...s.hud, fps: Math.round(fps) } }));
    // after a drop, wait before raising again so the resolution doesn't bounce up and down
    if (fps < 34 && this.dpr > 0.6) { this.dpr = Math.max(0.6, this.dpr - 0.15); this.dprHold = 10; }
    else if (fps > 56 && this.dpr < this.maxDpr && this.dprHold <= 0) this.dpr = Math.min(this.maxDpr, this.dpr + 0.1);
  }

  private updateLabels(sel: number, cam: CamMode) {
    const w = this.gl.domElement.clientWidth, h = this.gl.domElement.clientHeight, v = new V3();
    this.riders.forEach((r, i) => {
      const el = this.labels[i];
      if (!el) return;
      v.copy(r.pos).add(new V3(0, 6, 0)).project(this.camera);
      const dist = r.pos.distanceTo(this.camera.position);
      const show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && dist < 1600 && !(i === sel && (cam === 'seat' || cam === 'chase'));
      el.style.display = show ? 'flex' : 'none';
      if (show) el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px,${(-v.y * 0.5 + 0.5) * h - 14}px) translate(-50%,-100%)`;
    });
  }

  /* ------------------------------------------------------------ overview: minimap, compass, world map */

  /** Map pixel for a world point. */
  private mp(x: number, z: number, size: number) { return [((x + INNER / 2) / INNER) * size, ((z + INNER / 2) / INNER) * size]; }

  private drawMinimap() {
    const cv = this.minimap, r = this.cur;
    if (!cv || !this.mapCanvas || !r || !this.data) return;
    const dpr = Math.min(devicePixelRatio, 2), css = cv.clientWidth || 160, S = Math.round(css * dpr);
    // check both sides: a fresh canvas is 300x150, so on a 2x screen the width already matches and the height never got set
    if (cv.width !== S || cv.height !== S) { cv.width = cv.height = S; }
    const g = cv.getContext('2d')!, c = S / 2, viewR = 520, k = (S / 2) / viewR;
    const heading = Math.atan2(r.fwd.z, r.fwd.x), rot = -Math.PI / 2 - heading;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(c, c, c - 1, 0, TAU); g.clip();
    g.fillStyle = '#0b1a24'; g.fillRect(0, 0, S, S);
    g.translate(c, c); g.rotate(rot);
    const px = INNER / MAP_SIZE;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapCanvas, (-INNER / 2 - r.pos.x) * k, (-INNER / 2 - r.pos.z) * k, MAP_SIZE * px * k, MAP_SIZE * px * k);
    const dot = (x: number, z: number, rad: number, fill: string, ring?: string) => {
      g.beginPath(); g.arc((x - r.pos.x) * k, (z - r.pos.z) * k, rad * dpr, 0, TAU);
      g.fillStyle = fill; g.fill();
      if (ring) { g.lineWidth = 1.5 * dpr; g.strokeStyle = ring; g.stroke(); }
    };
    this.seeds?.pos.forEach((p, i) => { if (!this.seeds!.got.has(i)) dot(p.x, p.z, 2.4, '#ffd36a'); });
    if (this.race?.active) this.race.rings.forEach((rg, i) => { if (i >= this.race!.next) dot(rg.p.x, rg.p.z, i === this.race!.next ? 4.5 : 2.5, i === this.race!.next ? '#5ff2d6' : 'rgba(95,242,214,.45)'); });
    for (const m of this.wilds.mounts) dot(m.pos.x, m.pos.z, 3, '#ff6ad5');
    for (const u of [0.15, 0.4, 0.65]) { const f = this.leviathan.frameAt(u); dot(f.c.x, f.c.z, 5 - u * 4, '#b18cff'); }
    this.riders.forEach(o => { if (o !== r) dot(o.pos.x, o.pos.z, 3.4, o.pal.glow, 'rgba(0,0,0,.5)'); });
    if (this.pin) dot(this.pin.x, this.pin.z, 4.5, '#ffffff', '#5ff2d6');
    g.restore();
    // own arrow
    g.save(); g.translate(c, c);
    g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.moveTo(0, -9 * dpr); g.lineTo(6 * dpr, 7 * dpr); g.lineTo(0, 3.5 * dpr); g.lineTo(-6 * dpr, 7 * dpr); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // north marker on the rim
    const na = rot - Math.PI / 2;
    g.fillStyle = '#5ff2d6'; g.font = `${600} ${11 * dpr}px "IBM Plex Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', c + Math.cos(na) * (c - 11 * dpr), c + Math.sin(na) * (c - 11 * dpr));
    g.lineWidth = 2 * dpr; g.strokeStyle = 'rgba(95,242,214,.55)'; g.beginPath(); g.arc(c, c, c - 1.5 * dpr, 0, TAU); g.stroke();
  }

  private drawCompass() {
    const cv = this.compass, r = this.cur;
    if (!cv || !r || !this.data) return;
    const dpr = Math.min(devicePixelRatio, 2), W = Math.round((cv.clientWidth || 520) * dpr), H = Math.round((cv.clientHeight || 40) * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, 'rgba(5,11,20,0)'); bg.addColorStop(0.15, 'rgba(5,11,20,.45)'); bg.addColorStop(0.85, 'rgba(5,11,20,.45)'); bg.addColorStop(1, 'rgba(5,11,20,0)');
    g.fillStyle = bg; g.fillRect(0, H * 0.48, W, H * 0.52);
    const taken: [number, number][] = [];
    const bearing = (dx: number, dz: number) => Math.atan2(dx, -dz);
    const head = bearing(r.fwd.x, r.fwd.z), span = (100 * Math.PI) / 180;
    const xOf = (b: number) => { const d = Math.atan2(Math.sin(b - head), Math.cos(b - head)); return Math.abs(d) > span ? null : W / 2 + (d / span) * (W / 2); };
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 15) {
      const x = xOf((deg * Math.PI) / 180);
      if (x == null) continue;
      const card = deg % 90 === 0;
      g.strokeStyle = card ? 'rgba(234,247,244,.9)' : 'rgba(234,247,244,.35)';
      g.lineWidth = dpr;
      g.beginPath(); g.moveTo(x, H * 0.62); g.lineTo(x, H * (card ? 0.95 : 0.82)); g.stroke();
      if (card) { g.fillStyle = deg === 0 ? '#5ff2d6' : 'rgba(234,247,244,.95)'; g.font = `600 ${11 * dpr}px "IBM Plex Mono", monospace`; g.fillText('NESW'[deg / 90], x, H * 0.36); }
    }
    const marker = (x: number, z: number, color: string, label: string, size = 4) => {
      const sx = xOf(bearing(x - r.pos.x, z - r.pos.z));
      if (sx == null) return;
      g.fillStyle = color;
      g.beginPath(); g.moveTo(sx, H * 0.6); g.lineTo(sx - size * dpr, H * 0.6 - size * 1.6 * dpr); g.lineTo(sx + size * dpr, H * 0.6 - size * 1.6 * dpr); g.closePath(); g.fill();
      if (label) {
        g.font = `500 ${10 * dpr}px Figtree, sans-serif`;
        const w = g.measureText(label).width + 8 * dpr, lx = clamp(sx, w / 2, W - w / 2);
        if (taken.some(([a, b]) => lx + w / 2 > a && lx - w / 2 < b)) return;
        taken.push([lx - w / 2, lx + w / 2]);
        g.fillStyle = 'rgba(5,11,20,.55)'; g.fillRect(lx - w / 2, 0, w, H * 0.3);
        g.fillStyle = 'rgba(234,247,244,.92)'; g.fillText(label, lx, H * 0.15);
      }
    };
    const near = useUI.getState().hud.near;
    if (this.pin) marker(this.pin.x, this.pin.z, '#ffffff', 'pin', 6);
    if (this.race?.active) { const nr = this.race.rings[this.race.next]; if (nr) marker(nr.p.x, nr.p.z, '#5ff2d6', 'next ring', 6); }
    const order = this.data.places.map((pl, i) => ({ pl, i, d: Math.hypot(pl.c[0] - r.pos.x, pl.c[2] - r.pos.z) })).sort((a, b) => a.d - b.d);
    for (const { pl, i, d } of order) marker(pl.c[0], pl.c[2], i === near ? '#5ff2d6' : 'rgba(234,247,244,.7)', i === near && d < 520 ? '' : `${pl.name} ${d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1) + ' km'}`, 3.5);
    const sn = this.seeds?.nearestOpen(r.pos);
    if (sn) marker(sn.p.x, sn.p.z, '#ffd36a', '', 4);
    const wild = this.wilds.nearest(r.pos).mount;
    if (wild) marker(wild.pos.x, wild.pos.z, '#ff6ad5', '', 4);
    const lc = this.leviathan.center, ld = this.leviathan.nearest(r.pos).skin;
    marker(lc.x, lc.z, '#b18cff', ld > 120 ? `Leviathan ${fmtKm(ld)}` : '', 6);
    g.fillStyle = '#5ff2d6';
    g.beginPath(); g.moveTo(W / 2, H * 0.98); g.lineTo(W / 2 - 5 * dpr, H * 0.98 + 0.1); g.lineTo(W / 2, H * 0.7); g.lineTo(W / 2 + 5 * dpr, H * 0.98); g.closePath(); g.fill();
  }

  /** Draw the full world map with places, riders, seeds, flocks, the race course and the pin. */
  drawWorldMap(cv: HTMLCanvasElement) {
    if (!this.mapCanvas || !this.data) return;
    const dpr = Math.min(devicePixelRatio, 2), S = Math.round((cv.clientWidth || 600) * dpr);
    if (cv.width !== S) cv.width = cv.height = S;
    const g = cv.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapCanvas, 0, 0, S, S);
    const at = (x: number, z: number) => this.mp(x, z, S);
    const font = (px: number, w = 500) => `${w} ${px * dpr}px Figtree, system-ui, sans-serif`;
    if (this.race) {
      g.strokeStyle = this.race.active ? 'rgba(95,242,214,.85)' : 'rgba(95,242,214,.35)'; g.lineWidth = 1.5 * dpr; g.setLineDash([4 * dpr, 4 * dpr]);
      g.beginPath(); this.race.rings.forEach((rg, i) => { const [x, y] = at(rg.p.x, rg.p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
    }
    this.seeds?.pos.forEach((p, i) => { if (this.seeds!.got.has(i)) return; const [x, y] = at(p.x, p.z); g.fillStyle = '#ffd36a'; g.beginPath(); g.arc(x, y, 2.6 * dpr, 0, TAU); g.fill(); });
    for (const m of this.wilds.mounts) { const [x, y] = at(m.pos.x, m.pos.z); g.fillStyle = '#ff6ad5'; g.beginPath(); g.arc(x, y, 3 * dpr, 0, TAU); g.fill(); }
    {
      g.strokeStyle = '#b18cff'; g.lineCap = 'round';
      for (let k = 0; k < 8; k++) {
        const a = this.leviathan.frameAt(k / 8), b = this.leviathan.frameAt((k + 1) / 8), [x0, y0] = at(a.c.x, a.c.z), [x1, y1] = at(b.c.x, b.c.z);
        g.lineWidth = (7 - k * 0.7) * dpr; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      const [lx, ly] = at(this.leviathan.center.x, this.leviathan.center.z);
      g.font = font(12, 600); g.textAlign = 'center'; g.fillStyle = '#e6dcff'; g.fillText('Leviathan', lx, ly - 12 * dpr);
    }
    this.data.places.forEach(pl => {
      const [x, y] = at(pl.c[0], pl.c[2]);
      g.fillStyle = 'rgba(5,11,20,.55)'; g.font = font(13, 600); g.textAlign = 'center';
      const w = g.measureText(pl.name).width + 14 * dpr;
      g.beginPath(); g.roundRect(x - w / 2, y - 26 * dpr, w, 20 * dpr, 10 * dpr); g.fill();
      g.fillStyle = '#eaf7f4'; g.fillText(pl.name, x, y - 12 * dpr);
      g.fillStyle = '#5ff2d6'; g.beginPath(); g.arc(x, y, 3 * dpr, 0, TAU); g.fill();
    });
    this.riders.forEach((r, i) => {
      const [x, y] = at(r.pos.x, r.pos.z), a = Math.atan2(r.fwd.z, r.fwd.x);
      g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2);
      g.fillStyle = r.pal.glow; g.strokeStyle = i === useUI.getState().sel ? '#ffffff' : 'rgba(0,0,0,.6)'; g.lineWidth = (i === useUI.getState().sel ? 2 : 1) * dpr;
      const s = (i === useUI.getState().sel ? 1.4 : 1) * dpr;
      g.beginPath(); g.moveTo(0, -8 * s); g.lineTo(5.5 * s, 6 * s); g.lineTo(0, 3 * s); g.lineTo(-5.5 * s, 6 * s); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.font = font(11); g.fillStyle = '#eaf7f4'; g.textAlign = 'left'; g.fillText(RIDERS[i].name, x + 9 * dpr, y + 4 * dpr);
    });
    if (this.pin) {
      const [x, y] = at(this.pin.x, this.pin.z);
      g.strokeStyle = '#ffffff'; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(x, y, 7 * dpr, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(x, y - 12 * dpr); g.lineTo(x, y + 12 * dpr); g.moveTo(x - 12 * dpr, y); g.lineTo(x + 12 * dpr, y); g.stroke();
    }
  }

  /** Convert a click on the world map (0..1 in both axes) to world x/z. */
  mapToWorld(u: number, v: number) { return { x: -INNER / 2 + u * INNER, z: -INNER / 2 + v * INNER }; }
}

export const engine = new Engine();
