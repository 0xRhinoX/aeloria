import * as THREE from 'three';
import { BlendFunction, BloomEffect, DepthOfFieldEffect, Effect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';

/** Exposure, ACES tone mapping, saturation, a lift toward warm highlights and a soft vignette in one pass. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', `
uniform float exposure;uniform float saturation;uniform float vignette;uniform vec3 lift;
vec3 rrt(vec3 v){vec3 a=v*(v+.0245786)-.000090537;vec3 b=v*(.983729*v+.4329510)+.238081;return a/b;}
vec3 aces(vec3 c){
  const mat3 I=mat3(vec3(.59719,.07600,.02840),vec3(.35458,.90834,.13383),vec3(.04823,.01566,.83777));
  const mat3 O=mat3(vec3(1.60475,-.10208,-.00327),vec3(-.53108,1.10813,-.07276),vec3(-.07367,-.00605,1.07602));
  return clamp(O*rrt(I*(c/.6)),0.,1.);
}
void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){
  vec3 c=aces(inputColor.rgb*exposure);
  float l=dot(c,vec3(.2126,.7152,.0722));
  c=mix(vec3(l),c,saturation);
  c+=lift*(1.-c)*c;
  vec2 d=uv-.5;
  c*=1.-vignette*dot(d,d)*1.9;
  outputColor=vec4(c,inputColor.a);
}`, {
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1.08)],
        ['vignette', new THREE.Uniform(0.35)],
        ['lift', new THREE.Uniform(new THREE.Vector3(0.03, 0.02, 0))],
      ]),
    });
  }
  set exposure(v: number) { this.uniforms.get('exposure')!.value = v; }
  set saturation(v: number) { this.uniforms.get('saturation')!.value = v; }
}

/** HDR render → depth of field (photo mode) → bloom + grade. */
export class Post {
  composer: EffectComposer;
  bloom: BloomEffect;
  grade = new GradeEffect();
  dof: DepthOfFieldEffect;
  dofPass: EffectPass;
  private size = new THREE.Vector2();
  private pr = 0;

  constructor(private gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, msaa: number) {
    this.composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling: msaa });
    this.composer.addPass(new RenderPass(scene, camera));
    this.dof = new DepthOfFieldEffect(camera, { focusRange: 0.02, bokehScale: 3.2, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);
    this.bloom = new BloomEffect({ blendFunction: BlendFunction.ADD, mipmapBlur: true, luminanceThreshold: 0.9, luminanceSmoothing: 0.3, intensity: 1, radius: 0.72, levels: 7 });
    this.composer.addPass(new EffectPass(camera, this.bloom, this.grade));
    gl.getSize(this.size);
    this.composer.setSize(this.size.x, this.size.y, false);
  }

  set msaa(n: number) { this.composer.multisampling = n; }

  /** Focus on a world distance; enables depth of field while photo mode is on. */
  focus(on: boolean, dist: number) {
    this.dofPass.enabled = on;
    if (on) { this.dof.cocMaterial.worldFocusDistance = dist; this.dof.cocMaterial.worldFocusRange = Math.max(6, dist * 0.35); }
  }

  render(dt: number) {
    const s = this.gl.getSize(new THREE.Vector2()), pr = this.gl.getPixelRatio();
    if (s.x !== this.size.x || s.y !== this.size.y || pr !== this.pr) {
      this.size.copy(s);
      this.pr = pr;
      this.composer.setSize(s.x, s.y, false);
    }
    this.composer.render(dt);
  }

  dispose() { this.composer.dispose(); }
}
