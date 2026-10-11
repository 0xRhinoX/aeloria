import * as THREE from 'three';
import { TAU, clamp, lerp, mulberry32 } from '../world/noise';
import type { Quality } from '../world/generate';
import type { Terrain } from '../world/terrain';
import { NOISE_GLSL, U, makePointsMaterial, patchFog } from './materials';

const UP = new THREE.Vector3(0, 1, 0);
/** body length and girth (m), cruise speed (m/s) */
const LEN = 300, R0 = 27, SPEED = 26;
/** spine samples shared by the CPU (collisions, fins, tendrils) and the GPU (skin) */
const SPN = 128;
const PATH_N = 4096;
/** body profile u^PA (1-u)^PB, scaled so the widest point is 1 */
const PA = 0.55, PB = 1.25, UM = PA / (PA + PB), NK = 1 / (Math.pow(UM, PA) * Math.pow(1 - UM, PB));
const SEG = 30, SPORES = 320, BLOW = 280;

/* ------------------------------------------------------------ body shape (CPU twin of SHAPE_GLSL) */

const ss = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const prof = (u: number) => { u = clamp(u, 0, 1); return Math.pow(u, PA) * Math.pow(1 - u, PB) * NK + 0.06 * ss(0.75, 0.95, u) * (1 - ss(0.985, 1, u)); };
const wxOf = (u: number) => lerp(lerp(1.12, 1, ss(0.05, 0.35, u)), 0.62, ss(0.6, 0.92, u));
const htOf = (u: number) => lerp(lerp(0.74, 0.95, ss(0.04, 0.42, u)), 1.05, ss(0.65, 0.92, u));
const hbOf = (u: number) => lerp(lerp(1.08, 0.9, ss(0.12, 0.5, u)), 1.05, ss(0.65, 0.92, u));
const kbOf = (u: number) => 0.1 * ss(0.22, 0.38, u) * (1 - ss(0.58, 0.78, u));
const kkOf = (u: number) => 0.22 * ss(0.62, 0.9, u) * (1 - ss(0.97, 1, u));

/** Cross-section offset in metres at u (0 nose, 1 tail) and angle th (0 right flank, pi/2 back). */
function sect(u: number, th: number, out: { x: number; y: number }) {
  const r = R0 * prof(u), c = Math.cos(th), s = Math.sin(th);
  const fb = hbOf(u) * (1 + kbOf(u) * Math.min(s, 0));
  out.x = c * r * wxOf(u);
  out.y = s * r * lerp(fb, htOf(u), ss(-0.5, 0.5, s)) + r * kkOf(u) * Math.exp(-c * c * 25) * (Math.max(s, 0) - 0.7 * Math.max(-s, 0));
  return out;
}

/** A flat-topped head over a deep pleated throat, a slim body and a keeled, flattened tail stock. */
const SHAPE_GLSL = `
const float LV_R0=${R0.toFixed(1)},LV_LEN=${LEN.toFixed(1)};
float lvProf(float u){u=clamp(u,0.,1.);return pow(u,${PA.toFixed(2)})*pow(1.-u,${PB.toFixed(2)})*${NK.toFixed(5)}+.06*smoothstep(.75,.95,u)*(1.-smoothstep(.985,1.,u));}
float lvWX(float u){return mix(mix(1.12,1.,smoothstep(.05,.35,u)),.62,smoothstep(.6,.92,u));}
float lvHT(float u){return mix(mix(.74,.95,smoothstep(.04,.42,u)),1.05,smoothstep(.65,.92,u));}
float lvHB(float u){return mix(mix(1.08,.9,smoothstep(.12,.5,u)),1.05,smoothstep(.65,.92,u));}
float lvKB(float u){return .1*smoothstep(.22,.38,u)*(1.-smoothstep(.58,.78,u));}
float lvKK(float u){return .22*smoothstep(.62,.9,u)*(1.-smoothstep(.97,1.,u));}
vec2 lvSect(float u,float th){
  float r=LV_R0*lvProf(u),c=cos(th),s=sin(th),fb=lvHB(u)*(1.+lvKB(u)*min(s,0.));
  return vec2(c*r*lvWX(u),s*r*mix(fb,lvHT(u),smoothstep(-.5,.5,s))+r*lvKK(u)*exp(-c*c*25.)*(max(s,0.)-.7*max(-s,0.)));
}`;

/** The spine lives in a small float texture: centre, side and up per sample, refreshed every frame. */
const SPINE_GLSL = `
uniform sampler2D uSpine;
vec3 lvC,lvS,lvUp,lvT;
vec4 lvTex(int i,int row){return texelFetch(uSpine,ivec2(clamp(i,0,${SPN - 1}),row),0);}
void lvFrame(float u){
  float x=clamp(u,0.,1.)*${SPN - 1}.;
  int i=min(int(x),${SPN - 2});float f=x-float(i),f2=f*f,f3=f2*f;
  vec3 p0=lvTex(i-1,0).xyz,p1=lvTex(i,0).xyz,p2=lvTex(i+1,0).xyz,p3=lvTex(i+2,0).xyz;
  lvC=.5*(2.*p1+(p2-p0)*f+(2.*p0-5.*p1+4.*p2-p3)*f2+(3.*p1-p0-3.*p2+p3)*f3);
  lvS=normalize(mix(lvTex(i,1).xyz,lvTex(i+1,1).xyz,f));
  lvUp=normalize(mix(lvTex(i,2).xyz,lvTex(i+1,2).xyz,f));
  lvUp=normalize(lvUp-lvS*dot(lvUp,lvS));
  lvT=cross(lvUp,lvS);
}
vec3 lvNormal(float u,float th){
  float ud=clamp(u,.003,.997);
  vec2 dth=(lvSect(ud,th+.004)-lvSect(ud,th-.004))/.008,du=(lvSect(ud+.0015,th)-lvSect(ud-.0015,th))/.003;
  return normalize(cross(lvS*dth.x+lvUp*dth.y,-lvT*LV_LEN+lvS*du.x+lvUp*du.y));
}`;

