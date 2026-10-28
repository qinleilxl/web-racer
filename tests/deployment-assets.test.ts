import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSET_LIMIT, externalizeGlb } from "../scripts/cloudflare-assets";
import { modelAssetUrl } from "../src/game/ModelAsset";

test("large production model retains every buffer view, animation and rig byte for byte", async () => {
  const bytes = await readFile("public/assets/Sparrow_One_E_Final.glb");
  assert.ok(bytes.length > ASSET_LIMIT);
  const jsonLength = bytes.readUInt32LE(12);
  const original = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binaryStart = 28 + jsonLength;
  const { document, chunks } = externalizeGlb(bytes, "Sparrow_One_E_Final");
  assert.ok(chunks.length > 1);
  chunks.forEach((chunk, i) => {
    assert.ok(chunk.length <= ASSET_LIMIT);
    assert.equal(document.buffers[i].byteLength, chunk.length);
    assert.equal(document.buffers[i].uri, `Sparrow_One_E_Final.buffer-${i}.bin`);
  });
  for (const [i, view] of document.bufferViews.entries()) {
    const source = original.bufferViews[i];
    assert.equal(view.byteOffset % 4, 0);
    assert.deepEqual(
      chunks[view.buffer].subarray(view.byteOffset, view.byteOffset + view.byteLength),
      bytes.subarray(binaryStart + (source.byteOffset ?? 0),
        binaryStart + (source.byteOffset ?? 0) + source.byteLength),
      `buffer view ${i} changed`,
    );
  }
  // All other JSON metadata, including accessors, nodes and materials, is intact.
  document.buffers = original.buffers;
  document.bufferViews = document.bufferViews.map((view: Record<string, unknown>, i: number) => ({
    ...view, buffer: original.bufferViews[i].buffer,
    byteOffset: original.bufferViews[i].byteOffset,
  }));
  assert.deepEqual(document, original);
  assert.equal(modelAssetUrl("/assets/Sparrow_One_E_Final.glb"),
    "/assets/Sparrow_One_E_Final.glb");
});
