import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { assertAllowedBuildModule } from "./scripts/lib/release-boundary.mjs";

const projectRoot = import.meta.dirname;

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "ruyi-release-source-boundary",
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          for (const moduleId of Object.keys(output.modules)) {
            assertAllowedBuildModule({ moduleId, projectRoot });
          }
        }
      },
    },
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
