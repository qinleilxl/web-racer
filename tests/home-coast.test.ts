import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, FogExp2, Scene, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { CoastalAtmosphere } from "../src/game/CoastalAtmosphere";
import { Track } from "../src/game/Track";
import { disposeObjectResources } from "../src/game/GraphicsResources";

test("the shared coast atmosphere keeps vehicle materials free of studio reflections", () => {
  const scene = new Scene(), atmosphere = new CoastalAtmosphere(scene);
  try {
    assert.equal(scene.environment,null);
    assert.ok(scene.fog instanceof FogExp2);
    assert.equal(scene.fog.density,.00135);
    assert.equal(atmosphere.sun.intensity,3.1);
    const car = new Vector3(60,24,-4);
    atmosphere.update(15,car);
    assert.deepEqual(atmosphere.sun.target.position.toArray(),car.toArray());
    assert.deepEqual(atmosphere.sun.position.clone().sub(car).toArray(),[-60,120,70]);
    const testScene = new Scene();
    new CoastalAtmosphere(testScene,true);
    assert.equal((testScene.fog as FogExp2).density,.00085);
    disposeObjectResources(testScene);
  } finally { disposeObjectResources(scene); }
});

test("the lightweight coast retains the real menu spawn and road at its original elevation", async () => {
  const bytes = await readFile("public/assets/showroom/coast.glb");
  assert.ok(bytes.length < 450*1024,"home scenery exceeded its loading budget");
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const {scene} = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),"");
  try {
    const track = new Track(JSON.parse(await readFile("public/assets/track_route.json","utf8")));
    let spawn: number[] | undefined, heading: number[] | undefined;
    scene.traverse((node) => {
      if (node.userData.origin) {spawn=node.userData.origin; heading=node.userData.heading;}
    });
    assert.deepEqual(spawn,track.point(760).toArray(),"packing discarded the coast origin; preview would spawn inside terrain");
    assert.deepEqual(heading,track.tangent(760).toArray());
    const road = scene.getObjectByName("DRIVEABLE_ROAD_8m");
    assert.ok(road,"preview lost the actual asphalt and road markings");
    const bounds = new Box3().setFromObject(road);
    assert.ok(bounds.containsPoint(track.point(760)),"preview car is not on the exported road");
    assert.ok(scene.getObjectByName("Continuous_inner_parapets"));
  } finally {disposeObjectResources(scene);}
});
