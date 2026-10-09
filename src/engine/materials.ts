import * as THREE from 'three';

/** Uniforms shared by every living material, updated once per frame. */
export const U = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uWind: { value: 1 },
  uRip: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -9999, 0, 0)) },
};

export interface BioOpts {
  /** glow that is always on */
  base?: number;
  /** glow added at full night */
  k?: number;
  /** light up under low-flying riders */
  ripple?: boolean;
  /** wind sway amplitude and the height it is normalised to */
  sway?: number;
  swayH?: number;
  /** sway grows downward (vines, tendrils) */
  hang?: boolean;
  /** world-space frequency of lichen speckles that break vertex glow into fine spots */
  speck?: number;
  /** world-space frequency of albedo variation */
  detail?: number;
}

const f = (v: number) => v.toFixed(4);

/** MeshStandardMaterial with per-vertex bioluminescence, wind sway and wing-ripple glow. */
export function bioMat(params: THREE.MeshStandardMaterialParameters, o: BioOpts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...params });
  const O = { base: 0, k: 1.6, ripple: false, sway: 0, swayH: 1, hang: false, speck: 0, detail: 0, ...o };
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uWind = U.uWind;
    sh.uniforms.uRip = U.uRip;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;uniform float uWind;attribute vec3 aGlow;varying vec3 vGlow;varying vec3 vWP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 orig=vec3(0.);
