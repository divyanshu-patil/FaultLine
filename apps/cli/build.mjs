// Bundles the CLI to a standalone, dependency-free executable for `npx` / publishing.
import { chmodSync } from "node:fs";
import { build } from "esbuild";

const outfile = "dist/faultline.cjs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile,
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});

chmodSync(outfile, 0o755);
console.log(`built ${outfile}`);
