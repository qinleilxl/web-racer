import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Object3D,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";

type Ember = {
  position: Vector3;
  velocity: Vector3;
  age: number;
  life: number;
  size: number;
  strength: number;
  outlet: number;
  acceleration: Vector3;
};
type Palette = {
  core: number;
  hot: number;
  tip: number;
  width: number;
  length: number;
};
export type ExhaustEmission = {
  position: Vector3;
  direction: Vector3;
  strength: number;
  outlet?: number;
  velocity?: Vector3;
  acceleration?: Vector3;
};

/** Detached hot gas keeps its world momentum instead of rotating with the car. */
export class ExhaustTrail {
  readonly particles: Ember[] = [];
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private carry = 0;
  private serial = 0;
  private previous?: Vector3;
  private readonly capacity = 96;

  constructor(
    private root: Object3D,
    private profile: Palette,
  ) {
    const geometry = new BufferGeometry();
    for (const [name, size] of [
      ["position", 3],
      ["age", 1],
      ["radius", 1],
      ["strength", 1],
    ] as const)
      geometry.setAttribute(
        name,
        new Float32BufferAttribute(this.capacity * size, size).setUsage(
          DynamicDrawUsage,
        ),
      );
    geometry.setDrawRange(0, 0);
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: AdditiveBlending,
      uniforms: {
        viewportHeight: { value: 720 },
        coreColor: { value: new Color(profile.core) },
        hotColor: { value: new Color(profile.hot) },
        tipColor: { value: new Color(profile.tip) },
      },
      vertexShader: `attribute float age; attribute float radius; attribute float strength;
        varying float gasAge; varying float gasStrength; uniform float viewportHeight;
        void main(){ gasAge=age;gasStrength=strength;vec4 p=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=clamp(radius*viewportHeight*projectionMatrix[1][1]/max(0.1,-p.z),1.0,80.0);
          gl_Position=projectionMatrix*p; }`,
      fragmentShader: `varying float gasAge; varying float gasStrength;
        uniform vec3 coreColor;uniform vec3 hotColor;uniform vec3 tipColor;
        void main(){ float r=length((gl_PointCoord-0.5)*2.0);float soft=pow(max(0.0,1.0-r*r),2.0);
          vec3 color=mix(coreColor,hotColor,smoothstep(0.0,0.3,gasAge));
          color=mix(color,tipColor,smoothstep(0.2,0.85,gasAge));
          gl_FragColor=vec4(color*1.4,soft*pow(1.0-gasAge,1.4)*gasStrength*0.55);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new Points(geometry, material);
    this.points.name = "EXHAUST_INERTIAL_TRAIL";
    this.points.userData.runtime_feedback = true;
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    root.add(this.points);
  }

  clear() {
    this.particles.length = 0;
    this.carry = 0;
    this.points.visible = false;
    this.points.geometry.setDrawRange(0, 0);
  }

  update(
    dt: number,
    active: boolean,
    velocity: Vector3,
    emissions: ExhaustEmission[],
    viewportHeight = 720,
  ) {
    const step = Math.min(0.05, Math.max(0, dt));
    const origin = this.root.getWorldPosition(new Vector3());
    // Reset/teleport must not leave a ribbon connecting two distant locations.
    if (
      !active ||
      (this.previous &&
        origin.distanceTo(this.previous) > 8 + velocity.length() * step * 2)
    )
      this.clear();
    this.previous = origin;
    if (!active) return;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += step;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      // Air drag removes inherited chassis momentum; hot gas rises and curls.
      p.velocity.multiplyScalar(Math.exp(-step * 3.5));
      p.velocity.addScaledVector(p.acceleration, step);
      p.velocity.y += step * 1.2;
      p.velocity.x += Math.sin(p.age * 31 + p.life * 91) * step * 0.8;
      p.velocity.z += Math.cos(p.age * 27 + p.life * 73) * step * 0.8;
      p.position.addScaledVector(p.velocity, step);
    }
    if (emissions.length) {
      this.carry += step * 105;
      const count = Math.floor(this.carry);
      this.carry -= count;
      for (let n = 0; n < count; n++)
        for (const source of emissions) {
          if (this.particles.length >= this.capacity) this.particles.shift();
          const noise = (Math.sin(++this.serial * 12.9898) + 1) * 0.5;
          this.particles.push({
            position: source.position.clone(),
            velocity: (source.velocity ?? velocity)
              .clone()
              .multiplyScalar(0.94)
              .addScaledVector(
                source.direction,
                (3 + 6 * source.strength) * this.profile.length,
              ),
            age: 0,
            life: 0.14 + noise * 0.1,
            size: (0.07 + noise * 0.035) * this.profile.width,
            strength: source.strength,
            outlet: source.outlet ?? 0,
            acceleration: source.acceleration?.clone() ?? new Vector3(),
          });
        }
    } else this.carry = 0;
    const inverse = this.root.matrixWorld.clone().invert();
    const geometry = this.points.geometry;
    this.particles.forEach((p, i) => {
      const local = p.position.clone().applyMatrix4(inverse);
      const age = p.age / p.life;
      geometry.attributes.position.setXYZ(i, local.x, local.y, local.z);
      geometry.attributes.age.setX(i, age);
      geometry.attributes.radius.setX(i, p.size * (0.75 + age * 0.9));
      geometry.attributes.strength.setX(i, p.strength);
    });
    Object.values(geometry.attributes).forEach((a) => {
      a.needsUpdate = true;
    });
    geometry.setDrawRange(0, this.particles.length);
    this.points.material.uniforms.viewportHeight.value = viewportHeight;
    this.points.visible = this.particles.length > 0;
  }

  /** Both the bright tube and residual sprites follow this one advected stream. */
  sampleFlow(nozzle: Object3D, outlet: number, length: number, count = 12) {
    nozzle.updateWorldMatrix(true, false);
    const origin = nozzle.getWorldPosition(new Vector3());
    const path = [origin];
    this.particles
      .filter((p) => p.outlet === outlet)
      .sort((a, b) => a.age - b.age)
      .forEach((p) => {
        if (p.position.distanceToSquared(path[path.length - 1]) > 1e-8)
          path.push(p.position);
      });
    const direction = new Vector3(0, 0, 1).transformDirection(
      nozzle.matrixWorld,
    );
    if (path.length > 1)
      direction
        .subVectors(path[path.length - 1], path[path.length - 2])
        .normalize();
    path.push(
      path[path.length - 1].clone().addScaledVector(direction, length + 0.1),
    );
    const inverse = nozzle.matrixWorld.clone().invert();
    const distances = [0];
    for (let i = 1; i < path.length; i++)
      distances.push(distances[i - 1] + path[i].distanceTo(path[i - 1]));
    const samples: Vector3[] = [];
    let segment = 0;
    for (let i = 0; i < count; i++) {
      const distance = (length * i) / (count - 1);
      while (segment < path.length - 2 && distances[segment + 1] < distance)
        segment++;
      const alpha =
        (distance - distances[segment]) /
        Math.max(1e-6, distances[segment + 1] - distances[segment]);
      samples.push(
        path[segment]
          .clone()
          .lerp(path[segment + 1], alpha)
          .applyMatrix4(inverse),
      );
    }
    return samples;
  }
}