#ifdef USE_INSTANCING
orig=instanceMatrix[3].xyz;
#endif
orig=(modelMatrix*vec4(orig,1.)).xyz;
float hh=${O.hang ? 'max(-position.y,0.)' : 'max(position.y,0.)'}/${f(O.swayH)};
float sw=${f(O.sway)}*hh*hh*uWind;
float gust=1.+.5*sin(uTime*.4+orig.x*.004);
transformed.x+=sw*gust*sin(uTime*1.6*uWind+orig.x*.07+orig.z*.05);
transformed.z+=sw*.7*cos(uTime*1.3*uWind+orig.x*.04-orig.z*.06);
vGlow=aGlow;
vec4 wp4=vec4(transformed,1.);
#ifdef USE_INSTANCING
wp4=instanceMatrix*wp4;
#endif
vWP=(modelMatrix*wp4).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;uniform float uNight;uniform vec4 uRip[6];varying vec3 vGlow;varying vec3 vWP;
float bh(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float bn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(bh(i),bh(i+vec3(1,0,0)),f.x),mix(bh(i+vec3(0,1,0)),bh(i+vec3(1,1,0)),f.x),f.y),
mix(mix(bh(i+vec3(0,0,1)),bh(i+vec3(1,0,1)),f.x),mix(bh(i+vec3(0,1,1)),bh(i+vec3(1,1,1)),f.x),f.y),f.z);}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${O.detail ? `diffuseColor.rgb*=.76+.48*(bn(vWP*${f(O.detail)})*.6+bn(vWP*${f(O.detail * 3.7)}+3.)*.4);` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float pulse=.78+.22*sin(uTime*1.1+vWP.x*.045+vWP.z*.037);
vec3 glw=vGlow*(${f(O.base)}+uNight*${f(O.k)}*pulse);
${O.speck ? `vec3 sq=vWP*vec3(${f(O.speck)},${f(O.speck * 0.4)},${f(O.speck)});
float spk=bn(sq)*.6+bn(sq*2.9+7.)*.4;
glw*=smoothstep(.6,.76,spk)*2.2+smoothstep(.45,.6,spk)*.12;` : ''}
${O.ripple ? `float rip=0.;
for(int i=0;i<6;i++){vec3 dd=vWP-uRip[i].xyz;float d=length(dd.xz);
rip+=uRip[i].w*exp(-d*d/1600.)*(.55+.45*sin(d*.28-uTime*4.5))*exp(-abs(dd.y)/30.);}
glw+=(vGlow*2.4+vec3(.04,.5,.46))*rip*(.2+1.1*uNight);` : ''}
totalEmissiveRadiance+=glw;`);
  };
  m.customProgramCacheKey = () => 'bio' + JSON.stringify(O);
  return m;
}

/* ------------------------------------------------------------ sky */

export const PLANET = new THREE.Vector3(0.55, 0.3, -0.78).normalize();

export function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
    uniforms: {
      uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
      uSunC: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() }, uStars: { value: 0 }, uNight: { value: 0 },
      uCover: { value: 0 }, uFlash: { value: 0 }, uTime: U.uTime, uPlanet: { value: PLANET },
    },
    vertexShader: `varying vec3 vDir;void main(){vDir=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}`,
    fragmentShader: `varying vec3 vDir;uniform vec3 uZen,uHor,uSunDir,uSunC,uCloud,uPlanet;uniform float uStars,uNight,uTime,uCover,uFlash;
float h3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.02+vec3(1.7,9.2,3.1);a*=.5;}return s;}
vec3 body(vec3 d,vec3 P,float R,vec3 c1,vec3 c2,float bands,vec3 L,out float al){
  vec3 T=normalize(cross(P,vec3(0,1,0)));vec3 B=cross(T,P);
  vec2 q=vec2(dot(d,T),dot(d,B))/R;float rr=dot(q,q);al=0.;
  if(dot(d,P)<0.||rr>1.3)return vec3(0);
  float z=sqrt(max(1.-rr,0.));vec3 n=normalize(q.x*T+q.y*B-z*P);
  float c=cos(.38),s=sin(.38);vec2 qq=vec2(c*q.x-s*q.y,s*q.x+c*q.y);
  float b=sin(qq.y*bands+fbm(vec3(qq*3.,1.))*2.6)*.5+.5;
  vec3 cc=mix(c1,c2,b);
  float storm=smoothstep(.16,.0,length(qq-vec2(.3,-.25)));cc=mix(cc,c1*.6+vec3(.0,.15,.18),storm*.8);
  float lit=clamp(dot(n,L)*1.15+.05,0.,1.);
  al=1.-smoothstep(.96,1.,rr);
  float atm=(1.-smoothstep(1.,1.3,rr))*step(1.,rr);
  return cc*(.05+lit)*mix(.55,1.,z)*al+vec3(.45,.8,1.)*atm*.25;
}
void main(){
  vec3 d=normalize(vDir);float h=max(d.y,0.);
  vec3 col=mix(uHor,uZen,pow(h,.5));
  col=mix(col,uHor*.92,smoothstep(0.,-.12,d.y));
  float s=max(dot(d,uSunDir),0.);
  float clearSky=1.-uCover*.85;
  col+=uSunC*(pow(s,6.)*.32+pow(s,60.)*.5+pow(s,1400.)*6.*clearSky)*(1.-uNight*.85)*smoothstep(-.05,.02,uSunDir.y);
  vec3 sp=d*230.;vec3 ci=floor(sp);float rn=h3(ci);
  if(rn>.982){vec3 o=vec3(h3(ci+1.3),h3(ci+2.7),h3(ci+5.1))-.5;float dd=length(fract(sp)-.5-o*.6);
    col+=vec3(.85,.9,1.)*smoothstep(.1,.0,dd)*(.55+.45*sin(uTime*2.+rn*90.))*uStars*clearSky*smoothstep(0.,.25,d.y)*2.2;}
  col+=uStars*clearSky*vec3(.22,.08,.35)*pow(fbm(d*3.+7.),3.)*smoothstep(0.,.4,d.y)*1.4;
  float haze=smoothstep(0.,.22,d.y);
  vec3 L=normalize(-uPlanet+vec3(-.7,.45,.25));
  float vis=clearSky;
  float al;vec3 pc=body(d,uPlanet,.17,vec3(.42,.72,.86),vec3(.9,.97,.98),15.,L,al);
  col=mix(col,pc,al*mix(.6,1.,uNight)*(.35+.65*haze)*vis);col+=pc*(1.-al)*haze*vis;
  vec3 m1=normalize(vec3(.92,.38,-.1));float a1;vec3 mc=body(d,m1,.035,vec3(.7,.68,.66),vec3(.92,.9,.88),4.,normalize(-m1+vec3(-.5,.4,.3)),a1);
  col=mix(col,mc,a1*mix(.5,1.,uNight)*haze*vis);
  vec3 m2=normalize(vec3(.25,.55,-.8));float a2;vec3 mc2=body(d,m2,.016,vec3(.75,.55,.5),vec3(.95,.8,.7),3.,normalize(-m2+vec3(.4,.4,.2)),a2);
  col=mix(col,mc2,a2*mix(.4,1.,uNight)*haze*vis);
  if(d.y>0.){
    vec2 cp=d.xz/(d.y+.18)*1.15;
    float c=fbm(vec3(cp+uTime*.004*(1.+uCover*3.),uTime*.006));
    float c2=fbm(vec3(cp*2.3-uTime*.006,3.));
    float cl=smoothstep(.48-uCover*.4,.78-uCover*.25,c*.75+c2*.35);
    vec3 cc=uCloud*(.72+.5*c2)*(1.-uCover*.45)+uSunC*pow(s,4.)*.5*(1.-uNight)*clearSky;
    cc+=vec3(.75,.8,1.)*uFlash*(.5+c2);
    col=mix(col,cc,cl*(.8+uCover*.2)*smoothstep(0.,.18,d.y));
  }
  col+=vec3(.6,.65,.9)*uFlash*.25;
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}

