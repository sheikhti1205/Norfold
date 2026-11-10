# Progress board

`board.html` is a single self-contained file. Open it by double-clicking it in
Explorer — no server, no build step, no network. It embeds a snapshot of the
issue list, so it never goes stale silently: the page states how to refresh it.

## Source of truth: git-bug

Issues live in **git-bug**, which stores them as git objects under
`refs/bugs/*` and `refs/identities/*`. Nothing is written into the working tree,
which is why it replaced Beads (Beads' initialiser appended to `AGENTS.md`,
installed three other agents' config, and made its own commit).

The binary is expected at `E:\Tools\git-bug\git-bug_windows_amd64\git-bug.exe`.
Override with `GIT_BUG_BIN`, or put `git-bug` on `PATH`.

```sh
git-bug bug                      # list issues
git-bug bug status:open          # filter
git-bug bug show <human-id>      # detail, with the body
git-bug bug new -t "title" -m "body" --non-interactive
git-bug bug status close <id>
git-bug bug label new <id> p1
git-bug pull                     # fetch issue refs
git-bug push                     # publish issue refs (separate from source pushes)
```

Issue refs are **not** branches: committing and pushing source does not publish
issue changes, and `git-bug push` does not publish code. Both are explicit.

## Regenerate the board

```sh
node scripts/progress-board.mjs
```

It runs `git-bug bug --format json`, pulls each body with `git-bug bug show`, and
rewrites only the block between `<!-- BOARD_DATA_START -->` and
`<!-- BOARD_DATA_END -->` in `board.html`. Everything else in that file is
hand-written and is left untouched. Running it twice produces an identical file.

Conventions read by the generator:

- `p0`–`p4` labels become the numeric priority (default `2`).
- `type:<kind>` labels become the issue type (`task`, `feature`, `bug`, …).
- Any other label is shown as a label on the card.
- The first comment is the description; a trailing `Acceptance:` paragraph is
  split out into its own field.

## Columns

Ordered `open → in_progress → blocked → deferred → closed`, not alphabetically —
alphabetical ordering put `closed` first, which is the column a reader least
wants to see on opening the board.
