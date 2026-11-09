# Product reset runbook (destructive, owner-only)

Status: **the GitHub Actions entry point was retired on 2026-11-09.**
`.github/workflows/product-fit-reset-execute.yml` no longer exists on `main`, so
there is no button to press, no schedule, and no way to trigger a reset from the
repository. `scripts/product-fit-reset-execute.mjs` is preserved unchanged.

## Why it was retired

The workflow was `workflow_dispatch`-only and gated on
`github.actor == 'sheikhti1205'`. The `backend` environment it targeted has **no
protection rules and no required reviewers**, so that actor check was the only
gate. `AGENTS.md` already said the reset must never be dispatched for
stabilization, startup or upgrades; the dispatch entry point contradicted that
rule, and a token with `workflow_dispatch` scope could satisfy the actor check.

Deleting the workflow makes the rule structural instead of documentary. The
script stays because a genuine fresh start is still a legitimate operation.

## What the script does

`scripts/product-fit-reset-execute.mjs` deletes, for project
`nfjhpigbsyyoaaktfaev` (operation tag `product-fit-2026-11-01`):

- every row in the 53 `public.*` tables listed in the script's `TABLES` constant,
- every object in the `findback-images`, `findback-comment-media`,
  `findback-chat-media` and `findback-chat-moderation-evidence` buckets,
- the Auth population, one `/auth/v1/admin/users/<id>` delete per user.

It requires `SUPABASE_ACCESS_TOKEN` (Management API) and
`SUPABASE_SECRET_KEY` (service role). It logs no credentials and no user data.

## If a reset is ever genuinely required

1. Get an explicit, written owner decision. This is not a routine operation.
2. Run the read-only preflight first:
   `gh workflow run product-fit-reset.yml --ref main`
   That workflow still exists and cannot modify anything.
3. Re-add a dispatch workflow deliberately, or run the script locally with the
   two secrets in the environment. Prefer a local run: it leaves no reusable
   dispatch path behind.
4. Verify afterwards that the product rows, storage objects and Auth users are
   at the expected counts.

Never re-add the workflow as a convenience. If it comes back, it should target an
environment with required reviewers, not the unprotected `backend` environment.

## History

- `product-fit-reset.yml` — read-only preflight; still present.
- `product-fit-reset-execute.yml` — destructive executor; retired 2026-11-09.
