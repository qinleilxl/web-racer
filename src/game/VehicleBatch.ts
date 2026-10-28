import { vehicleModelRoot } from "./Vehicles";
import {
  Mesh,
  Object3D,
  type AnimationClip,
  type BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Batch only opaque, rigid body panels; retain every vertex, UV and rig node. */
export function batchVehicleBody(model: Object3D, clips: AnimationClip[]) {
  const root = vehicleModelRoot(model);
  const animated = new Set(
    clips.flatMap((clip) =>
      clip.tracks.map((track) => track.name.split(".")[0]),
    ),
  );
  const buckets = new Map<string, Mesh<BufferGeometry, Material>[]>();
  for (const o of root.children) {
    if (
      !(o instanceof Mesh) ||
      Array.isArray(o.material) ||
      !o.visible ||
      animated.has(o.name) ||
      o.userData.mechanical_target ||
      o.userData.runtime_feedback ||
      o.userData.runtime_rig ||
      o.material.transparent ||
      ("transmission" in o.material && Number(o.material.transmission) > 0) ||
      Object.keys(o.geometry.morphAttributes).length
    )
      continue;
    const layout = Object.entries((o.geometry as BufferGeometry).attributes)
      .map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}`)
      .sort()
      .join(",");
    const key = `${o.material.uuid}|${Boolean(o.geometry.index)}|${layout}`;
    const meshes = buckets.get(key) ?? [];
    meshes.push(o);
    buckets.set(key, meshes);
  }
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      return mesh.geometry.clone().applyMatrix4(mesh.matrix);
    });
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!merged) throw new Error("车辆车身部件合并失败");
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const body = new Mesh(merged, meshes[0].material);
    body.name = `Vehicle body · ${meshes[0].material.name}`;
    body.castShadow = meshes[0].castShadow;
    body.receiveShadow = meshes[0].receiveShadow;
    root.add(body);
    meshes.forEach((mesh) => {
      root.remove(mesh);
      mesh.geometry.dispose();
    });
  }
}