/** Per-pixel skin: countershading, speckles, throat pleats, rows of lights, spine chevrons, moss, eyes. */
const SKIN_GLSL = `
float lvHash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
vec2 lvHash2(vec2 p){float a=lvHash(p);return vec2(a,lvHash(p+a*17.31+3.7));}
vec2 lvCell(vec2 p){
  vec2 i=floor(p),f=fract(p);float best=9.,id=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y)),o=g+.1+.8*lvHash2(i+g)-f;float d=dot(o,o);
    if(d<best){best=d;id=lvHash(i+g+19.7);}
  }
  return vec2(sqrt(best),id);
}
float lvBand(float d,float w,float aa){return 1.-smoothstep(w-aa,w+aa,d);}
struct LvSkin{vec3 alb;float rough;vec3 em;};
LvSkin lvSkin(vec3 L,float u,float th,float fw){
  LvSkin o;
  float c=cos(th),s=sin(th),side=c<0.?-1.:1.;
  float phi=atan(s,abs(c)),tau=atan(c,s),psi=atan(c,-s);
  float ar=max(LV_R0*lvProf(u),.1),v=L.x;
  float far=smoothstep(.12,.6,fw);
  float night=clamp(uNight,0.,1.6),kg=.35+1.45*night+1.8*uPulse;
  vec3 CY=vec3(.3,1.,.86),VI=vec3(.62,.42,1.),GO=vec3(1.,.76,.32);
  float n1=bn(L*vec3(.03,.08,.08)),n2=bn(L*vec3(.1,.22,.22)+7.);
  float back=smoothstep(-.5,.15,s+(n1-.5)*.5+(n2-.5)*.18);
  vec3 alb=mix(mix(vec3(.3,.39,.45),vec3(.45,.54,.59),n1),mix(vec3(.008,.022,.04),vec3(.025,.07,.1),n2*n2),back);
  float rough=mix(.44,.3,back)+(n2-.5)*.14;
  vec3 em=vec3(0.);
  // soft, irregular pale mottling with scattered flecks, like a blue whale's back
  float mreg0=back*smoothstep(.08,.16,u);
  if(mreg0>.01){
    float mot=smoothstep(.58,.8,bn(L*vec3(.16,.42,.42)+1.7)*.7+bn(L*vec3(.5,1.2,1.2))*.3),spk=0.;
    if(far<.99){vec2 sc=lvCell(vec2(v,tau*ar)/1.6);spk=(1.-smoothstep(.04+.1*sc.y,.17+.12*sc.y+fw/1.6,sc.x))*step(.45,sc.y)*(1.-far);}
    alb=mix(alb,alb*1.7+vec3(.02,.035,.045),(mot*.5+spk*.3)*mreg0);
  }
  if(u<.46&&s<-.1){
    float gw=psi*ar/.9,gid=floor(gw+.5),gend=.3+.12*lvHash(vec2(gid,3.7));
    float greg=smoothstep(.02,.045,u)*(1.-smoothstep(gend-.05,gend,u))*(1.-smoothstep(-.5,-.2,s));
    float gr=lvBand(abs(fract(gw+.5)-.5)*.9,.05,fw+.02)*greg*(1.-far);
    alb=mix(alb,alb*vec3(.72,.6,.62),gr+greg*far*.22);
    em+=CY*gr*.3*night;
  }
  float on=smoothstep(.05,.1,u)*(1.-smoothstep(.8,.88,u));
  if(on>0.&&phi<.1&&phi>-.85){
    for(int k=0;k<2;k++){
      float fk=float(k),row=fk<.5?-.2:-.5,spc=3.4;
      float a=v/spc+fk*.5,cid=floor(a);
      float h1=lvHash(vec2(cid,fk*3.1+side*7.3)),h2=lvHash(vec2(cid+5.,fk+side*2.1));
      float dv=(fract(a)-.5+(h1-.5)*.25)*spc,ds=(phi-row)*ar;
      float rad=.36+.2*h2,d=length(vec2(dv,ds)),aa=fw+.015;
      float wave=.55+.45*sin(v*.07-uTime*1.7+side*.6+fk*1.3);
      float cr=lvBand(d,rad,aa),rim=lvBand(d,rad+.3,aa)-cr;
      cr=mix(cr,.14*lvBand(abs(ds),rad*1.5,aa),far);
      em+=CY*(cr*2.4+exp(-d*d/(rad*rad*6.))*.3)*on*wave*kg;
      alb*=1.-.5*rim*on*(1.-far);
    }
  }
  float lds=(phi-.08)*ar;
  float ll=lvBand(abs(lds),.05,fw+.02)*step(.3,fract(v/2.6+side*.25));
  ll=mix(ll,.3*lvBand(abs(lds),.25,fw),far)*smoothstep(.12,.18,u)*(1.-smoothstep(.75,.84,u));
  em+=VI*ll*kg*.9;
  float dsd=abs(tau)*ar;
  if(dsd<3.&&s>0.){
    float dq=abs(fract((v+dsd*.9)/7.5+.5)-.5)*7.5;
    float ch=mix(lvBand(dq,.14,fw+.03),.16,far)*(1.-smoothstep(1.6,2.6,dsd));
    em+=VI*ch*smoothstep(.14,.2,u)*(1.-smoothstep(.78,.86,u))*kg*.85;
  }
  float mreg=smoothstep(.13,.2,u)*(1.-smoothstep(.62,.72,u))*smoothstep(.45,.8,s)*smoothstep(2.4,3.6,dsd);
  if(mreg>0.){
    float moss=smoothstep(.46,.6,bn(L*.11+11.)*.6+bn(L*.33+2.)*.4)*mreg;
    alb=mix(alb,mix(vec3(.03,.11,.07),vec3(.09,.25,.12),bn(L*1.1)),moss);
    rough=mix(rough,.88,moss);
    vec2 mc=lvCell(vec2(v,tau*ar)/.8);
    float ms=lvBand(mc.x,.12,fw/.8+.02)*step(.55,mc.y)*moss*(1.-far);
    em+=mix(GO,vec3(.4,1.,.7),fract(mc.y*7.))*ms*kg*1.3+vec3(.3,.8,.5)*moss*far*.05*kg;
  }
  if(u<.13&&s>.35){
    vec2 kc=lvCell(vec2(v,tau*ar)/2.);
    float kn=(1.-smoothstep(.04+.08*kc.y,.14+.08*kc.y+fw/2.,kc.x))*(1.-smoothstep(.08,.12,u))*smoothstep(.35,.7,s)*step(.35,kc.y);
    alb=mix(alb,alb*1.35+vec3(.012,.02,.025),kn*.6);
    em+=GO*kn*step(.85,kc.y)*kg*.5*(1.-far);
  }
  float breg=(1.-smoothstep(.05,.08,u))*(1.-smoothstep(-.3,.1,s))+exp(-pow((u-.235)/.03,2.))*exp(-pow((phi+.5)/.25,2.));
  if(breg>.01)breg*=smoothstep(.55,.7,bn(L*.21+4.));
  if(breg>.01){
    vec2 bc=lvCell(vec2(v,psi*ar)/.55);
    float bar=lvBand(bc.x,.28,fw/.55+.02)*breg*(1.-far*.7);
    alb=mix(alb,mix(vec3(.36,.38,.37),vec3(.55,.56,.52),bc.y),bar);
    rough=mix(rough,.95,bar);
  }
  if(u<.16){
    float mphi=-.06-.24*smoothstep(0.,.1,u)+.08*smoothstep(.085,.115,u);
    float mds=(phi-mphi)*ar,mr=1.-smoothstep(.1,.118,u);
    alb=mix(alb,vec3(.006,.01,.016),lvBand(abs(mds),.06,fw+.02)*mr);
    em+=CY*exp(-pow((mds-.25)/.07,2.))*mr*kg*.35;
    vec2 ed=vec2(v-.125*LV_LEN,(phi+.02)*ar);
    float er=length(ed/vec2(1.25,.85)),lid=1.-smoothstep(1.,2.8,er);
    alb=mix(alb,alb*.35,lid*.9);
    alb*=1.-.3*lid*smoothstep(.2,.9,sin(er*13.))*smoothstep(1.,1.3,er)*(1.-far);
    float ball=lvBand(er,.78,fw*1.2+.01),ir=length(ed/vec2(.95,.65));
    float iris=lvBand(ir,.62,fw*1.4+.01),pup=lvBand(length(ed/vec2(.5,.16)),1.,fw*1.5+.01);
    float stri=.75+.25*sin(atan(ed.y,ed.x)*28.);
    vec3 eye=mix(vec3(.05,.06,.07),mix(vec3(.02,.06,.06),vec3(.09,.06,.025),smoothstep(.1,.6,ir))*stri,iris);
    alb=mix(alb,mix(eye,vec3(.002),pup),ball);
    rough=mix(rough,.05,ball);
    em+=mix(vec3(1.,.7,.25),vec3(.25,1.,.85),smoothstep(.2,.62,ir))*iris*(1.-pup)*stri*(.2*night+.9*uPulse);
  }
  if(u>.13&&u<.17&&s>.5){
    vec2 bo=vec2(v-.15*LV_LEN,abs(tau)*ar-.7);
    alb=mix(alb,vec3(.01,.02,.03),lvBand(length(bo/vec2(1.8,.32)),1.,fw*2.+.05)*.9);
  }
  o.alb=alb;o.rough=clamp(rough,.08,1.);o.em=em;
  return o;
}
float lvH(vec3 p){
  float u=p.x/LV_LEN,ar=max(LV_R0*lvProf(u),.1);
  float l=max(length(p.yz),1e-3),c=p.y/l,s=p.z/l;
  float h=(bn(p*vec3(.45,1.3,1.3))-.5)*.05;
  if(u<.46&&s<-.1){
    float gw=atan(c,-s)*ar/.9,gid=floor(gw+.5),gend=.3+.12*lvHash(vec2(gid,3.7));
    float greg=smoothstep(.02,.045,u)*(1.-smoothstep(gend-.05,gend,u))*(1.-smoothstep(-.5,-.2,s));
    h-=.1*(1.-smoothstep(0.,.17,abs(fract(gw+.5)-.5)*.9))*greg;
  }
  if(u<.13&&s>.35){
    vec2 kc=lvCell(vec2(p.x,atan(c,s)*ar)/2.);
    float kr=.14+.08*kc.y,kd=clamp(kc.x/kr,0.,1.),q=1.-kd*kd;
    h+=q*q*kr*.9*(1.-smoothstep(.08,.12,u))*smoothstep(.35,.7,s)*step(.35,kc.y);
  }
  return h;
}`;

