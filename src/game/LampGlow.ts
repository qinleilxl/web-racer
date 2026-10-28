import {
  AdditiveBlending,
  Box3,
  Color,
  DoubleSide,
  Mesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";

export type GlowEmitter = {
  name: string;
  nodes: Mesh[];
  /** Face of the original -X-facing vehicle model. */
  face: "front" | "rear" | "left" | "right";
  color: number;
  intensity: () => number;
};

/** A soft, depth-tested halo matching the complete lens, including long strips. */
export class LampGlow {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  constructor(
    root: Object3D,
    readonly emitter: GlowEmitter,
  ) {
    root.updateWorldMatrix(true, true);
    const bounds = new Box3();
    emitter.nodes.forEach((node) => bounds.expandByObject(node));
    bounds.applyMatrix4(root.matrixWorld.clone().invert());
    const size = bounds.getSize(new Vector3());
    const side = emitter.face === "left" || emitter.face === "right";
    const width = Math.max(0.008, side ? size.x : size.z);
    const height = Math.max(0.008, size.y);
    const spread = Math.min(
      0.075,
      Math.max(0.025, Math.min(width, height) * 0.6),
    );
    const extent = new Vector2(width + spread * 6, height + spread * 6);
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        color: { value: new Color(emitter.color) },
        strength: { value: 0 },
        halfLens: { value: new Vector2(width / 2, height / 2) },
        extent: { value: extent },
        spread: { value: spread },
      },
      vertexShader: `varying vec2 uvGlow;
        void main() { uvGlow=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec2 uvGlow;
        uniform vec3 color; uniform float strength; uniform float spread;
        uniform vec2 extent; uniform vec2 halfLens;
        void main() {
          // Distance to the entire rounded lens, never to a central point.
          float corner=min(halfLens.x,halfLens.y)*0.6;
          vec2 q=abs((uvGlow-0.5)*extent)-(halfLens-vec2(corner));
          float distanceToLens=length(max(q,0.0))+min(max(q.x,q.y),0.0)-corner;
          float outside=max(distanceToLens,0.0)/spread;
          float halo=exp(-outside*outside*1.5);
          gl_FragColor=vec4(color,strength*halo*0.45);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(new PlaneGeometry(extent.x, extent.y), material);
    this.mesh.name = `LAMP_GLOW_${emitter.name}`;
    this.mesh.position.copy(bounds.getCenter(new Vector3()));
    if (emitter.face === "rear") {
      this.mesh.position.x = bounds.max.x + 0.008;
      this.mesh.rotation.y = Math.PI / 2;
    } else if (emitter.face === "front") {
      this.mesh.position.x = bounds.min.x - 0.008;
      this.mesh.rotation.y = -Math.PI / 2;
    } else {
      this.mesh.position.z =
        emitter.face === "left" ? bounds.max.z + 0.008 : bounds.min.z - 0.008;
      this.mesh.rotation.y = emitter.face === "left" ? 0 : Math.PI;
    }
    this.mesh.renderOrder = 4;
    this.mesh.userData.runtime_feedback = true;
    root.add(this.mesh);
    this.update();
  }
  update() {
    const intensity = Math.max(0, this.emitter.intensity());
    this.mesh.visible = intensity > 0.025;
    this.mesh.material.uniforms.strength.value =
      0.34 * Math.min(1, Math.pow(intensity / 5.5, 0.55));
  }
}
