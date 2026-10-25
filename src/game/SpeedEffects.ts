import { Mesh, PlaneGeometry, ShaderMaterial, MathUtils } from "three";

/** One transparent draw call; the centre stays clear for reading the road. */
export class SpeedEffects {
  readonly mesh: Mesh;
  intensity = 0;
  private previousSpeed = 0;
  private material: ShaderMaterial;
  constructor() {
    this.material = new ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        time: { value: 0 },
        amount: { value: 0 },
        boost: { value: 0 },
        aspect: { value: 1 },
      },
      vertexShader:
        "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
      fragmentShader: `varying vec2 vUv;uniform float time;uniform float amount;uniform float boost;uniform float aspect;
      float hash(float x){return fract(sin(x*91.73)*42317.15);}
      void main(){vec2 p=(vUv-vec2(.5,.56))*2.;p.x*=aspect;float radius=length(p);float angle=atan(p.y,p.x);
      float sectors=(angle+3.14159)/6.28318*84.;float sector=floor(sectors);float seed=hash(sector);float ray=pow(max(0.,1.-abs(fract(sectors)-.5)*2.),18.);
      float travel=fract(radius*(1.5+seed)-time*(2.+boost*2.5)+seed*8.);float streak=smoothstep(.68,.93,travel)*(1.-smoothstep(.93,1.,travel));
      float edges=smoothstep(.42,1.1,radius);float alpha=ray*streak*edges*amount*(.24+boost*.26)*step(.22,seed);
      gl_FragColor=vec4(mix(vec3(1.,.98,.84),vec3(.72,.95,.92),boost*.4),alpha);}`,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.mesh.visible = false;
  }
  update(
    dt: number,
    speed: number,
    boosting: boolean,
    active: boolean,
    aspect: number,
    reducedMotion: boolean,
  ) {
    const acceleration = (speed - this.previousSpeed) / Math.max(0.001, dt);
    this.previousSpeed = speed;
    const target = active
      ? Math.min(
          1,
          Math.max(0, (speed - 12) / 40) * 0.4 +
            Math.max(0, Math.min(8, acceleration) - 1) * 0.025 +
            (boosting ? 0.7 : 0),
        )
      : 0;
    this.intensity = MathUtils.damp(
      this.intensity,
      target,
      boosting ? 10 : 6,
      dt,
    );
    this.material.uniforms.amount.value =
      this.intensity * (reducedMotion ? 0.15 : 1);
    this.material.uniforms.boost.value = MathUtils.damp(
      this.material.uniforms.boost.value,
      boosting ? 1 : 0,
      6,
      dt,
    );
    this.material.uniforms.aspect.value = aspect;
    if (!reducedMotion) this.material.uniforms.time.value += dt;
    this.mesh.visible = this.intensity > 0.005;
  }
}
