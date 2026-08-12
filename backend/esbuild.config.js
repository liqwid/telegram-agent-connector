import esbuild from "esbuild";

// Self-contained bundle: `node build/index.js` runs with no node_modules next
// to it, so deploys rsync a single artifact (mirrors auf). The only externals
// are ws's optional native accelerators, which gramjs's ws dependency
// require()s inside try/catch — absent at runtime they fall back to JS.
await esbuild.build({
  entryPoints: ["src/index.ts"],
  outfile: "build/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  minify: false,
  external: ["bufferutil", "utf-8-validate"],
  tsconfig: "tsconfig.json",
  banner: {
    // Allow CJS deps that reference `require`/__dirname inside an ESM bundle.
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});

console.log("Build completed: build/index.js");
