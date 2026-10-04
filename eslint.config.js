import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "docs/plan/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: [
      "apps/server/**",
      "tools/**",
      "*.config.*",
      "apps/server/build.mjs",
      ".dependency-cruiser.cjs",
    ],
    languageOptions: { globals: { ...globals.node, ...globals.commonjs } },
  },
  {
    files: ["apps/web/**", "packages/render/**"],
    languageOptions: { globals: globals.browser },
  },
  {
    // The shared core must run anywhere: no browser or Node globals, no platform modules.
    files: [
      "packages/core/src/**",
      "packages/schema/src/**",
      "packages/style/src/**",
      "packages/protocol/src/**",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "process",
        "navigator",
        "localStorage",
        "Buffer",
        "require",
      ],
      "no-restricted-imports": [
        "error",
        { patterns: ["node:*", "fs", "path", "three", "three/*"] },
      ],
    },
  },
  {
    // Tests read loosely typed JSON responses.
    files: ["**/test/**", "e2e/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