/** Fine relief (wrinkles, pleats, knobs) as a normal tweak from finite differences of lvH. */
const BUMP_GLSL = `
float lvBk=1.-smoothstep(.1,.5,lvFw);
if(lvBk>0.){
  float h0=lvH(vLvL);
  vec3 g=vec3(lvH(vLvL+vec3(.04,0.,0.))-h0,lvH(vLvL+vec3(0.,.04,0.))-h0,lvH(vLvL+vec3(0.,0.,.04))-h0)/.04;
  vec3 gv=g.x*vLvAV+g.y*vLvAX+g.z*vLvAY;
  normal=normalize(normal-lvBk*(gv-dot(gv,normal)*normal));
}`;

type Uni = Record<string, THREE.IUniform>;

function bodyMaterial(uni: Uni, hq: boolean) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
${SHAPE_GLSL}${SPINE_GLSL}
varying float vLvU,vLvTh;varying vec3 vLvL,vLvAV,vLvAX,vLvAY,vWP;`)
      .replace('#include <beginnormal_vertex>', `float lvU=position.x,lvTh=position.y;
lvFrame(lvU);
vec2 lvXY=lvSect(lvU,lvTh);
vec3 lvP=lvC+lvS*lvXY.x+lvUp*lvXY.y;
vec3 objectNormal=lvNormal(lvU,lvTh);
#ifdef USE_TANGENT
vec3 objectTangent=vec3(tangent.xyz);
#endif
vLvU=lvU;vLvTh=lvTh;vLvL=vec3(lvU*LV_LEN,lvXY);
mat3 lvVM=mat3(viewMatrix);vLvAV=lvVM*(-lvT);vLvAX=lvVM*lvS;vLvAY=lvVM*lvUp;`)
      .replace('#include <begin_vertex>', 'vec3 transformed=lvP;vWP=lvP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime,uNight,uPulse;
varying float vLvU,vLvTh;varying vec3 vLvL,vLvAV,vLvAX,vLvAY,vWP;
${NOISE_GLSL}${SHAPE_GLSL}${SKIN_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float lvFw=max(length(fwidth(vLvL)),1e-4);
LvSkin lvSk=lvSkin(vLvL,vLvU,vLvTh,lvFw);
diffuseColor.rgb=lvSk.alb;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor=lvSk.rough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
${hq ? BUMP_GLSL : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float lvUpN=dot(normal,normalize((viewMatrix*vec4(0.,1.,0.,0.)).xyz));
float lvFres=pow(1.-clamp(dot(normal,normalize(-vViewPosition)),0.,1.),4.)*smoothstep(-.2,.7,lvUpN);
// skylight bouncing up under the belly, so the pale underside reads even in its own shade
totalEmissiveRadiance+=lvSk.em+vec3(.3,.5,.85)*lvFres*(.03+.07*clamp(uNight,0.,1.))+lvSk.alb*vec3(.55,.66,.8)*(.22-.16*clamp(uNight,0.,1.))*(1.-smoothstep(-.6,.3,lvUpN));`);
    patchFog(sh);
  };
  m.customProgramCacheKey = () => 'leviathan-body' + (hq ? '-hq' : '');
  return m;
}

/** Shadow caster for the body: the same spine and cross-section, depth only. */
function bodyDepthMaterial(uni: Uni) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
${SHAPE_GLSL}${SPINE_GLSL}`)
      .replace('#include <begin_vertex>', 'lvFrame(position.x);vec2 lvXY=lvSect(position.x,position.y);vec3 transformed=lvC+lvS*lvXY.x+lvUp*lvXY.y;');
  };
  m.customProgramCacheKey = () => 'leviathan-depth';
  return m;
}

/** Thick, smooth fins: countershaded, pale knobs on the leading edge, glowing trailing edge and lights. */
function finMaterial(uni: Uni, span: number, knobs: number, dark = 0) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0, side: THREE.DoubleSide });
  const own = { uBend: { value: 0 }, uSpan: { value: span }, uKnobs: { value: knobs }, uDark: { value: dark } };
  m.userData.bend = own.uBend;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni, own, { uLSun: U.uSunDir, uLSunC: U.uSunCol });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uBend,uSpan;varying vec2 vFin;varying float vFinTop;varying vec3 vWP;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float fnS=abs(uv.x),fnA=atan(uBend*.6*fnS*sign(uv.x+1e-6)),fnC=cos(fnA),fnN=sin(fnA);
vFinTop=objectNormal.y;
objectNormal=vec3(objectNormal.x*fnC-objectNormal.y*fnN,objectNormal.x*fnN+objectNormal.y*fnC,objectNormal.z);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.y+=uBend*.3*fnS*fnS*uSpan;
vFin=vec2(fnS,uv.y);vWP=(modelMatrix*vec4(transformed,1.)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime,uNight,uPulse,uKnobs,uSpan,uDark;uniform vec3 uLSun,uLSunC;varying vec2 vFin;varying float vFinTop;varying vec3 vWP;
${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float fs=vFin.x,fc=vFin.y,ffw=max(length(fwidth(vWP)),1e-3),ffar=smoothstep(.15,.7,ffw);
float fkg=.35+1.45*clamp(uNight,0.,1.6)+1.8*uPulse,fn=bn(vWP*.13),ftop=max(smoothstep(-.3,.3,vFinTop),uDark);
vec3 fA=mix(mix(vec3(.3,.39,.44),vec3(.45,.53,.57),fn),mix(vec3(.008,.022,.04),vec3(.025,.07,.1),fn*fn),ftop);
fA*=1.-.45*(1.-ftop)*smoothstep(.55,.7,bn(vWP*.07+5.));
float knob=(1.-smoothstep(0.,.1,fc))*pow(max(0.,sin(fs*uKnobs*3.14159)),2.)*smoothstep(.06,.14,fs)*(1.-smoothstep(.85,.97,fs))*step(.5,uKnobs);
fA=mix(fA,vec3(.42,.47,.48),knob*.55);
float te=smoothstep(.8,.97,fc)*smoothstep(.03,.1,fs),tw=.5+.5*sin(fs*14.-uTime*2.2);
float fdv=(fract(fs*uSpan/4.2)-.5)*4.2,fds=(fc-.42)*14.;
float fcore=1.-smoothstep(.42-ffw,.42+ffw,length(vec2(fdv,fds)));
fcore=mix(fcore,.035*(1.-smoothstep(0.,.8,abs(fds))),ffar)*smoothstep(.06,.12,fs)*(1.-smoothstep(.85,.95,fs));
vec3 fEm=vec3(.3,1.,.86)*(te*(.3+.7*tw)*1.5+fcore*2.2)*fkg+vec3(.4,1.,.85)*knob*clamp(uNight,0.,1.)*fkg*.3;
fEm+=fA*uLSunC*pow(max(dot(normalize(vWP-cameraPosition),uLSun),0.),5.)*1.2*(1.-uDark*.85);
diffuseColor.rgb=fA;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float fFres=pow(1.-clamp(abs(dot(normal,normalize(-vViewPosition))),0.,1.),4.);
float fUpN=dot(normal,normalize((viewMatrix*vec4(0.,1.,0.,0.)).xyz));
totalEmissiveRadiance+=fEm+vec3(.3,.5,.85)*fFres*(.03+.07*clamp(uNight,0.,1.))+fA*vec3(.55,.66,.8)*(.22-.16*clamp(uNight,0.,1.))*(1.-smoothstep(-.6,.3,fUpN));`);
    patchFog(sh);
  };
  m.customProgramCacheKey = () => 'leviathan-fin';
  return m;
}

