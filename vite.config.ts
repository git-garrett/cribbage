import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 8765,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
