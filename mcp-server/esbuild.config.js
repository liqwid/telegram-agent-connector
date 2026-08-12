import esbuild from "esbuild";

// Fully bundled: `node build/index.js` runs with no node_modules next to it,
// which keeps the Claude plugin's .mcp.json entry a plain `node` command.
await esbuild.build({
  entryPoints: ["src/index.ts"],
  outfile: "build/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  minify: false,
  tsconfig: "tsconfig.json",
  banner: {
    // Allow CJS deps that reference `require` inside an ESM bundle.
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});

console.log("Build completed: build/index.js");
