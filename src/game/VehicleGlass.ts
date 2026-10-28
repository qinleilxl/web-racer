import {
  DataTexture,
  DoubleSide,
  EquirectangularReflectionMapping,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  RGBAFormat,
  SRGBColorSpace,
  type Object3D,
} from "three";
import type { VehicleDefinition } from "./Vehicles";

/** A small, model-owned sky reflection; it does not change other vehicles or the world. */
function coastalReflection() {
  const width = 256,
    height = 128,
    data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const horizon = Math.exp(-Math.pow((v - 0.5) / 0.12, 2));
    const sky = Math.max(0, 1 - v * 2);
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const cloud =
        Math.exp(
          -Math.pow((u - 0.24) / 0.11, 2) - Math.pow((v - 0.36) / 0.035, 2),
        ) +
        0.8 *
          Math.exp(
            -Math.pow((u - 0.7) / 0.16, 2) - Math.pow((v - 0.31) / 0.05, 2),
          );
      const base =
        v <= 0.5
          ? [137 + sky * 4, 181 + sky * 15, 190 + sky * 30]
          : [78, 103, 89];
      const offset = (y * width + x) * 4;
      for (let c = 0; c < 3; c++)
        data[offset + c] = Math.min(255, base[c] + horizon * 44 + cloud * 62);
      data[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.name = "Targa coastal glass reflection";
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Use transmission for optical transparency, rather than alpha-blending it away twice. */
export function prepareVehicleGlass(
  model: Object3D,
  vehicle: VehicleDefinition,
) {
  if (vehicle.id !== "targa") return;
  const glass = new Set<MeshPhysicalMaterial>();
  model.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    for (const material of materials) {
      if (
        material instanceof MeshPhysicalMaterial &&
        material.name === vehicle.glassMaterial
      ) {
        glass.add(material);
        node.castShadow = false;
        node.receiveShadow = false;
      }
    }
  });
  if (!glass.size) return;
  const reflection = coastalReflection();
  for (const material of glass) {
    material.color.set("#adc9ca");
    material.transparent = false;
    material.opacity = 1;
    material.transmission = 0.82;
    material.ior = 1.5;
    material.thickness = 0.008;
    material.attenuationColor.set("#90b6b5");
    material.attenuationDistance = 1.5;
    material.metalness = 0;
    material.roughness = 0.12;
    material.clearcoat = 0.35;
    material.clearcoatRoughness = 0.08;
    material.envMap = reflection;
    material.envMapIntensity = 1.35;
    material.side = DoubleSide;
    material.depthWrite = false;
    material.needsUpdate = true;
  }
}