/** Glowing stalks rooted along the back, placed on the GPU from the spine so they ride every flex. */
function gardenMaterial(uni: Uni) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
${SHAPE_GLSL}${SPINE_GLSL}
uniform float uTime;attribute vec4 aInst;attribute vec3 aCol;attribute float aBulb;
varying float vBulb,vAlong;varying vec3 vCol,vWP;`)
      .replace('#include <beginnormal_vertex>', `float stTh=1.5707963-aInst.y,stH=aInst.z,stPh=aInst.w;
lvFrame(aInst.x);
vec2 stXY=lvSect(aInst.x,stTh);
vec3 stN=lvNormal(aInst.x,stTh),stZ=normalize(lvT-stN*dot(lvT,stN)),stX=cross(stN,stZ);
vec3 stB=lvC+lvS*stXY.x+lvUp*stXY.y-stN*.3;
vec3 objectNormal=normalize(stX*normal.x+stN*normal.y+stZ*normal.z);
#ifdef USE_TANGENT
vec3 objectTangent=vec3(tangent.xyz);
#endif`)
      .replace('#include <begin_vertex>', `float sy=position.y;
vec3 sw=vec3(sin(uTime*1.1+stPh)*.14,0.,-.22+.06*sin(uTime*.7+stPh*2.))*sy*sy;
vec3 lp=(position+sw)*stH;
vec3 transformed=stB+stX*lp.x+stN*lp.y+stZ*lp.z;
vBulb=aBulb;vCol=aCol;vAlong=sy;vWP=transformed;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime,uNight,uPulse;varying float vBulb,vAlong;varying vec3 vCol,vWP;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb=mix(mix(vec3(.02,.08,.07),vec3(.12,.36,.28),vAlong*vAlong),vCol*.3,vBulb);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float stk=.35+1.45*clamp(uNight,0.,1.6)+1.8*uPulse;
totalEmissiveRadiance+=vCol*(vBulb*(1.1+.5*sin(uTime*2.+vWP.x*.3+vWP.z*.2))*1.6+smoothstep(.55,1.,vAlong)*(1.-vBulb)*.45)*stk+vec3(.05,.3,.22)*vAlong*(1.-vBulb)*stk*.25;`);
    patchFog(sh);
  };
  m.customProgramCacheKey = () => 'leviathan-garden';
  return m;
}

/** Additive glowing ribbons that turn to face the camera, with light pulses running down them. */
function ribbonMaterial(uni: Uni) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: U.uTime, uNight: U.uNight, uPulse: uni.uPulse },
    vertexShader: `attribute vec3 aTan;attribute float aEdge,aAlong,aSeed;
varying float vEdge,vAlong,vSeed,vFade;
void main(){
  float w=mix(.55,.08,pow(aAlong,.7));
  vec3 sd=normalize(cross(aTan,normalize(cameraPosition-position)));
  vec4 mv=modelViewMatrix*vec4(position+sd*w*aEdge,1.);
  vEdge=aEdge;vAlong=aAlong;vSeed=aSeed;vFade=exp(-length(mv.xyz)*.00035);
  gl_Position=projectionMatrix*mv;
}`,
    fragmentShader: `uniform float uTime,uNight,uPulse;varying float vEdge,vAlong,vSeed,vFade;
void main(){
  float a=exp(-vEdge*vEdge*3.);
  float pulse=pow(.5+.5*sin(vAlong*16.-uTime*3.+vSeed*6.28),6.);
  vec3 c=mix(vec3(.3,1.,.86),vec3(.66,.42,1.),smoothstep(.2,1.,vAlong));
  float k=(.1+1.1*clamp(uNight,0.,1.6)+1.5*uPulse)*(1.-vAlong*.5);
  gl_FragColor=vec4(c*a*(.3+1.5*pulse)*k*vFade,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
  });
}

/** Soft, coreless additive sprites that overlap into a glowing mist (the spout). */
function mistMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 500 }, uInt: { value: 1 } },
    vertexShader: `attribute float aSize,aA;uniform float uScale;varying float vA,vT;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);float d=-mv.z;
gl_PointSize=clamp(aSize*uScale/max(d,1.),0.,320.);vA=aA*exp(-d*.0003)*smoothstep(2.,10.,d);vT=aSize;
gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform float uInt;varying float vA,vT;
void main(){float d=length(gl_PointCoord-.5)*2.;float a=exp(-d*d*3.2)*(1.-smoothstep(.85,1.,d));
vec3 c=mix(vec3(.8,1.,.96),vec3(.45,.8,1.),smoothstep(6.,26.,vT));
gl_FragColor=vec4(c*a*vA*uInt,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
  });
}

/* ------------------------------------------------------------ fins */

interface Loft { span: number; ns: number; nc: number; both?: boolean; chord(s: number): number; lead(s: number): number; drop(s: number): number; thick(s: number): number }

/**
 * Loft a fin from airfoil sections: span along +x, leading edge toward +z, thickness along y.
 * Each section is one loop (trailing edge, under the fin, round the leading edge, over the top) so
 * the leading edge stays round and the trailing edge sharp. uv = (signed span, chord 0 lead..1 trail).
 */
