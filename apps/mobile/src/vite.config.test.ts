import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INITIAL_CHUNK_CEILING_BYTES,
  resolveChunkGroups,
  resolveSupabaseBuildEnv,
} from "../vite.config";

let envDir = "";

// `loadEnv(mode, dir, "")` merges process.env, so a caller that exports
// VITE_* (the release gate does, at job level) would otherwise leak
// into these file-precedence assertions. Isolate the keys per test so the
// suite is hermetic regardless of ambient environment.
const ENV_KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  if (envDir) await rm(envDir, { force: true, recursive: true });
  envDir = "";
});

describe("resolveSupabaseBuildEnv", () => {
  it("derives the public build values from the canonical root Supabase env", async () => {
    envDir = await mkdtemp(join(tmpdir(), "findback-vite-env-"));
    await writeFile(join(envDir, ".env.production"),
      "SUPABASE_URL=https://canonical.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_canonical\nVITE_SUPABASE_URL=\nVITE_SUPABASE_PUBLISHABLE_KEY=\n");
    expect(resolveSupabaseBuildEnv("production", envDir)).toEqual({
      url: "https://canonical.supabase.co", publishableKey: "sb_publishable_canonical",
    });
  });
  it("loads public Supabase values from the production env file", async () => {
    envDir = await mkdtemp(join(tmpdir(), "findback-vite-env-"));
    await writeFile(
      join(envDir, ".env.production"),
      "VITE_SUPABASE_URL=https://example.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=public-test-key\n",
    );

    expect(resolveSupabaseBuildEnv("production", envDir)).toEqual({
      publishableKey: "public-test-key",
      url: "https://example.supabase.co",
    });
  });

  it("honors exported process.env values when no env file provides them", async () => {
    envDir = await mkdtemp(join(tmpdir(), "findback-vite-env-"));
    const prevUrl = process.env.VITE_SUPABASE_URL;
    const prevKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    process.env.VITE_SUPABASE_URL = "https://env-shell.supabase.co";
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "shell-test-key";
    try {
      expect(resolveSupabaseBuildEnv("production", envDir)).toEqual({
        publishableKey: "shell-test-key",
        url: "https://env-shell.supabase.co",
      });
    } finally {
      if (prevUrl === undefined) delete process.env.VITE_SUPABASE_URL;
      else process.env.VITE_SUPABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = prevKey;
    }
  });
});

/**
 * Chunk policy contract. The groups exist so no single output file becomes the
 * incidental dumping ground Rolldown produced by default (a 2,231 kB `AppBar`
 * chunk holding React, react-dom, react-router, react-aria, zod, framer-motion,
 * tiptap, the markdown stack and most of the app code).
 */
describe("resolveChunkGroups", () => {
  const groups = resolveChunkGroups();
  const id = (path: string) => `<repo>\\apps\\mobile\\node_modules\\${path}`;
  const groupFor = (moduleId: string) => groups.find((group) => group.test.test(moduleId))?.name;

  it("names each vendor family explicitly", () => {
    expect(groupFor(id("react\\index.js"))).toBe("vendor-react");
    expect(groupFor(id("react-dom\\client.js"))).toBe("vendor-react");
    expect(groupFor(id("react-router\\dist\\index.js"))).toBe("vendor-router");
    expect(groupFor(id("framer-motion\\dist\\es\\index.mjs"))).toBe("vendor-motion");
    expect(groupFor(id("zod\\v3\\index.js"))).toBe("vendor-validation");
    expect(groupFor(id("lucide-react\\dist\\cjs\\lucide-react.js"))).toBe("vendor-icons");
    expect(groupFor(id("yet-another-react-lightbox\\dist\\index.js"))).toBe("vendor-media");
    expect(groupFor(id("@supabase\\supabase-js\\dist\\index.js"))).toBe("vendor-supabase");
    expect(groupFor(id("@tiptap\\core\\dist\\index.js"))).toBe("vendor-editor");
    expect(groupFor(id("prosemirror-view\\dist\\index.js"))).toBe("vendor-editor");
    expect(groupFor(id("react-markdown\\index.js"))).toBe("vendor-markdown");
    expect(groupFor(id("react-aria\\dist\\FocusScope.mjs"))).toBe("vendor-aria");
    expect(groupFor(id("@internationalized\\date\\dist\\index.js"))).toBe("vendor-aria");
  });

  it("does not let a long package name fall into a shorter one", () => {
    // A package must match on its whole path segment, never on a prefix.
    expect(groupFor(id("@react-aria\\interactions\\dist\\mjs.js"))).toBe("vendor-aria");
    expect(groupFor(id("react-dom\\client.js"))).not.toBe("vendor-router");
    expect(groupFor(id("react-markdown\\index.js"))).not.toBe("vendor-react");
  });

  it("leaves unknown vendors to Rolldown's laziness-aware chunking", () => {
    // No catch-all on purpose: grouping every remaining package merged
    // lazy-only code (Sentry replay/feedback, 487 kB measured) into the
    // eagerly preloaded graph, so an unknown package must stay unmatched.
    expect(groupFor(id("some-unknown-package\\index.js"))).toBeUndefined();
    expect(groupFor(id("zustand-extra\\index.js"))).toBeUndefined();
    expect(groupFor(id("@sentry\\react\\esm\\index.js"))).toBeUndefined();
    expect(groupFor("<repo>\\apps\\mobile\\src\\screens\\Home.tsx")).toBeUndefined();
    expect(groupFor("<repo>\\apps\\mobile\\src\\services\\messaging\\runtime.ts")).toBe("app-messaging");
  });

  it("matches both path separators (Windows builds)", () => {
    expect(groupFor("<repo>/apps/mobile/node_modules/react/index.js")).toBe("vendor-react");
    expect(groupFor("<repo>/apps/mobile/src/services/messaging/runtime.ts")).toBe("app-messaging");
  });

  it("publishes unique group names", () => {
    const names = groups.map((group) => group.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("vendor-misc");
    expect(names).not.toContain("vendor-sentry");
  });

  it("does not hide the size warning in the config", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(import.meta.dirname, "..", "vite.config.ts"), "utf8");
    expect(/chunkSizeWarningLimit\s*:/.test(source)).toBe(false);
  });

  it("publishes a ceiling the build script enforces", () => {
    expect(INITIAL_CHUNK_CEILING_BYTES).toBe(1200 * 1024);
  });
});
