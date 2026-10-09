import * as THREE from 'three';
import { FIELD_GLSL, NOISE_GLSL, U, patchFog } from './materials';

/**
 * Dense grass that follows the camera. Each blade has a fixed offset in a square tile that
 * repeats across the world, so blades stay put in world space while the tile slides with
 * the camera. Ground height, density, forest tint and occlusion come from the field texture.
 */
export function makeGrassField(count: number, size: number) {
  // one blade: three tapered segments, y in [0,1] doubles as the height parameter
  const segs = 3, pos: number[] = [], idx: number[] = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs, w = 0.5 * (1 - t * 0.85);
    pos.push(-w, t, 0, w, t, 0);
  }
  for (let s = 0; s < segs; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  const r = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { r[i * 4] = Math.random(); r[i * 4 + 1] = Math.random(); r[i * 4 + 2] = Math.random(); r[i * 4 + 3] = Math.random(); }
  geo.setAttribute('aR', new THREE.InstancedBufferAttribute(r, 4));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

  const uCam = { value: new THREE.Vector3() }, uSize = { value: size };
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uTime: U.uTime, uNight: U.uNight, uWind: U.uWind, uRip: U.uRip, uField: U.uField, uFieldInfo: U.uFieldInfo, uCam, uSize });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aR;uniform float uTime,uWind,uSize;uniform vec3 uCam;
varying vec3 vWP;varying vec3 vGrass;varying float vTip;varying float vSpark;
${FIELD_GLSL}`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal=vec3(0.,1.,0.);`)
      .replace('#include <begin_vertex>', `
vec2 rel=aR.xy*uSize-uCam.xz;rel-=uSize*floor(rel/uSize+.5);
vec2 xz=uCam.xz+rel;
vec4 fd=fieldAt(xz);
float fade=1.-smoothstep(uSize*.3,uSize*.5,length(rel));
float keep=smoothstep(aR.z-.08,aR.z+.08,fd.y*fade);
float hgt=(.45+fract(aR.w*7.31)*1.1)*keep*(1.+fd.z*.3);
float ang=aR.w*6.2832,cs=cos(ang),sn=sin(ang);
float t=position.y;
vec3 lp=vec3(position.x*.09*keep,0.,0.);
lp=vec3(lp.x*cs,0.,lp.x*sn);
float lean=.25+fract(aR.z*13.7)*.35;
vec2 wind=vec2(sin(uTime*1.7*uWind+xz.x*.09+xz.y*.05),cos(uTime*1.3*uWind+xz.x*.05-xz.y*.08))*.35*uWind;
vec3 transformed=vec3(xz.x,fd.x-.05,xz.y)+lp+vec3(0.,t*hgt,0.);
transformed.xz+=(vec2(cs,sn)*lean+wind)*t*t*hgt;
vWP=transformed;
vTip=t;
vec3 base=mix(vec3(.10,.22,.07),vec3(.06,.2,.17),fd.z);
vec3 tip=mix(vec3(.45,.62,.22),vec3(.22,.55,.42),fd.z);
vGrass=mix(base,tip,t)*(.55+.45*fd.w)*(.85+.3*fract(aR.x*91.7));
vSpark=step(.93,fract(aR.y*57.3));`)
      .replace('#include <project_vertex>', `vec4 mvPosition=viewMatrix*vec4(transformed,1.);gl_Position=projectionMatrix*mvPosition;`)
      .replace('#include <worldpos_vertex>', `vec4 worldPosition=vec4(transformed,1.);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime,uNight;uniform vec4 uRip[6];varying vec3 vWP;varying vec3 vGrass;varying float vTip;varying float vSpark;
${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `diffuseColor.rgb*=vGrass;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float rip=0.;
for(int i=0;i<6;i++){vec3 dd=vWP-uRip[i].xyz;float d=length(dd.xz);
rip+=uRip[i].w*exp(-d*d/1600.)*(.55+.45*sin(d*.28-uTime*4.5))*exp(-abs(dd.y)/30.);}
float tipGlow=pow(vTip,6.)*(vSpark*1.6+.12);
totalEmissiveRadiance+=vec3(.25,1.,.55)*tipGlow*uNight*(.7+.3*sin(uTime*2.+vWP.x))+vec3(.04,.5,.46)*rip*vTip*(.2+1.1*uNight);`);
    patchFog(sh);
  };
  m.customProgramCacheKey = () => 'grass-field';
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return { mesh, uCam };
}
