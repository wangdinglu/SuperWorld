/** Package boundaries from docs/ARCHITECTURE.md §4. */
const pkg = (name) => `^packages/${name}/`;
module.exports = {
  forbidden: [
    {
      name: "packages-never-import-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "schema-depends-on-nothing-of-ours",
      severity: "error",
      from: { path: pkg("schema") },
      to: { path: "^packages/(?!schema/)" },
    },
    {
      name: "style-depends-only-on-schema",
      severity: "error",
      from: { path: pkg("style") },
      to: { path: "^packages/(?!schema/|style/)" },
    },
    {
      name: "core-depends-only-on-schema",
      severity: "error",
      from: { path: pkg("core") },
      to: { path: "^packages/(?!schema/|core/)" },
    },
    {
      name: "protocol-depends-on-core-and-schema",
      severity: "error",
      from: { path: pkg("protocol") },
      to: { path: "^packages/(?!schema/|core/|protocol/)" },
    },
    {
      name: "three-only-in-render-and-web",
      severity: "error",
      from: { pathNot: "^(packages/render|apps/web)/" },
      to: { path: "node_modules/three/" },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(dist|node_modules)/" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "default"] },
  },
};
