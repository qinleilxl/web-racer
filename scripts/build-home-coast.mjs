import { readFile, writeFile } from "node:fs/promises";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { pack } from "gltfpack";
import { createCoastalCircuit } from "../src/game/CoastalCircuit.ts";
import { createRoadside } from "../src/game/Roadside.ts";

// Export the actual menu section, including widened asphalt and flush parapets.
// No collision data, simulation or full circuit is needed by the homepage.
const bytes = await readFile("public/assets/Coastal_Circuit.glb");
const terrain = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength), "")).scene;
const route = JSON.parse(await readFile("public/assets/track_route.json", "utf8"));
const { track } = createCoastalCircuit(terrain, new Group(), route);
terrain.add(createRoadside(track).visual);
terrain.updateMatrixWorld(true);
const origin = track.point(760), result = new Group();
result.name = "Saltwind coast home";
result.userData = { origin:origin.toArray(), heading:track.tangent(760).toArray() };
const point = new Vector3();
terrain.traverse((node) => {
  if (!(node instanceof Mesh) || node.name.includes("WATER")) return;
  const source = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry;
  const position = source.getAttribute("position"), normals = source.getAttribute("normal");
  const groups = source.groups.length ? source.groups : [{start:0,count:position.count,materialIndex:0}];
  const materials = Array.isArray(node.material) ? node.material : [node.material];
  for (const group of groups) {
    const vertices = [], normal = [];
    for (let i=group.start; i<group.start+group.count; i+=3) {
      let nearby = false;
      for (let j=0;j<3;j++) {
        point.fromBufferAttribute(position,i+j).applyMatrix4(node.matrixWorld);
        if (Math.hypot(point.x-origin.x,point.z-origin.z)<115) nearby=true;
      }
      if (!nearby) continue;
      for (let j=0;j<3;j++) {
        vertices.push(...point.fromBufferAttribute(position,i+j).applyMatrix4(node.matrixWorld).toArray());
        normal.push(...point.fromBufferAttribute(normals,i+j).transformDirection(node.matrixWorld).toArray());
      }
    }
    if (!vertices.length) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position",new Float32BufferAttribute(vertices,3));
    geometry.setAttribute("normal",new Float32BufferAttribute(normal,3));
    const material = materials[group.materialIndex];
    material.roughness = Math.max(.65,material.roughness);
    material.envMapIntensity = .4;
    const mesh = new Mesh(geometry,material); mesh.name=node.name;
    result.add(mesh);
  }
});
// GLTFExporter needs a browser FileReader for its binary Blob, even without textures.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((data) => {this.result=data; this.onloadend?.();}); }
};
const output = await new GLTFExporter().parseAsync(result,{binary:true});
const files = new Map([["coast-source.glb",new Uint8Array(output)]]);
await pack(["-i","coast-source.glb","-o","coast.glb","-cc","-ce","ext","-ke","-km","-kn"],{
  read:(path) => files.get(path), write:(path,data) => files.set(path,Buffer.from(data)),
});
const packed = files.get("coast.glb");
await writeFile("public/assets/showroom/coast.glb",packed);
console.log(`Home coast: ${(packed.byteLength/1024).toFixed(0)} KiB`);
