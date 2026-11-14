/**
 * Canonical Supabase backend identity.
 *
 * Release builds inject the values through `vite.config.ts` `define` after the
 * fail-closed build gate has verified them. The dev server of the current Vite
 * major does not apply bare-identifier defines, so development falls back to
 * the same `VITE_*` values Vite already exposes on `import.meta.env`. Release
 * behavior is unchanged: the injected constant wins whenever it exists.
 */
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_PUBLISHABLE_KEY__: string;

function resolveCompiled(injected: string | undefined, fallback: string | undefined): string {
  return (injected ?? fallback ?? "").trim();
}

export const SUPABASE_URL = resolveCompiled(
  typeof __SUPABASE_URL__ === "undefined" ? undefined : __SUPABASE_URL__,
  import.meta.env.VITE_SUPABASE_URL,
);

export const SUPABASE_PUBLISHABLE_KEY = resolveCompiled(
  typeof __SUPABASE_PUBLISHABLE_KEY__ === "undefined" ? undefined : __SUPABASE_PUBLISHABLE_KEY__,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
