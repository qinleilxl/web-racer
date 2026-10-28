import {
  Line,
  Material,
  Mesh,
  Object3D,
  Points,
  Texture,
  type BufferGeometry,
} from "three";

/** Dispose only the supplied subtree; shared track/renderer resources stay owned by the game. */
export function disposeObjectResources(root: Object3D) {
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>(),
    textures = new Set<Texture>();
  root.traverse((node) => {
    if (
      !(node instanceof Mesh || node instanceof Points || node instanceof Line)
    )
      return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof Texture) textures.add(value);
      });
    }
  });
  geometries.forEach((resource) => resource.dispose());
  materials.forEach((resource) => resource.dispose());
  textures.forEach((resource) => resource.dispose());
}
