import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflareAssets } from "./scripts/cloudflare-assets";
import { landingBudget } from "./scripts/landing-budget";
export default defineConfig({
  plugins: [react(), cloudflareAssets(), landingBudget()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        hoistTransitiveImports: false,
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          // Vite's shared preload helper must not live in the Jolt chunk:
          // that would pull the whole simulator into every lazy-loading entry.
          if (id.includes("vite/preload-helper") || id.includes("commonjsHelpers")) return "runtime";
          if (id.includes("/node_modules/jolt-physics/")) return "physics";
          if (id.includes("/node_modules/three/")) return "three";
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (id.includes("/src/game/") && ["TouchInput.ts", "CameraModes.ts", "Vehicles.ts", "MapMode.ts", "AudioUnlock.ts", "types.ts"].some((name) => id.endsWith(`/${name}`))) return "shell";
        },
      },
    },
  },
  server: { port: 5190, strictPort: true },
});
