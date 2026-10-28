import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { VEHICLES } from "../src/game/Vehicles";
import { ConvertibleRoof } from "../src/game/ConvertibleRoof";
import { disposeObjectResources } from "../src/game/GraphicsResources";

test("all five lightweight 3D vehicles decode with the shipped decoder and retain the moving roof", async () => {
  for (const id of Object.keys(VEHICLES)) {
    const bytes = await readFile(`public/assets/showroom/${id}.glb`);
    assert.ok(bytes.length < 3.1 * 1024 * 1024, `${id}: preview exceeds load budget`);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.register(() => ({name:"EXT_texture_webp",loadTexture:() => Promise.resolve(null)}));
    const {scene,animations} = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength), "");
    try {
      const size = new Box3().setFromObject(scene).getSize(new Vector3());
      assert.ok(size.x > 3 && size.x < 6 && size.y > 1 && size.y < 2.5,
        `${id}: preview lost the original vehicle scale`);
      if (id === "targa") {
        const roof = new ConvertibleRoof(scene,animations);
        const nodes: import("three").Object3D[] = [];
        scene.traverse((node) => nodes.push(node));
        const rest = nodes.map((node) => ({p:node.position.clone(),q:node.quaternion.clone()}));
        roof.toggle();
        for (let i=0;i<120;i++) roof.update(1/30);
        assert.ok(roof.progress > .2);
        assert.ok(nodes.some((node,i) => node.position.distanceTo(rest[i].p) > .01 || node.quaternion.angleTo(rest[i].q) > .05),
          "optimized roof lost its animation targets");
        roof.toggle();
        for (let i=0;i<120;i++) roof.update(1/30);
        assert.equal(roof.status,"closed");
        roof.dispose();
      }
    } finally { disposeObjectResources(scene); }
  }
});