/* ------------------------------------------------------------ water */

export function makeWaterMaterial(sky: THREE.ShaderMaterial) {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uRain: { value: 0 } }]),
    vertexShader: `varying vec3 vW;
#include <fog_pars_vertex>
void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vec4 mvPosition=viewMatrix*w;gl_Position=projectionMatrix*mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: `uniform float uTime,uNight,uRain;uniform vec3 uZen,uHor,uSunDir,uSunC;varying vec3 vW;
#include <fog_pars_fragment>
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec3 V=normalize(cameraPosition-vW);vec2 p=vW.xz;
  vec3 N=normalize(vec3(sin(p.x*.05+uTime*.6)*.035+sin(p.y*.13+p.x*.07+uTime*1.1)*.02,1.,cos(p.y*.06-uTime*.5)*.035+sin(p.x*.11-p.y*.05+uTime*.9)*.02));
  vec2 rc=floor(p*.6);float rt=fract(uTime*1.3+h2(rc));float rd=length(fract(p*.6)-.5);
  N.xz+=uRain*.25*sin(rd*40.-rt*20.)*smoothstep(.5,.0,rd)*(1.-rt);N=normalize(N);
  float fr=pow(1.-max(dot(N,V),0.),4.)*.9+.06;
  vec3 R=reflect(-V,N);
  vec3 sk=mix(uHor,uZen,pow(max(R.y,0.),.6));
  vec3 deep=mix(vec3(.02,.1,.12),vec3(.0,.05,.1),uNight);
  vec3 c=mix(deep,sk,fr);
  c+=uSunC*pow(max(dot(R,uSunDir),0.),260.)*3.*(1.-uNight*.6)*(1.-uRain);
  vec2 cell=floor(p*1.3);float r=h2(cell);
  float pl=smoothstep(.975,1.,r)*(.5+.5*sin(uTime*2.+r*60.))*smoothstep(.45,.0,length(fract(p*1.3)-.5));
  c+=vec3(.1,.95,.85)*pl*uNight*1.6;
  gl_FragColor=vec4(c,.9);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  for (const k of ['uZen', 'uHor', 'uSunDir', 'uSunC'] as const) m.uniforms[k] = sky.uniforms[k];
  m.uniforms.uTime = U.uTime;
  m.uniforms.uNight = U.uNight;
  return m;
}

