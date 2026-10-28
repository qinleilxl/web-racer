import { access, copyFile, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "dist");
const output = join(root, "dist-edgeone");
const headers = join(source, "_headers");
const config = join(root, "edgeone.json");

await access(join(source, "index.html"));
await access(config);
await rm(output, { recursive: true, force: true });
await cp(source, output, {
  recursive: true,
  filter: (path) => path !== headers,
});
await copyFile(config, join(output, "edgeone.json"));

console.log("EdgeOne static assets prepared in dist-edgeone/");
