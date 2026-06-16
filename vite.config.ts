import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string };

export default defineConfig({
  root: "web",
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version || "0.0.0"),
  },
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
    testTimeout: 20000,
  },
});
