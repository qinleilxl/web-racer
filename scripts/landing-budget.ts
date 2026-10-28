import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

/** Fail the build if a static import accidentally brings the simulator home. */
export function landingBudget(): Plugin {
  return {
    name: "landing-budget",
    generateBundle(_, bundle) {
      const visited = new Set<string>();
      let compressed = 0;
      const visit = (name: string, path: string[] = []) => {
        if (visited.has(name)) return;
        visited.add(name);
        const chunk = bundle[name];
        if (!chunk || chunk.type !== "chunk") return;
        const heavy = chunk.moduleIds.find((id) =>
          /\/node_modules\/(three|jolt-physics)\//.test(id) || /\/game\/Game\.ts$/.test(id),
        );
        if (heavy) this.error(`Landing statically imports the 3D engine: ${[...path, name].join(" -> ")} (${heavy})`);
        compressed += gzipSync(chunk.code).length;
        chunk.imports.forEach((dependency) => visit(dependency, [...path, name]));
      };
      Object.values(bundle).forEach((file) => {
        if (file.type === "chunk" && file.isEntry) visit(file.fileName);
      });
      if (compressed > 128 * 1024) this.error("Landing JavaScript exceeds its 128 KiB gzip budget");
      this.info(`Landing JavaScript: ${(compressed / 1024).toFixed(1)} KiB gzip; 3D engine deferred`);
    },
  };
}
