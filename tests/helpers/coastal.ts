import { readFile } from "node:fs/promises";
import { Group } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCoastalCircuit } from "../../src/game/CoastalCircuit";

export async function loadCoastalCircuit(scenery = false) {
  const loader = new GLTFLoader();
  const load = async (name: string) => {
    const bytes = await readFile(`public/assets/${name}.glb`);
    return (
      await loader.parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        "",
      )
    ).scene;
  };
  const [terrain, collision, route] = await Promise.all([
    scenery ? load("Coastal_Circuit") : Promise.resolve(new Group()),
    load("Road_Collision"),
    readFile("public/assets/track_route.json", "utf8").then(JSON.parse),
  ]);
  return createCoastalCircuit(terrain, collision, route);
}
