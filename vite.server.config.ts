import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version || "0.0.0"),
  },
  build: {
    ssr: "server/ai-server.ts",
    outDir: "server-dist",
    emptyOutDir: true,
    target: "node22",
    rollupOptions: {
      output: {
        entryFileNames: "server.mjs",
      },
    },
  },
});
