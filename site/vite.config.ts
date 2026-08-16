import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  // node-полифилы нужны GramJS (MTProto в браузере): Buffer/process/global
  plugins: [react(), nodePolyfills({ globals: { Buffer: true, global: true, process: true } }), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
