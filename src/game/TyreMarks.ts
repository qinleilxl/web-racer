import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

/** Persistent tyre-width ribbons; WebGL line width is limited to one pixel on many GPUs. */
export class TyreMarks {
  readonly mesh: Mesh;
  private readonly capacity = 8000;
  private positions = new Float32Array(this.capacity * 18);
  private uvs = new Float32Array(this.capacity * 12);
  private strengths = new Float32Array(this.capacity * 6);
  private cursor = 0;
  count = 0;
  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(this.uvs, 2));
    geometry.setAttribute("strength", new BufferAttribute(this.strengths, 1));
    geometry.setDrawRange(0, 0);
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader:
        "attribute float strength;varying vec2 vUv;varying float vStrength;void main(){vUv=uv;vStrength=strength;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "varying vec2 vUv;varying float vStrength;void main(){float edge=smoothstep(0.,.12,vUv.x)*smoothstep(0.,.12,1.-vUv.x);float tread=.84+.16*sin(vUv.x*95.);gl_FragColor=vec4(vec3(.095,.115,.105),vStrength*edge*tread);}",
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }
  add(a: Vector3, b: Vector3, normal: Vector3, strength = 0.75, width = 0.25) {
    const direction = b.clone().sub(a),
      length = direction.length();
    if (length < 0.025 || length > 2 || !Number.isFinite(length)) return;
    const across = normal
      .clone()
      .cross(direction)
      .normalize()
      .multiplyScalar(width / 2);
    const lift = normal.clone().multiplyScalar(0.018);
    const al = a.clone().sub(across).add(lift),
      ar = a.clone().add(across).add(lift),
      bl = b.clone().sub(across).add(lift),
      br = b.clone().add(across).add(lift);
    const offset = this.cursor * 18;
    this.positions.set(
      [
        ...al.toArray(),
        ...br.toArray(),
        ...ar.toArray(),
        ...al.toArray(),
        ...bl.toArray(),
        ...br.toArray(),
      ],
      offset,
    );
    this.uvs.set(
      [0, 0, 1, length, 1, 0, 0, 0, 0, length, 1, length],
      this.cursor * 12,
    );
    this.strengths.fill(
      Math.max(0, Math.min(0.9, strength)),
      this.cursor * 6,
      this.cursor * 6 + 6,
    );
    for (const [name, start, size] of [
      ["position", offset, 18],
      ["uv", this.cursor * 12, 12],
      ["strength", this.cursor * 6, 6],
    ] as const) {
      const attribute = this.mesh.geometry.getAttribute(
        name,
      ) as BufferAttribute;
      attribute.addUpdateRange(start, size);
      attribute.needsUpdate = true;
    }
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
    this.mesh.geometry.setDrawRange(0, this.count * 6);
  }
}
