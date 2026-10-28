import { readdirSync, statSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { Plugin } from "vite";

// Keep the approved source GLBs untouched. Large production models use standard
// glTF external buffers, with byte-identical geometry, textures and animations.
export const ASSET_LIMIT = 25 * 1024 * 1024;
const BUFFER_LIMIT = 24 * 1024 * 1024;

export function externalizeGlb(bytes: Buffer, stem: string, limit = BUFFER_LIMIT) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2)
    throw new Error("Expected a glTF 2 GLB");
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binaryStart = 28 + jsonLength;
  if (document.buffers?.length !== 1 || document.buffers[0].uri ||
      bytes.readUInt32LE(24 + jsonLength) !== 0x004e4942)
    throw new Error("Expected one embedded GLB buffer");
  const chunks: Buffer[] = [];
  let pieces: Buffer[] = [], size = 0;
  const flush = () => {
    if (pieces.length) chunks.push(Buffer.concat(pieces, size));
    pieces = []; size = 0;
  };
  for (const view of document.bufferViews) {
    if ((view.buffer ?? 0) !== 0 || view.byteLength > limit ||
        view.extensions?.EXT_meshopt_compression)
      throw new Error("Unsupported buffer view for lossless externalization");
    const padding = (4 - size % 4) % 4;
    if (size + padding + view.byteLength > limit) flush();
    const alignedPadding = (4 - size % 4) % 4;
    if (alignedPadding) { pieces.push(Buffer.alloc(alignedPadding)); size += alignedPadding; }
    const start = binaryStart + (view.byteOffset ?? 0);
    const content = bytes.subarray(start, start + view.byteLength);
    if (content.length !== view.byteLength) throw new Error("Truncated GLB buffer");
    view.buffer = chunks.length;
    view.byteOffset = size;
    pieces.push(content); size += content.length;
  }
  flush();
  document.buffers = chunks.map((chunk, i) => ({
    uri: `${stem}.buffer-${i}.bin`, byteLength: chunk.length,
  }));
  return { document, chunks };
}

export function cloudflareAssets(): Plugin {
  let output = "";
  const publicAssets = resolve("public/assets");
  const largeModels = readdirSync(publicAssets).filter((name) =>
    name.endsWith(".glb") && statSync(join(publicAssets, name)).size > ASSET_LIMIT,
  );
  const urls = Object.fromEntries(largeModels.map((name) =>
    [`/assets/${name}`, `/assets/${basename(name, ".glb")}.gltf`],
  ));
  return {
    name: "cloudflare-model-assets",
    apply: "build",
    config: () => ({ define: { __MODEL_ASSET_URLS__: JSON.stringify(urls) } }),
    configResolved(config) { output = resolve(config.root, config.build.outDir, "assets"); },
    async closeBundle() {
      for (const name of largeModels) {
        const stem = basename(name, ".glb");
        const { document, chunks } = externalizeGlb(await readFile(join(output, name)), stem);
        const json = JSON.stringify(document);
        if (Buffer.byteLength(json) > ASSET_LIMIT) throw new Error(`${name}: glTF JSON too large`);
        for (const [i, chunk] of chunks.entries())
          await writeFile(join(output, `${stem}.buffer-${i}.bin`), chunk);
        await writeFile(join(output, `${stem}.gltf`), json);
        await unlink(join(output, name));
        this.info(`${name}: lossless glTF + ${chunks.length} buffers (each under 25 MiB)`);
      }
      for (const name of readdirSync(output))
        if (statSync(join(output, name)).size > ASSET_LIMIT)
          throw new Error(`Cloudflare asset exceeds 25 MiB: ${name}`);
    },
  };
}
