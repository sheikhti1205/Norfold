# Commit messages

Norfold uses [Conventional Commits](https://www.conventionalcommits.org/) so
that commit history can drive automatic semantic versioning. The convention
applies to new commits; CI checks the commits in a pull request or push range.

## Subject

```
type(scope)!: description
```

- `type` is an open vocabulary, not a fixed list. Conventional Commits does not
  define a closed set of types: a type is a lowercase noun that starts with a
  letter and may contain letters, digits and hyphens, matching
  `[a-z][a-z0-9-]*`. Repository-specific types such as `dock`,
  `share-preview`, `release-config`, `supabase`, or `ui` are valid.

- The following are common examples, not an exhaustive list:

  | Type       | Typical meaning                                      |
  | ---------- | ---------------------------------------------------- |
  | `feat`     | a user-visible feature                               |
  | `fix`      | a user-visible bug fix                               |
  | `perf`     | a performance improvement                            |
  | `refactor` | a code change that is not a feature or bug fix       |
  | `docs`     | documentation only                                   |
  | `test`     | tests only                                           |
  | `build`    | build system or dependencies                         |
  | `ci`       | CI configuration and workflows                       |
  | `chore`    | maintenance that does not change product behaviour   |
  | `style`    | formatting or other no-op changes                    |
  | `revert`   | reverts an earlier commit                            |

- `(scope)` is optional and lower-case, for example `feat(chat):` or
  `fix(api,client):`. Use a path-like segment such as `build(scripts/check):`
  when it helps locate the change.
- `!` marks a breaking change: `feat(api)!: replace the transport`.
- `description` is required, contains at least one letter, and the subject line
  is at most 72 characters.
- The body is optional. Add one when the change needs context that the subject
  cannot carry.

## Breaking changes

A breaking change is declared either with `!` or with a footer:

```
feat(api)!: replace the transport

BREAKING CHANGE: the legacy transport is removed; use the relay client.
```

`BREAKING CHANGE:` and `BREAKING-CHANGE:` are equivalent. The footer must
describe what breaks and what to use instead.

## Verification

Verification evidence belongs to CI, not to commit text. A commit with a
subject and no body is valid; do not paste gate lists or test counts into the
message.

## Versioning

Merge commits, git-generated `Revert "…"` commits, and release-automation
commits are skipped. For the rest:

- `feat` produces a minor release.
- `fix` and `perf` produce a patch release.
- A breaking change (on any type) produces a major release.
- Every other type produces no release.

## Checking locally

```sh
node scripts/check-commit-messages.mjs --count 1             # just HEAD
node scripts/check-commit-messages.mjs --range origin/main...HEAD
node scripts/check-commit-messages.mjs --rev v0.1.0-beta.1   # a single commit or tag
git log --format='%H' -5 | node scripts/check-commit-messages.mjs --stdin
```