function loft(o: Loft) {
  const P: number[] = [], UV: number[] = [], idx: number[] = [];
  const ring = 2 * o.nc + 1, stations = o.both ? 2 * o.ns + 1 : o.ns + 1;
  for (let k = 0; k < stations; k++) {
    const sg = o.both ? k / o.ns - 1 : k / o.ns, s = Math.abs(sg);
    const ch = Math.max(o.chord(s), 0.05), le = o.lead(s), dy = o.drop(s), th = o.thick(s);
    for (let j = 0; j < ring; j++) {
      const top = j > o.nc, q = top ? (j - o.nc) / o.nc : 1 - j / o.nc;
      const c = 0.5 - 0.5 * Math.cos(Math.PI * q);
      const yt = 5 * th * ch * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
      P.push(sg * o.span, dy + (top ? yt : -yt), le - c * ch);
      UV.push(sg, c);
    }
  }
  for (let k = 0; k < stations - 1; k++) for (let j = 0; j < ring - 1; j++) {
    const a = k * ring + j, b = a + 1, d = a + ring, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const knobs = (s: number) => 1.1 * Math.max(0, Math.sin(s * 20 * Math.PI)) ** 2 * ss(0.06, 0.14, s) * (1 - ss(0.85, 0.97, s));
/** Long humpback flipper with a scalloped leading edge. */
const FLIPPER: Loft = {
  span: 88, ns: 80, nc: 14,
  chord: s => 22 * (1 - 0.45 * s) * Math.sqrt(Math.max(0, 1 - s ** 6)) + 1 + knobs(s),
  lead: s => -10 * s ** 1.6 + knobs(s),
  drop: s => -4 * s * s,
  thick: s => 0.16 - 0.06 * s,
};
/** Swept tail flukes with a notch in the middle of the trailing edge. */
const FLUKE: Loft = {
  span: 58, ns: 48, nc: 12, both: true,
  chord: s => 26 * Math.max(0, 1 - s ** 1.8) ** 0.75 * (0.6 + 0.4 * ss(0, 0.2, s)) + 0.5,
  lead: s => -30 * s ** 2.2,
  drop: s => -2 * s * s,
  thick: s => 0.13 - 0.05 * s,
};
/** Small hooked dorsal fin, span turned to point up. */
const dorsalGeo = () => {
  const g = loft({ span: 11, ns: 16, nc: 10, chord: s => 16 * (1 - s ** 1.2) + 0.5, lead: s => -12 * s ** 1.5, drop: () => 0, thick: () => 0.14 });
  return g.rotateZ(Math.PI / 2);
};

/** One glowing stalk: a tapered stem with a bulb on top; aBulb marks the bulb's vertices. */
function stalkGeo(hq: boolean) {
  const stem = new THREE.CylinderGeometry(0.012, 0.035, 1, hq ? 6 : 4, hq ? 4 : 2, true).translate(0, 0.5, 0);
  const bulb = new THREE.SphereGeometry(0.06, hq ? 8 : 6, hq ? 6 : 4).translate(0, 1.04, 0);
  const g = new THREE.BufferGeometry(), n0 = stem.attributes.position.count, parts = [stem, bulb];
  for (const k of ['position', 'normal']) g.setAttribute(k, new THREE.Float32BufferAttribute(parts.flatMap(p => Array.from(p.attributes[k].array)), 3));
  g.setAttribute('aBulb', new THREE.Float32BufferAttribute(Array.from({ length: n0 + bulb.attributes.position.count }, (_, i) => (i < n0 ? 0 : 1)), 1));
  g.setIndex([...Array.from(stem.index!.array), ...Array.from(bulb.index!.array, i => i + n0)]);
  return g;
}

/* ------------------------------------------------------------ the whale */

interface Frame { c: THREE.Vector3; t: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3; r: number }
interface Tendril { u: number; th: number; len: number; ph: number; tilt: number; p: Float32Array }

/**
 * A sky whale some 300 m long that swims a slow figure-eight over the whole world. The CPU lays its
 * spine along the path every frame (so turns ripple down the body) and the GPU builds the skin from
 * that spine: a smooth high-resolution body with per-pixel markings and lights, thick fins and flukes,
 * a garden of glowing stalks on its back and tendrils streaming from its belly along its wake.
 * Every minute or so it sings and exhales a glowing spout.
 */
export class Leviathan {
  readonly group = new THREE.Group();
  /** collision spheres along the body as x, y, z, r; refreshed every frame */
  readonly spheres: [number, number, number, number][] = [];
  /** 0..1 swell of light that follows each song */
  pulse = 0;
  /** set on the frame a song starts; the engine plays it and clears the flag */
  sang = false;
  speed = SPEED;
  private path = new Float32Array(PATH_N * 3);
  private cum = new Float32Array(PATH_N + 1);
  private total = 1;
  private s = 0;
  private songT = 25;
  private blowT = 12;
  private rising = false;
  private frames: Frame[] = [];
  private spine = new Float32Array(SPN * 3 * 4);
  private spineTex: THREE.DataTexture;
  private uni: Uni;
  private body: THREE.Mesh;
  private finR: THREE.Mesh;
  private finL: THREE.Mesh;
  private fluke: THREE.Mesh;
  private dorsal: THREE.Mesh;
  private tend: Tendril[] = [];
  private ribbon: THREE.Mesh;
  private rPos: THREE.BufferAttribute;
  private rTan: THREE.BufferAttribute;
  private pts: THREE.Points;
  private ptsMat = makePointsMaterial(true);
  private ppos: THREE.BufferAttribute;
  private psize: THREE.BufferAttribute;
  private spore = { head: 0, acc: 0, age: new Float32Array(SPORES), vel: new Float32Array(SPORES * 3) };
  private blow = { head: 0, age: new Float32Array(BLOW), vel: new Float32Array(BLOW * 3) };
  private mist: THREE.Points;
  private mistMat = mistMaterial();
  private mPos: THREE.BufferAttribute;
  private mSize: THREE.BufferAttribute;
  private mA: THREE.BufferAttribute;
  private sc = { x: 0, y: 0 };
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private fc = new THREE.Vector3();
  private fs = new THREE.Vector3();
  private fu = new THREE.Vector3();
  private ft = new THREE.Vector3();
  private m1 = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();

  constructor(quality: Quality) {
    const hq = quality !== 'low';
    for (let i = 0; i < SPN; i++) this.frames.push({ c: new THREE.Vector3(), t: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0), r: R0 * prof(i / (SPN - 1)) });
    this.spineTex = new THREE.DataTexture(this.spine, SPN, 3, THREE.RGBAFormat, THREE.FloatType);
    this.spineTex.minFilter = this.spineTex.magFilter = THREE.NearestFilter;
    this.spineTex.generateMipmaps = false;
    this.spineTex.needsUpdate = true;
    this.uni = { uSpine: { value: this.spineTex }, uPulse: { value: 0 }, uTime: U.uTime, uNight: U.uNight };

    // body: a grid of (u, angle) pairs, denser toward nose and tail; the vertex shader does the rest
    const nu = hq ? 300 : 150, nv = hq ? 84 : 44, P = new Float32Array((nu + 1) * (nv + 1) * 3), idx: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const u = 0.5 - 0.5 * Math.cos((Math.PI * i) / nu);
      for (let j = 0; j <= nv; j++) { const k = (i * (nv + 1) + j) * 3; P[k] = u; P[k + 1] = (j / nv) * TAU; }
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + 1, d = a + nv + 1, e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(P, 3));
    bg.setIndex(idx);
    this.body = new THREE.Mesh(bg, bodyMaterial(this.uni, hq));
    this.body.customDepthMaterial = bodyDepthMaterial(this.uni);
    this.body.frustumCulled = false;
    this.body.castShadow = this.body.receiveShadow = true;

    const flip = loft(FLIPPER), finMat = finMaterial(this.uni, 88, 20);
    this.finR = new THREE.Mesh(flip, finMat);
    this.finL = new THREE.Mesh(flip, finMat);
    this.fluke = new THREE.Mesh(loft(FLUKE), finMaterial(this.uni, 58, 0));
    this.dorsal = new THREE.Mesh(dorsalGeo(), finMaterial(this.uni, 11, 0, 1));
    for (const m of [this.finR, this.finL, this.fluke, this.dorsal]) { m.matrixAutoUpdate = false; m.frustumCulled = false; m.castShadow = true; }

    // the garden: stalks crowd the back on either side of the glowing spine line
    const rand = mulberry32(911), nG = hq ? 320 : 140;
    const inst = new Float32Array(nG * 4), col = new Float32Array(nG * 3), cc = new THREE.Color();
    const palette = ['#ffd36a', '#ff7ae6', '#7ffcff', '#b8ff5a', '#ffb07a'];
    for (let i = 0; i < nG; i++) {
      const sideA = rand() < 0.5 ? -1 : 1, a = sideA * (0.16 + Math.pow(rand(), 1.4) * 0.75);
      inst.set([0.14 + rand() * 0.56, a, 1.5 + Math.pow(rand(), 2) * 6.5, rand() * TAU], i * 4);
      cc.set(palette[(rand() * palette.length) | 0]).toArray(col, i * 3);
    }
    const sg = stalkGeo(hq), ig = new THREE.InstancedBufferGeometry();
    ig.index = sg.index;
    for (const k of ['position', 'normal', 'aBulb']) ig.setAttribute(k, sg.getAttribute(k));
    ig.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
    ig.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
    ig.instanceCount = nG;
    const garden = new THREE.Mesh(ig, gardenMaterial(this.uni));
    garden.frustumCulled = false;

    // tendrils: ribbons whose points are simulated on the CPU
    const nT = hq ? 34 : 18;
    for (let i = 0; i < nT; i++) this.tend.push({ u: 0.12 + rand() * 0.5, th: -Math.PI / 2 + (rand() - 0.5) * 1.7, len: 45 + rand() * 70, ph: rand() * TAU, tilt: 0.75 + rand() * 0.35, p: new Float32Array(SEG * 3) });
    const nRV = nT * SEG * 2, edge = new Float32Array(nRV), along = new Float32Array(nRV), seed = new Float32Array(nRV), ridx: number[] = [];
    for (let t = 0; t < nT; t++) {
      const sd = rand();
      for (let i = 0; i < SEG; i++) {
        const k = (t * SEG + i) * 2;
        edge[k] = -1; edge[k + 1] = 1; along[k] = along[k + 1] = i / (SEG - 1); seed[k] = seed[k + 1] = sd;
        if (i < SEG - 1) ridx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const rg = new THREE.BufferGeometry();
    this.rPos = new THREE.BufferAttribute(new Float32Array(nRV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.rTan = new THREE.BufferAttribute(new Float32Array(nRV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('position', this.rPos);
    rg.setAttribute('aTan', this.rTan);
    rg.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    rg.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    rg.setIndex(ridx);
    this.ribbon = new THREE.Mesh(rg, ribbonMaterial(this.uni));
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 4;

    // glowing points: lures on the tendrils, drifting spores, the exhaled spout
    const np = nT * 2 + SPORES, pc = new Float32Array(np * 3), ps = new Float32Array(np), ph = new Float32Array(np);
    const cyan = new THREE.Color('#5ff2d6'), gold = new THREE.Color('#ffd36a'), violet = new THREE.Color('#b18cff');
    for (let i = 0; i < np; i++) {
      ph[i] = rand();
      if (i < nT * 2) { (i % 2 ? violet : cyan).toArray(pc, i * 3); ps[i] = i % 2 ? 4.5 : 2.6; }
      else cc.copy(cyan).lerp(gold, rand() * 0.6).toArray(pc, i * 3);
    }
    this.spore.age.fill(99); this.blow.age.fill(99);
    const pg = new THREE.BufferGeometry();
    this.ppos = new THREE.BufferAttribute(new Float32Array(np * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.psize = new THREE.BufferAttribute(ps, 1).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('position', this.ppos);
    pg.setAttribute('aSize', this.psize);
    pg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    pg.setAttribute('aColor', new THREE.BufferAttribute(pc, 3));
    this.ptsMat.uniforms.uDrift.value = 0.4;
    this.ptsMat.uniforms.uBlink.value = 0.5;
    this.ptsMat.uniforms.uFar.value = 0.00025;
    this.pts = new THREE.Points(pg, this.ptsMat);
    this.pts.frustumCulled = false;
    const mg = new THREE.BufferGeometry();
    this.mPos = new THREE.BufferAttribute(new Float32Array(BLOW * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mSize = new THREE.BufferAttribute(new Float32Array(BLOW), 1).setUsage(THREE.DynamicDrawUsage);
    this.mA = new THREE.BufferAttribute(new Float32Array(BLOW), 1).setUsage(THREE.DynamicDrawUsage);
    mg.setAttribute('position', this.mPos);
    mg.setAttribute('aSize', this.mSize);
    mg.setAttribute('aA', this.mA);
    this.mist = new THREE.Points(mg, this.mistMat);
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 5;

    this.group.add(this.body, this.finL, this.finR, this.fluke, this.dorsal, garden, this.ribbon, this.pts, this.mist);
  }

  /**
   * Lay out a figure-eight over the world, turned by the seed, and lift it smoothly over floating
   * isles and the Elder Tree so the whale never swims through rock.
   */
  build(seed: number, T: Terrain, isles: [number, number, number, number][], elder: [number, number, number]) {
    const rand = mulberry32(seed * 7 + 3), rot = rand() * TAU, cr = Math.cos(rot), sr = Math.sin(rot);
    const ax = 640, az = 440, ys = new Float32Array(PATH_N);
    const tall = [...isles.map(([x, y, z, R]) => [x, z, R + R0 + 30, y + R * 0.35] as const), [elder[0], elder[2], 150, elder[1] + 215] as const];
    for (let i = 0; i < PATH_N; i++) {
      const a = (i / PATH_N) * TAU, lx = ax * Math.sin(a), lz = az * Math.sin(2 * a);
      const x = lx * cr - lz * sr, z = lx * sr + lz * cr;
      let y = Math.max(250 + 35 * Math.sin(3 * a + 1), T.surface(x, z) + 150);
      for (const [ix, iz, rr, top] of tall) if (Math.hypot(x - ix, z - iz) < rr) y = Math.max(y, top + R0 + 45);
      this.path[i * 3] = x; this.path[i * 3 + 2] = z; ys[i] = y;
    }
    // max filter then blur along the loop: climbs start early and stay above every obstacle
    const W = 160, mx = new Float32Array(PATH_N);
    for (let i = 0; i < PATH_N; i++) { let m = -1e9; for (let k = -W; k <= W; k += 4) m = Math.max(m, ys[(i + k + PATH_N) % PATH_N]); mx[i] = m; }
    for (let i = 0; i < PATH_N; i++) { let s = 0, c = 0; for (let k = -W; k <= W; k += 4) { s += mx[(i + k + PATH_N) % PATH_N]; c++; } this.path[i * 3 + 1] = s / c; }
    this.cum[0] = 0;
    for (let i = 0; i < PATH_N; i++) {
      const j = (i + 1) % PATH_N;
      this.cum[i + 1] = this.cum[i] + Math.hypot(this.path[j * 3] - this.path[i * 3], this.path[j * 3 + 1] - this.path[i * 3 + 1], this.path[j * 3 + 2] - this.path[i * 3 + 2]);
    }
    this.total = this.cum[PATH_N];
    this.s = rand() * this.total;
    this.songT = 20 + rand() * 15;
    this.blowT = 8 + rand() * 10;
    this.pulse = 0;
    this.spore.age.fill(99);
    this.blow.age.fill(99);
    this.layout(U.uTime.value);
  }

  /** Point and unit tangent on the loop at arc length s. */
  private at(s: number, out: THREE.Vector3) {
    s = ((s % this.total) + this.total) % this.total;
    let lo = 0, hi = PATH_N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const i = lo, j = (i + 1) % PATH_N, f = (s - this.cum[i]) / Math.max(this.cum[i + 1] - this.cum[i], 1e-6), P = this.path;
    out.set(P[i * 3] + (P[j * 3] - P[i * 3]) * f, P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * f, P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * f);
  }

  /** Lay the spine along the path with a slow vertical swimming wave, and upload it for the shaders. */
  private layout(t: number) {
    const F = this.frames;
    for (let i = 0; i < SPN; i++) {
      const u = i / (SPN - 1), f = F[i];
      this.at(this.s - u * LEN, f.c);
      f.c.y += (2 + 12 * u * u) * Math.sin(t * 0.55 - u * 5.2);
    }
    for (let i = 0; i < SPN; i++) {
      const f = F[i];
      f.t.subVectors(F[Math.max(0, i - 1)].c, F[Math.min(SPN - 1, i + 1)].c).normalize();
      f.side.crossVectors(f.t, UP).normalize();
      f.up.crossVectors(f.side, f.t).normalize();
      const D = this.spine;
      for (const [row, v] of [[0, f.c], [1, f.side], [2, f.up]] as const) { const k = (row * SPN + i) * 4; D[k] = v.x; D[k + 1] = v.y; D[k + 2] = v.z; }
    }
    this.spineTex.needsUpdate = true;
  }

  /** Interpolated frame at u into fc/fs/fu/ft. */
  private frame(u: number) {
    const x = clamp(u, 0, 1) * (SPN - 1), i = Math.min(SPN - 2, Math.floor(x)), f = x - i, a = this.frames[i], b = this.frames[i + 1];
    this.fc.lerpVectors(a.c, b.c, f); this.fs.lerpVectors(a.side, b.side, f).normalize();
    this.fu.lerpVectors(a.up, b.up, f).normalize(); this.ft.lerpVectors(a.t, b.t, f).normalize();
  }

  /** A point on the skin at (u, th), pulled `inset` metres toward the spine. */
  private surf(u: number, th: number, out: THREE.Vector3, inset = 0) {
    this.frame(u);
    const q = sect(u, th, this.sc), l = Math.hypot(q.x, q.y), k = l > 1e-3 ? Math.max(0, 1 - inset / l) : 0;
    return out.copy(this.fc).addScaledVector(this.fs, q.x * k).addScaledVector(this.fu, q.y * k);
  }

  /** Body frame at u (0 head, 1 tail): the nearest spine sample. */
  frameAt(u: number) { return this.frames[Math.round(clamp(u, 0, 1) * (SPN - 1))]; }

  /** Heading of the whale (unit vector). */
  get dir() { return this.frames[0].t; }

  /** A point near the front of the body, for markers and the compass. */
  get center() { return this.frames[Math.round((SPN - 1) * 0.2)].c; }

  /** Nearest spine sample to p: its frame and the distance from the skin (negative inside). */
  nearest(p: THREE.Vector3) {
    let best = this.frames[0], bd = Infinity;
    for (let i = 0; i < SPN; i += 2) { const f = this.frames[i], d = f.c.distanceTo(p) - f.r; if (d < bd) { bd = d; best = f; } }
    return { frame: best, skin: bd };
  }

  /** Orient a fin: x along the span (mirrored for the left side), y up, z forward, then roll, sweep and pitch. */
  private place(m: THREE.Mesh, at: THREE.Vector3, mirror: number, roll: number, yaw: number, pitch: number) {
    this.v2.copy(this.fs).multiplyScalar(mirror);
    m.matrix.makeBasis(this.v2, this.fu, this.ft)
      .multiply(this.m1.makeRotationY(yaw))
      .multiply(this.m2.makeRotationZ(roll))
      .multiply(this.m1.makeRotationX(pitch))
      .setPosition(at);
    m.matrixWorldNeedsUpdate = true;
  }

  update(dt: number, t: number, glow: number, scale: number) {
    this.s += this.speed * dt;
    // song timer and the light swell after it
    this.songT -= dt;
    this.sang = false;
    if (this.songT < 0) { this.songT = 60 + Math.random() * 25; this.sang = true; this.rising = true; this.blowT = 0; }
    if (this.rising) { this.pulse = Math.min(1, this.pulse + dt * 0.8); if (this.pulse >= 1) this.rising = false; }
    else this.pulse *= Math.exp(-dt * 0.35);
    this.uni.uPulse.value = this.pulse;

    this.layout(t);

    // flippers row slowly and flex at the tips; flukes beat with the body wave
    const row = Math.sin(t * 0.5), beat = Math.cos(t * 0.55 - 5.2);
    (this.finR.material as THREE.Material).userData.bend.value = 0.28 * Math.cos(t * 0.5 + 0.6);
    (this.fluke.material as THREE.Material).userData.bend.value = 0.35 * beat;
    for (const mirror of [1, -1]) {
      this.surf(0.24, mirror > 0 ? -0.42 : Math.PI + 0.42, this.v1, 3);
      this.place(mirror > 0 ? this.finR : this.finL, this.v1, mirror, -0.45 + 0.2 * row, -0.12, 0.06);
    }
    this.frame(0.972);
    this.place(this.fluke, this.v1.copy(this.fc), 1, 0, 0, 0.18 * beat);
    this.surf(0.67, Math.PI / 2, this.v1, 0.6);
    this.place(this.dorsal, this.v1, 1, 0, 0, 0);

    this.stepTendrils(t);
    this.stepParticles(dt, t, glow, scale);

    this.spheres.length = 0;
    for (let i = 2; i < SPN; i += 4) { const f = this.frames[i]; this.spheres.push([f.c.x, f.c.y, f.c.z, f.r * 0.98]); }
    // flippers and flukes are solid too: a few spheres down each span, sized to the local chord
    const fin = (m: THREE.Mesh, o: Loft, at: number[], sign: number) => {
      for (const sp of at) {
        const ch = o.chord(sp);
        this.v1.set(sign * sp * o.span, o.drop(sp), o.lead(sp) - ch * 0.5).applyMatrix4(m.matrix);
        this.spheres.push([this.v1.x, this.v1.y, this.v1.z, ch * 0.42]);
      }
    };
    fin(this.finR, FLIPPER, [0.25, 0.48, 0.7, 0.88], 1);
    fin(this.finL, FLIPPER, [0.25, 0.48, 0.7, 0.88], 1);
    fin(this.fluke, FLUKE, [0.2, 0.5, 0.8], 1);
    fin(this.fluke, FLUKE, [0.2, 0.5, 0.8], -1);
  }

  /**
   * Tendrils trail back and down along the path the whale has just swum, so they curve through its
   * turns the same way at any frame rate, with a slow sway and bob layered on top.
   */
  private stepTendrils(t: number) {
    const R = this.rPos.array as Float32Array, TN = this.rTan.array as Float32Array, here = this.v2, back = this.v3;
    for (const td of this.tend) {
      const P = td.p, seg = td.len / (SEG - 1), sRoot = this.s - td.u * LEN, ca = Math.cos(td.tilt), sa = Math.sin(td.tilt);
      this.surf(td.u, td.th, this.v1, 0.4);
      this.at(sRoot, here);
      for (let i = 0; i < SEG; i++) {
        const d = i * seg, w = i / (SEG - 1), k = i * 3;
        this.at(sRoot - d * ca, back);
        const sway = Math.sin(t * 0.7 + td.ph + i * 0.25) * Math.pow(w, 1.5) * 4, bob = Math.sin(t * 1.1 + td.ph * 2 + i * 0.4) * w * 1.5;
        P[k] = this.v1.x + back.x - here.x + this.fs.x * sway;
        P[k + 1] = this.v1.y + back.y - here.y - d * sa + bob;
        P[k + 2] = this.v1.z + back.z - here.z + this.fs.z * sway;
      }
    }
    // write ribbons: both edges of a point share its centre and tangent; the shader spreads them
    this.tend.forEach((td, ti) => {
      const P = td.p;
      for (let i = 0; i < SEG; i++) {
        const k = i * 3, a = Math.max(0, i - 1) * 3, b = Math.min(SEG - 1, i + 1) * 3;
        const tx = P[b] - P[a], ty = P[b + 1] - P[a + 1], tz = P[b + 2] - P[a + 2], tl = Math.hypot(tx, ty, tz) || 1;
        for (let e = 0; e < 2; e++) {
          const v = ((ti * SEG + i) * 2 + e) * 3;
          R[v] = P[k]; R[v + 1] = P[k + 1]; R[v + 2] = P[k + 2];
          TN[v] = tx / tl; TN[v + 1] = ty / tl; TN[v + 2] = tz / tl;
        }
      }
    });
    this.rPos.needsUpdate = this.rTan.needsUpdate = true;
  }

  private stepParticles(dt: number, t: number, glow: number, scale: number) {
    const PP = this.ppos.array as Float32Array, S = this.psize.array as Float32Array, nT = this.tend.length;
    // a bright lure at the end of each tendril and a soft one part-way down
    this.tend.forEach((td, i) => {
      const tip = (SEG - 1) * 3, mid = Math.round(SEG * 0.55) * 3;
      PP.set([td.p[tip], td.p[tip + 1], td.p[tip + 2]], i * 2 * 3);
      PP.set([td.p[mid], td.p[mid + 1], td.p[mid + 2]], (i * 2 + 1) * 3);
      S[i * 2] = 2.6 + Math.sin(t * 2 + td.ph) * 0.8;
    });
    // spores drift off the flanks and the tail stock
    const sp = this.spore, sp0 = nT * 2;
    for (sp.acc += dt * 26; sp.acc >= 1; sp.acc--) {
      const i = sp.head = (sp.head + 1) % SPORES, k = (sp0 + i) * 3;
      this.surf(0.3 + Math.random() * 0.62, Math.random() * TAU, this.v1);
      PP[k] = this.v1.x; PP[k + 1] = this.v1.y; PP[k + 2] = this.v1.z;
      sp.vel[i * 3] = (Math.random() - 0.5) * 3; sp.vel[i * 3 + 1] = -1.2 - Math.random() * 2.2; sp.vel[i * 3 + 2] = (Math.random() - 0.5) * 3;
      sp.age[i] = 0;
    }
    for (let i = 0; i < SPORES; i++) {
      const k = (sp0 + i) * 3, a = (sp.age[i] += dt);
      if (a > 14) { S[sp0 + i] = 0; continue; }
      PP[k] += sp.vel[i * 3] * dt; PP[k + 1] += sp.vel[i * 3 + 1] * dt; PP[k + 2] += sp.vel[i * 3 + 2] * dt;
      S[sp0 + i] = 2.4 * Math.min(1, a * 2) * (1 - a / 14);
    }
    // now and then (and with every song) it exhales a glowing spout from its blowholes
    this.blowT -= dt;
    const bl = this.blow, MP = this.mPos.array as Float32Array, MS = this.mSize.array as Float32Array, MA = this.mA.array as Float32Array;
    if (this.blowT < 0) {
      this.blowT = 28 + Math.random() * 20;
      this.frame(0.15);
      for (let n = 0; n < BLOW; n++) {
        const i = bl.head = (bl.head + 1) % BLOW, k = i * 3, sd = n % 2 ? 1 : -1;
        this.surf(0.15, Math.PI / 2 + sd * 0.03, this.v1);
        MP[k] = this.v1.x; MP[k + 1] = this.v1.y; MP[k + 2] = this.v1.z;
        const up = 22 + Math.random() * 24, sw = (Math.random() - 0.5) * 13;
        this.v2.copy(this.fu).multiplyScalar(up).addScaledVector(this.fs, sw + sd * 3).addScaledVector(this.ft, this.speed * 0.9 + (Math.random() - 0.5) * 9);
        bl.vel.set([this.v2.x, this.v2.y, this.v2.z], i * 3);
        bl.age[i] = -Math.random() * 0.9;
      }
    }
    for (let i = 0; i < BLOW; i++) {
      const k = i * 3, a = (bl.age[i] += dt);
      if (a < 0 || a > 7) { MA[i] = 0; continue; }
      // the plume slows, spreads and swells into mist as it rises
      const drag = Math.exp(-0.65 * dt), spread = 1 + dt * 0.7;
      bl.vel[i * 3] = bl.vel[i * 3] * drag * spread; bl.vel[i * 3 + 1] = bl.vel[i * 3 + 1] * drag - 2.5 * dt; bl.vel[i * 3 + 2] = bl.vel[i * 3 + 2] * drag * spread;
      MP[k] += bl.vel[i * 3] * dt; MP[k + 1] += bl.vel[i * 3 + 1] * dt; MP[k + 2] += bl.vel[i * 3 + 2] * dt;
      MS[i] = 6 + a * 3.2;
      MA[i] = 0.1 * Math.min(1, a * 2.5) * Math.pow(1 - a / 7, 1.6);
    }
    this.ppos.needsUpdate = this.psize.needsUpdate = true;
    this.mPos.needsUpdate = this.mSize.needsUpdate = this.mA.needsUpdate = true;
    this.mistMat.uniforms.uScale.value = scale;
    this.mistMat.uniforms.uInt.value = 0.7 + glow * 0.9 + this.pulse * 1.2;
    this.ptsMat.uniforms.uScale.value = scale;
    this.ptsMat.uniforms.uInt.value = 0.55 + glow * 1.1 + this.pulse * 1.6;
  }

  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.spineTex.dispose();
  }
}
