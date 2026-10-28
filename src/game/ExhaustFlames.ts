import { vehicleModelRoot } from "./Vehicles";
import {
  AdditiveBlending,
  Box3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  Object3D,
  PointLight,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import type { VehicleDefinition, VehicleId } from "./Vehicles";
import { ExhaustTrail, type ExhaustEmission } from "./ExhaustTrail";

// Each engine has its own palette, jet shape and combustion rhythm.
export const FLAME_PROFILES = {
  sparrow: {
    core: 0xffb343,
    hot: 0xffebae,
    tip: 0xff5b12,
    length: 0.66,
    width: 1.45,
    taper: 0.5,
    pulse: 11,
    flutter: 14,
    wobble: 0.22,
    diamonds: 0,
  },
  scarlet: {
    core: 0x428aff,
    hot: 0xfff1b8,
    tip: 0xff4b0c,
    length: 1.15,
    width: 1.3,
    taper: 0.7,
    pulse: 19,
    flutter: 27,
    wobble: 0.1,
    diamonds: 0,
  },
  formula: {
    core: 0x1c78ff,
    hot: 0xb9e5ff,
    tip: 0x985cff,
    length: 1.45,
    width: 0.95,
    taper: 1.15,
    pulse: 28,
    flutter: 38,
    wobble: 0.035,
    diamonds: 1,
  },
  targa: {
    core: 0x81c6ff,
    hot: 0xffe2ae,
    tip: 0xff7d2e,
    length: 0.95,
    width: 1.1,
    taper: 0.65,
    pulse: 16,
    flutter: 21,
    wobble: 0.16,
    diamonds: 0,
  },
  suv: {
    core: 0xffc45c,
    hot: 0xffdc8a,
    tip: 0xf43b0a,
    length: 0.8,
    width: 1.95,
    taper: 0.4,
    pulse: 8,
    flutter: 11,
    wobble: 0.27,
    diamonds: 0,
  },
} satisfies Record<
  VehicleId,
  {
    core: number;
    hot: number;
    tip: number;
    length: number;
    width: number;
    taper: number;
    pulse: number;
    flutter: number;
    wobble: number;
    diamonds: number;
  }
>;

export type ExhaustState = {
  active: boolean;
  throttle?: number;
  boosting?: boolean;
  braking: boolean;
  reversing: boolean;
  handbrake?: boolean;
  rpm: number;
  speed?: number;
  velocity?: Vector3;
  /** Physical chassis yaw velocity in radians per second, independent of steering keys. */
  yawRate?: number;
  viewportHeight?: number;
};

/** Small procedural jets attached to the real mouths, following chassis pitch. */
export class ExhaustFlames {
  readonly jets: {
    root: Group;
    flame: Mesh<CylinderGeometry, ShaderMaterial>;
    light: PointLight;
    bend: Vector2;
    bendVelocity: Vector2;
    length: number;
    flow: Vector3[];
  }[] = [];
  intensity = 0;
  private elapsed = 0;
  readonly profile: (typeof FLAME_PROFILES)[VehicleId];
  readonly trail: ExhaustTrail;

  constructor(
    private model: Object3D,
    vehicle: VehicleDefinition,
  ) {
    this.profile = FLAME_PROFILES[vehicle.id];
    const profile = this.profile;
    const root = vehicleModelRoot(model);
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    this.trail = new ExhaustTrail(root, profile);
    for (const [i, outlet] of vehicle.exhausts.entries()) {
      const mouth = model.getObjectByName(outlet.node);
      if (!mouth)
        throw new Error(`车辆排气口缺少节点：${vehicle.id}/${outlet.node}`);
      const bounds = new Box3().setFromObject(mouth).applyMatrix4(inverse);
      const direction = new Vector3(1, 0, 0);
      if (outlet.direction) direction.set(...outlet.direction).normalize();
      else if (outlet.tilted) {
        direction
          .set(0, 1, 0)
          .applyQuaternion(mouth.getWorldQuaternion(new Quaternion()))
          .applyQuaternion(root.getWorldQuaternion(new Quaternion()).invert())
          .normalize();
        if (direction.x < 0) direction.negate();
      }
      const jet = new Group();
      jet.name = `EXHAUST_FLAME_${i}`;
      jet.userData.runtime_feedback = true;
      jet.position.copy(bounds.getCenter(new Vector3()));
      if (!outlet.tilted && !outlet.direction) jet.position.x = bounds.max.x;
      jet.position.addScaledVector(direction, 0.008);
      jet.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), direction);
      const material = new ShaderMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        side: DoubleSide,
        uniforms: {
          time: { value: 0 },
          strength: { value: 0 },
          seed: { value: i * 2.37 },
          coreColor: { value: new Color(profile.core) },
          hotColor: { value: new Color(profile.hot) },
          tipColor: { value: new Color(profile.tip) },
          taperPower: { value: profile.taper },
          flutterRate: { value: profile.flutter },
          wobble: { value: profile.wobble },
          diamonds: { value: profile.diamonds },
          radius: {
            value: new Vector2(
              outlet.radius * profile.width,
              outlet.radius * profile.width,
            ),
          },
          flow: {
            value: Array.from(
              { length: 12 },
              (_, n) => new Vector3(0, 0, n / 11),
            ),
          },
        },
        vertexShader: `varying vec2 flameUv; varying float flameDistance;
          uniform float time; uniform float seed;
          uniform float taperPower; uniform float flutterRate; uniform float wobble;
          uniform vec2 radius; uniform vec3 flow[12];
          void main() {
            flameUv=uv;
            vec3 p=position;
            float t=p.z;
            flameDistance=t;
            float taper=pow(max(0.0,1.0-t),taperPower)*(0.65+0.45*sin(t*3.14159));
            float ripple=1.0+(0.06+wobble*0.4)*sin(t*31.0-time*flutterRate+seed)+0.07*sin(uv.x*25.13+time*17.0);
            float sampleIndex=t*11.0;
            int index=int(min(10.0,floor(sampleIndex)));
            float alpha=sampleIndex-float(index);
            vec3 centre=mix(flow[index],flow[index+1],alpha);
            vec3 tangent=normalize(flow[index+1]-flow[index]+vec3(0.0,0.0,0.000001));
            vec3 right=normalize(cross(vec3(0.0,1.0,0.0001),tangent));
            vec3 normal=normalize(cross(tangent,right));
            // Only the surface flickers. Its centre follows the same gas as the sprites.
            p=centre+(right*p.x*radius.x+normal*p.y*radius.y)*taper*ripple;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
          }`,
        fragmentShader: `varying vec2 flameUv; varying float flameDistance;
          uniform float time; uniform float strength; uniform float seed;
          uniform vec3 coreColor; uniform vec3 hotColor; uniform vec3 tipColor;
          uniform float diamonds;
          void main() {
            // Use the actual nozzle-to-tip distance, independent of UV direction.
            float t=flameDistance;
            float streak=0.72+0.28*sin(flameUv.x*25.13+t*22.0-time*19.0+seed);
            float fade=pow(max(0.0,1.0-t),0.8)*smoothstep(0.0,0.05,t);
            vec3 color=mix(coreColor,hotColor,smoothstep(0.02,0.30,t));
            color=mix(color,tipColor,smoothstep(0.30,0.9,t));
            float bands=mix(1.0,0.78+0.22*cos(t*58.0-time*2.0),diamonds);
            gl_FragColor=vec4(color*1.7,fade*streak*bands*strength*0.9);
            #include <colorspace_fragment>
          }`,
      });
      const geometry = new CylinderGeometry(1, 1, 1, 12, 10, true)
        .translate(0, 0.5, 0)
        .rotateX(Math.PI / 2);
      const flame = new Mesh(geometry, material);
      flame.name = `EXHAUST_JET_${i}`;
      flame.renderOrder = 5;
      flame.frustumCulled = false;
      // A soft filled core keeps the jet readable when looking into the pipe.
      const core = new Mesh(
        new CircleGeometry(outlet.radius * 0.83, 20),
        new ShaderMaterial({
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          toneMapped: false,
          side: DoubleSide,
          uniforms: {
            strength: material.uniforms.strength,
            coreColor: material.uniforms.coreColor,
            hotColor: material.uniforms.hotColor,
          },
          vertexShader: `varying vec2 coreUv; void main(){coreUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
          fragmentShader: `varying vec2 coreUv; uniform float strength; uniform vec3 coreColor; uniform vec3 hotColor;
          void main(){ float r=length((coreUv-0.5)*2.0); float glow=pow(max(0.0,1.0-r*r),1.5);
            gl_FragColor=vec4(mix(hotColor,coreColor,r)*1.6,glow*strength);
            #include <colorspace_fragment>
          }`,
        }),
      );
      core.name = `EXHAUST_CORE_${i}`;
      core.position.z = 0.025;
      core.renderOrder = 5;
      const light = new PointLight(profile.tip, 0, 1.8, 2);
      light.position.z = 0.12;
      light.castShadow = false;
      jet.add(flame, core);
      jet.visible = false;
      // Keep the zero-intensity light in the scene even when the jet is hidden.
      // Changing the light count on the first throttle recompiles the car and
      // track shaders, which used to stall the first launch for several seconds.
      jet.updateMatrix();
      light.position.applyMatrix4(jet.matrix);
      root.add(jet, light);
      this.jets.push({
        root: jet,
        flame,
        light,
        bend: new Vector2(),
        bendVelocity: new Vector2(),
        length: 0.45 * profile.length,
        flow: material.uniforms.flow.value,
      });
    }
  }

  update(state: ExhaustState, dt: number) {
    this.model.updateWorldMatrix(true, true);
    this.elapsed += dt;
    const firing =
      state.active &&
      !state.braking &&
      !state.reversing &&
      !state.handbrake &&
      ((state.throttle ?? 0) > 0.05 || state.boosting === true);
    const rpm = MathUtils.clamp((state.rpm - 900) / 6000, 0, 1);
    // Throttle produces intermittent pops; actual boost sustains a longer jet.
    const pulse = Math.pow(
      Math.max(0, Math.sin(this.elapsed * this.profile.pulse)),
      3,
    );
    const target = firing
      ? state.boosting
        ? 1
        : (0.18 + 0.52 * pulse) * (0.5 + 0.5 * rpm) * (state.throttle ?? 0)
      : 0;
    this.intensity = state.active
      ? MathUtils.damp(this.intensity, target, firing ? 24 : 17, dt)
      : 0;
    const velocity = state.velocity ?? new Vector3();
    const speedStretch = 1 + Math.min(0.3, (state.speed ?? 0) * 0.006);
    const emissions: ExhaustEmission[] = [];
    const centre = this.model.getWorldPosition(new Vector3());
    this.jets.forEach((jet, i) => {
      const { root, flame, light, bend, bendVelocity } = jet;
      root.visible = this.intensity > 0.012;
      flame.material.uniforms.time.value = this.elapsed;
      flame.material.uniforms.strength.value = this.intensity;
      const flutter =
        0.92 + 0.08 * Math.sin(this.elapsed * this.profile.flutter + i * 2);
      jet.length =
        (0.15 + this.intensity * 0.95) *
        flutter *
        this.profile.length *
        speedStretch;
      const rotation = root.getWorldQuaternion(new Quaternion());
      const direction = new Vector3(0, 0, 1).applyQuaternion(rotation);
      const inverseRotation = rotation.clone().invert();
      const air = velocity.clone().negate().applyQuaternion(inverseRotation);
      // Hot gas resists the chassis' inward acceleration during a turn;
      // lateral slip adds cross-flow independently of the steering keys.
      const turning = new Vector3(0, state.yawRate ?? 0, 0)
        .cross(direction)
        .multiplyScalar(0.18 * jet.length)
        .applyQuaternion(inverseRotation);
      const targetBend = new Vector2(
        MathUtils.clamp(air.x * 0.022 + turning.x, -0.38, 0.38),
        MathUtils.clamp(air.y * 0.012 + turning.y + 0.025, -0.2, 0.24),
      );
      if (!state.active) {
        bend.set(0, 0);
        bendVelocity.set(0, 0);
      } else {
        const count = Math.max(1, Math.ceil(Math.min(dt, 0.05) / 0.008));
        const step = Math.min(dt, 0.05) / count;
        for (let n = 0; n < count; n++) {
          bendVelocity
            .addScaledVector(targetBend.clone().sub(bend), 90 * step)
            .multiplyScalar(Math.exp(-18 * step));
          bend.addScaledVector(bendVelocity, step);
        }
      }
      if (firing && this.intensity > 0.035) {
        const position = root.getWorldPosition(new Vector3());
        const pointVelocity = new Vector3(0, state.yawRate ?? 0, 0)
          .cross(position.clone().sub(centre))
          .add(velocity);
        emissions.push({
          position,
          direction,
          strength: this.intensity,
          outlet: i,
          velocity: pointVelocity,
          acceleration: new Vector3(bend.x, bend.y, 0)
            .applyQuaternion(rotation)
            .multiplyScalar(150),
        });
      }
      light.intensity = this.intensity * 1.5;
    });
    this.trail.update(
      dt,
      state.active,
      velocity,
      emissions,
      state.viewportHeight,
    );
    this.jets.forEach((jet, i) => {
      const samples = this.trail.sampleFlow(jet.root, i, jet.length);
      samples.forEach((point, n) => jet.flow[n].copy(point));
    });
  }
}