/* ------------------------------------------------------------ waterfalls */

export function makeFallMaterial() {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader: `varying vec2 vUv;
#include <fog_pars_vertex>
void main(){vUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: `uniform float uTime,uNight;varying vec2 vUv;
#include <fog_pars_fragment>
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
void main(){float x=vUv.x,y=vUv.y;
float st=vn(vec2(x*16.,y*5.+uTime*1.7))*.6+vn(vec2(x*42.,y*11.+uTime*2.6))*.4;
float a=smoothstep(0.,.28,x)*smoothstep(1.,.72,x)*smoothstep(0.,.5,y)*smoothstep(1.,.97,y)*(.3+.7*st);
vec3 c=mix(vec3(.8,.9,.96),vec3(.35,1.,.95),uNight*.6)*(.65+.6*st)*mix(1.,.8,uNight);
gl_FragColor=vec4(c,a*.85);
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
}`,
  });
  m.uniforms.uTime = U.uTime;
  m.uniforms.uNight = U.uNight;
  return m;
}

/* ------------------------------------------------------------ particles */

export function makePointsMaterial(additive: boolean) {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    defines: additive ? { ADD: 1 } : {},
    uniforms: {
      uTime: U.uTime, uScale: { value: 500 }, uDrift: { value: 1 }, uBlink: { value: 1 }, uInt: { value: 1 },
      uTint: { value: new THREE.Color(1, 1, 1) }, uOp: { value: 0.3 }, uFar: { value: 0.0008 },
    },
    vertexShader: `attribute float aSize;attribute float aPhase;attribute vec3 aColor;
uniform float uTime,uScale,uDrift,uBlink,uFar;varying vec3 vC;varying float vA;
void main(){vec3 p=position+uDrift*vec3(sin(uTime*.5+aPhase*6.28)*2.5,sin(uTime*.8+aPhase*12.)*1.2,cos(uTime*.45+aPhase*9.)*2.5);
vec4 mv=modelViewMatrix*vec4(p,1.);float d=-mv.z;
gl_PointSize=clamp(aSize*uScale/max(d,1.),0.,180.);vC=aColor;
vA=mix(1.,.25+.75*pow(.5+.5*sin(uTime*(1.2+aPhase*2.)+aPhase*40.),2.),uBlink)*exp(-d*uFar)*smoothstep(1.,6.,d);
gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform float uInt,uOp;uniform vec3 uTint;varying vec3 vC;varying float vA;
void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,0.,d);
#ifdef ADD
float core=smoothstep(.14,0.,d);gl_FragColor=vec4(vC*(a*a*.55+core*1.4)*uInt*vA,1.);
#else
gl_FragColor=vec4(uTint*vC,a*a*uOp*vA);
#endif
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
  });
  return m;
}

/* ------------------------------------------------------------ rain */

export function makeRain(count: number) {
  const P = new Float32Array(count * 6), E = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    P.set([x, y, z, x, y, z], i * 6);
    E[i * 2 + 1] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(E, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: U.uTime, uCam: { value: new THREE.Vector3() }, uRain: { value: 0 }, uColor: { value: new THREE.Color(0.7, 0.8, 0.9) } },
    vertexShader: `attribute float aEnd;uniform float uTime;uniform vec3 uCam;varying float vA;
void main(){const float B=90.;vec3 vel=vec3(-6.,-55.,-3.);
vec3 p=mod(position*B+vel*uTime*(.8+position.x*.4)-uCam+B*.5,B)-B*.5+uCam;
p+=normalize(vel)*aEnd*1.8;vA=1.-aEnd*.7;
gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
    fragmentShader: `uniform float uRain;uniform vec3 uColor;varying float vA;void main(){gl_FragColor=vec4(uColor,.35*uRain*vA);
#include <colorspace_fragment>
}`,
  });
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = false;
  return lines;
}
