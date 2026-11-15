# Build performance and chunk policy

Measured on 2026-11-15 for `apps/mobile`, Windows, Node 26.13.0, Vite 8.3.5
(Rolldown 1.2.15). Sizes are minified bytes from one production build each, so
they are directly comparable.

## What changed

The default Rolldown partitioning produced two multi-megabyte chunks. `AppBar`
was named by whichever module happened to sort first; it actually held React,
react-dom, react-router, react-aria, zod, framer-motion, tiptap, the markdown
stack and most of the application code.

`vite.config.ts` now declares explicit package and subsystem groups
(`resolveChunkGroups`). No catch-all group exists: grouping every remaining
package was measured to pull lazy-only code (Sentry replay/feedback, 487 kB)
into the document's preloaded graph, so unknown packages keep Rolldown's
laziness-aware automatic chunking.

## Before / after

| Measurement | Before | After |
|---|---:|---:|
| JavaScript files | 17 | 26 |
| Total JavaScript on disk | 3,950.1 kB | 3,945.6 kB |
| Largest single chunk | 2,230.9 kB | 824.7 kB |
| Largest chunk, gzip | 644.3 kB | 223.1 kB |
| Second chunk | 988.7 kB | 519.4 kB |
| Entry preload graph (index.html) | 2 chunks, 23.8 kB | 6 chunks, 1,002.1 kB |
| Entry preload graph, gzip | 9.1 kB | 284.1 kB |
| Boot path (entry + the two dynamic chunks it requests immediately) | ~3,243 kB | ~2,347 kB |

Total bytes are intentionally almost unchanged: splitting changes the shape of
the payload and its cache boundaries, not how much code the product contains.

The preload graph grew because the entry statically needs React, the Supabase
client, validation and the messaging runtime, so those are fetched in parallel
instead of living behind two multi-megabyte files. The boot path still falls by
roughly 900 kB because `AppBar` no longer carries the editor, ARIA, markdown,
media and motion stacks that most screens never mount.

Independent, content-addressed vendor chunks also mean a vendor upgrade only
invalidates that vendor's chunk instead of the whole app bundle.

### After: largest emitted chunks

```
  824.7 kB │ gzip 223.1 kB │ assets/AppBar-*.js
  519.4 kB │ gzip 147.6 kB │ assets/app-messaging-*.js
  488.4 kB │ gzip 137.1 kB │ assets/startApp-*.js
  409.4 kB │ gzip 129.0 kB │ assets/vendor-editor-*.js
  309.0 kB │ gzip  99.9 kB │ assets/esm-*.js
  263.5 kB │ gzip  82.2 kB │ assets/vendor-aria-*.js
  209.4 kB │ gzip  53.2 kB │ assets/vendor-supabase-*.js
  185.1 kB │ gzip  57.4 kB │ assets/vendor-react-*.js
```

## The budget gate

`npm run build -w apps/mobile` runs `scripts/check-build-budget.mjs` after
`vite build`. It fails when:

1. any emitted JavaScript chunk is larger than `INITIAL_CHUNK_CEILING_BYTES`
   (1,200 kB minified) — every chunk, not only preloaded ones; or
2. `vite.config.ts` sets `chunkSizeWarningLimit`, which would hide the problem
   instead of fixing it.

It always prints the eight largest chunks and the document's preload graph, so
the boot payload stays visible in CI logs. The ceiling lives in both
`vite.config.ts` and the script; `src/vite.config.test.ts` pins the value so the
two cannot drift silently.

Vite still prints its default ">500 kB" advisory because two chunks exceed that
default; that is expected. The enforced ceiling is 1,200 kB and no chunk is near
it. Raising the advisory limit is not allowed.

## Source maps

- Normal local and CI production builds emit **no** `.map` files.
- `SENTRY_UPLOAD_SOURCEMAPS=true` emits `hidden` maps for the release lane:
  files exist to upload to Sentry, no `sourceMappingURL` comment is written,
  and the workflow strips them before packaging/deploying.
- `FINDBACK_BUILD_SOURCEMAPS=true` is the diagnostic twin: same `hidden`
  output with no Sentry assumption, for investigating a production-only failure
  on a local build. It is **not** a release switch — do not package or deploy a
  `dist` built with it, because the map files would be served next to the
  bundle. The config prints "diagnostic only — do not package dist" when this
  mode is active.

Ambiguous or partial values (`yes`, `true ` with trailing space, empty string)
stay off; `src/vite.sourcemaps.test.ts` pins that behavior.

## Reproducing the numbers

```powershell
# current policy
$env:VITE_PUBLIC_SHARE_ORIGIN="https://findbackapp.social"
npm run build -w apps/mobile

# previous policy, for a before/after comparison
git show HEAD~1:apps/mobile/vite.config.ts > apps/mobile/vite.config.baseline.ts
cd apps/mobile
npx vite build --config vite.config.baseline.ts
node scripts/check-build-budget.mjs
Remove-Item vite.config.baseline.ts
```

The budget script is also a real test target: `apps/mobile/scripts/check-build-budget.test.mjs`
covers the HTML preload parser, the ceiling check, and the warning-limit guard.
