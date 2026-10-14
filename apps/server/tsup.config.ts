import { defineConfig } from "tsup";

// Bundles the server (and the workspace packages it uses) into dist/main.js.
// Third-party packages stay external and are installed in the Docker image.
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@cafe\//],
});
