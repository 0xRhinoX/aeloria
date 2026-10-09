import * as THREE from 'three';
import { U } from './materials';

/** Glowing ribbons that stream from a mount's wingtips. */
export class Trails {
  readonly mesh: THREE.Mesh;
  private pts: THREE.Vector3[][];
  private ups: THREE.Vector3[][];
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private tmp = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor(private length = 46, tips = 2) {
    this.pts = Array.from({ length: tips }, () => []);
    this.ups = Array.from({ length: tips }, () => []);
    const n = tips * length * 2;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(n), 1));
    const idx: number[] = [];
    for (let t = 0; t < tips; t++) for (let i = 0; i < length - 1; i++) {
      const a = (t * length + i) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uNight: U.uNight },
      vertexShader: `attribute float aT;varying float vT;void main(){vT=aT;gl_Position=projectionMatrix*viewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform vec3 uColor;uniform float uAlpha,uNight;varying float vT;
void main(){float a=pow(1.-vT,2.)*uAlpha*(.08+.9*uNight);gl_FragColor=vec4(uColor*a*1.4,1.);
#include <colorspace_fragment>
}`,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  reset() { this.pts.forEach(p => (p.length = 0)); this.ups.forEach(p => (p.length = 0)); }

  /** Record the tips this frame. `alpha` fades the trails with speed. */
  update(tips: THREE.Object3D[], body: THREE.Object3D, color: THREE.Color, alpha: number) {
    this.mat.uniforms.uColor.value.copy(color);
    this.mat.uniforms.uAlpha.value = alpha;
    this.up.set(0, 1, 0).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()));
    const P = this.geo.attributes.position.array as Float32Array, A = this.geo.attributes.aT.array as Float32Array;
    tips.forEach((tip, t) => {
      tip.getWorldPosition(this.tmp);
      const list = this.pts[t], ups = this.ups[t];
      list.unshift(this.tmp.clone());
      ups.unshift(this.up.clone());
      if (list.length > this.length) { list.pop(); ups.pop(); }
      for (let i = 0; i < this.length; i++) {
        const p = list[Math.min(i, list.length - 1)], u = ups[Math.min(i, ups.length - 1)];
        const w = 0.2 * (1 - i / this.length), o = (t * this.length + i) * 2;
        P[o * 3] = p.x + u.x * w; P[o * 3 + 1] = p.y + u.y * w; P[o * 3 + 2] = p.z + u.z * w;
        P[o * 3 + 3] = p.x - u.x * w; P[o * 3 + 4] = p.y - u.y * w; P[o * 3 + 5] = p.z - u.z * w;
        A[o] = A[o + 1] = i / (this.length - 1);
      }
    });
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aT.needsUpdate = true;
  }
}

/** Streaks of wind rushing past the camera, drawn in view space so they cost no CPU work. */
export function makeSpeedLines(count = 160) {
  const P = new Float32Array(count * 6), R = new Float32Array(count * 2 * 4);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 3.2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.7, z = Math.random();
    P.set([x, y, z, x, y, z], i * 6);
    const ph = Math.random(), l = 0.6 + Math.random();
    R.set([0, ph, l, 0, 1, ph, l, 0], i * 8);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(R, 4));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uAmt: { value: 0 }, uSpeed: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: `attribute vec4 aR;uniform float uTime,uSpeed;varying float vA;
void main(){float z=fract(position.z-uTime*uSpeed*.035+aR.y);float zz=min(-(1.+z*26.)+aR.x*aR.z*uSpeed*.06,-.4);
vA=smoothstep(0.,.25,z)*smoothstep(1.,.6,z)*(1.-aR.x*.6);
gl_Position=projectionMatrix*vec4(position.xy*(1.+z*.4),zz,1.);}`,
    fragmentShader: `uniform float uAmt;uniform vec3 uColor;varying float vA;void main(){gl_FragColor=vec4(uColor*vA*uAmt*.22,1.);
#include <colorspace_fragment>
}`,
  });
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = false;
  lines.renderOrder = 20;
  return lines;
}

/** A burst of spray when a mount skims water. */
export class Splash {
  readonly points: THREE.Points;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  constructor(private n = 260) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3).fill(-9999), 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 400 }, uColor: { value: new THREE.Color(0.85, 0.95, 1) } },
      vertexShader: `attribute float aLife;uniform float uScale;varying float vL;void main(){vL=aLife;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp((.6+(1.-aLife)*1.4)*uScale/max(-mv.z,1.),0.,64.);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform vec3 uColor;varying float vL;void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,.1,d)*vL*.7;gl_FragColor=vec4(uColor,a);
#include <colorspace_fragment>
}`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }
  get material() { return this.points.material as THREE.ShaderMaterial; }
  emit(p: THREE.Vector3, dir: THREE.Vector3, speed: number, count: number) {
    const P = this.points.geometry.attributes.position.array as Float32Array;
    for (let k = 0; k < count; k++) {
      const i = this.next++ % this.n;
      P[i * 3] = p.x + (Math.random() - 0.5) * 3; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z + (Math.random() - 0.5) * 3;
      this.vel[i * 3] = dir.x * speed * 0.4 + (Math.random() - 0.5) * 6;
      this.vel[i * 3 + 1] = 3 + Math.random() * 7;
      this.vel[i * 3 + 2] = dir.z * speed * 0.4 + (Math.random() - 0.5) * 6;
      this.life[i] = 1;
    }
  }
  update(dt: number) {
    const P = this.points.geometry.attributes.position.array as Float32Array, L = this.points.geometry.attributes.aLife.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 0.9;
      this.vel[i * 3 + 1] -= 9.81 * dt;
      P[i * 3] += this.vel[i * 3] * dt; P[i * 3 + 1] += this.vel[i * 3 + 1] * dt; P[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      L[i] = Math.max(0, this.life[i]);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aLife.needsUpdate = true;
  }
}
