import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output, vendored dependencies, and generated Android/coverage data
    // are not project source, and neither are untracked local scratch files;
    // linting them fails with thousands of no-undef errors from bundled code.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/android/**",
      "**/coverage/**",
      "tmp-*.mjs",
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
    },
  },
  {
    // Console noise is banned in mobile app source; report via utils/log.
    // CLI/build/scan/reporting scripts intentionally write to stdout — leave them alone.
    files: ["apps/mobile/src/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
    },
  },
  {
    // Deno Edge Functions run on Deno, not Node: the Web API globals the
    // module uses are provided by the runtime, so no-undef must not flag them.
    files: ["supabase/functions/**/*.js"],
    languageOptions: {
      globals: {
        Request: "readonly",
        Response: "readonly",
        crypto: "readonly",
        Deno: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  {
    // Azure Functions v3 entrypoints are intentionally dependency-free CommonJS.
    files: ["apps/share-preview/**/*.cjs"],
    languageOptions: { globals: { module: "readonly", require: "readonly", Response: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["scripts/**/*.mjs", "apps/mobile/scripts/**/*.mjs", "tools/**/*.mjs", "supabase/tests/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        TextDecoder: "readonly",
        structuredClone: "readonly",
        queueMicrotask: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);
