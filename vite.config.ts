import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflareAssets } from "./scripts/cloudflare-assets";
export default defineConfig({
  plugins: [react(), cloudflareAssets()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          physics: ["jolt-physics/wasm"],
          three: ["three"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
  server: { port: 5190, strictPort: true },
});
