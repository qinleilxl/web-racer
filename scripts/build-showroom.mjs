import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { pack } from "gltfpack";

const sources = {
  sparrow: "Sparrow_One_E_Final.glb", scarlet: "Hifi_Animated.glb",
  formula: "Formula_Animated.glb", targa: "Targa_JoinFix_V2.glb", suv: "SUV_Animated.glb",
};
const align = (n) => (n + 3) & ~3;
const temporary = await mkdtemp(join(tmpdir(), "rally-showroom-"));
await mkdir("public/assets/showroom", { recursive: true });
try {
  for (const [id, name] of Object.entries(sources)) {
    const source = await readFile(`public/assets/${name}`);
    const jsonLength = source.readUInt32LE(12);
    const doc = JSON.parse(source.subarray(20, 20 + jsonLength));
    const binary = source.subarray(28 + jsonLength);
    const pieces = [binary];
    let size = binary.length;
    for (const image of doc.images ?? []) {
      if (image.bufferView === undefined) continue;
      const view = doc.bufferViews[image.bufferView];
      const png = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      const webp = await sharp(png).resize({width:1024,height:1024,fit:"inside",withoutEnlargement:true}).webp({quality:90}).toBuffer();
      const padding = align(size) - size;
      if (padding) { pieces.push(Buffer.alloc(padding)); size += padding; }
      image.bufferView = doc.bufferViews.length;
      image.mimeType = "image/webp";
      doc.bufferViews.push({buffer:0,byteOffset:size,byteLength:webp.length});
      pieces.push(webp); size += webp.length;
    }
    for (const texture of doc.textures ?? []) {
      if (texture.source === undefined) continue;
      texture.extensions = {...texture.extensions, EXT_texture_webp:{source:texture.source}};
      delete texture.source;
    }
    doc.extensionsUsed = [...new Set([...(doc.extensionsUsed ?? []), "EXT_texture_webp"])];
    doc.extensionsRequired = [...new Set([...(doc.extensionsRequired ?? []), "EXT_texture_webp"])];
    // Keep the convertible mechanism; wheels and instruments stay still in the showroom.
    doc.animations = (doc.animations ?? []).filter((a) => a.name === "Roof_Open");
    for (const node of doc.nodes ?? []) if (/wiper/i.test(node.name ?? "")) delete node.mesh;
    doc.buffers[0].byteLength = size;
    const json = Buffer.from(JSON.stringify(doc)), jsonSize = align(json.length), binSize = align(size);
    const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
    header.writeUInt32LE(0x46546c67,0); header.writeUInt32LE(2,4);
    header.writeUInt32LE(28+jsonSize+binSize,8); header.writeUInt32LE(jsonSize,12); header.writeUInt32LE(0x4e4f534a,16);
    binaryHeader.writeUInt32LE(binSize,0); binaryHeader.writeUInt32LE(0x004e4942,4);
    const input = join(temporary, `${id}.glb`);
    await writeFile(input,Buffer.concat([header,json,Buffer.alloc(jsonSize-json.length,32),binaryHeader,...pieces,Buffer.alloc(binSize-size)]));
    const output = `public/assets/showroom/${id}.glb`;
    const files = new Map([[input, await readFile(input)]]);
    await pack(["-i",input,"-o",output,"-cc","-ce","ext","-km","-vp","16","-vt","14","-vn","8","-si","0.35","-se","0.002","-sp","-slb","-af","0"], {
      read: (path) => { const bytes=files.get(path); if (!bytes) throw new Error(`Unexpected dependency ${path}`); return bytes; },
      write: (path, bytes) => files.set(path, Buffer.from(bytes)),
    });
    const result = files.get(output);
    if (!result?.length) throw new Error(`No preview generated for ${id}`);
    await writeFile(output, result);
    console.log(`${id}: ${(source.length/1024/1024).toFixed(2)} MiB -> ${(result.length/1024/1024).toFixed(2)} MiB`);
  }
} finally { await rm(temporary, { recursive:true,force:true }); }
