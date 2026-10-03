// Bundles the server and its workspace packages into one file for deployment.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  plugins: [
    {
      // Third-party packages stay in node_modules; our workspace packages (TypeScript source) are bundled.
      name: "externalise-dependencies",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith("@superworld/") ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log("Built dist/index.js");
