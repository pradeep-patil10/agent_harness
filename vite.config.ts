import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  // web-llm is ~6 MB but only loads when an on-device model is chosen.
  build: { chunkSizeWarningLimit: 7000 },
  optimizeDeps: { exclude: ["@mlc-ai/web-llm"] },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
