import { Mesh, MeshStandardMaterial, type Object3D } from "three";

/** Preview assets retain material names after batching; match running headlamps. */
export function prepareHomeVehicle(model: Object3D) {
  model.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      if (/^(Ribbed headlight glass|Warm tungsten bulb|Headlight lens|LED daylight|HIFI projector optical glass|Warm headlamp glow)$/.test(material.name)) {
        material.emissive.setHex(0xffeccb);
        material.emissiveIntensity = 3.2;
      }
    }
  });
}
