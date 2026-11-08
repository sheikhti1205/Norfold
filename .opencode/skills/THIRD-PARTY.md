# Third-party skills installed — 2026-11-08

Installed from pinned commits by copying skill folders; **no third-party installer or `npx` command was run**.
Source checkouts live in `/home/sheikh/fb-work/skill-quarantine-2026-11-08/`.

| Folder | Source | Commit | License | Risk notes |
|---|---|---|---|---|
| `supabase` | `supabase/agent-skills` | `c9be0e931b7930f7d02126d04774d904c381e7d7` | MIT | Markdown + references only. Docs contain `curl`/CLI examples and `service_role` warnings; no executable files in the skill folder. |
| `supabase-postgres-best-practices` | `supabase/agent-skills` | same | MIT | Markdown + references only. |
| `capacitor-accessibility` | `Cap-go/capgo-skills` | `e90bb5639130e34387f00bf0a95c6d47e4a2ebb8` | MIT | Markdown only. |
| `capacitor-best-practices` | same | same | MIT | Markdown + references. Docs mention `sudo xcode-select` for iOS tooling; not executed by the skill. |
| `capacitor-keyboard` | same | same | MIT | Markdown only. |
| `safe-area-handling` | same | same | MIT | Markdown only. |
| `capacitor-performance` | same | same | MIT | Markdown only. |
| `debugging-capacitor` | same | same | MIT | Markdown + references; iOS commands are documentation, not hooks. |
| `ios-android-logs` | same | same | MIT | Markdown + references; contains `sudo` examples for iOS log collection. |
| `capacitor-testing` | same | same | MIT | Markdown + references; contains Vitest/Playwright examples. |
| `capacitor-offline-first` | same | same | MIT | Markdown + references; recommends `@capgo/capacitor-fast-sql`. Norfold already owns its SQLite schema; treat as guidance, not a migration order. |
| `capacitor-security` | same | same | MIT | Markdown + `metadata.json`; references the optional Capgo scanner (`npx @capgo/capgo-sec`), which was not installed or run. |
| `react-best-practices` | `vercel-labs/agent-skills` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` | MIT per `SKILL.md`/`README.md` (repository has no root LICENSE file) | Markdown rules + code examples only. Next.js-only rules are not applicable to Norfold. |
| `composition-patterns` | same | same | same | Markdown + examples only. |
| `antislop` | `miqdadbadjuber/anti-slop` | `9504989f162a92b1996853eccbb3d8a86e73df68` | MIT | Instruction-only (one 53 KB `SKILL.md` + `VERSION`). `allowed-tools: Read Write Edit Glob Grep`; reads/writes an optional mode file; in `after` mode it writes audit reports. No network or shell instructions. Global mode set to `during` in `~/.config/antislop/settings.json`. |
| `antislop-ui` | same | same | MIT | Instruction-only; core UI/visual rules and `CORE-WEB-VITALS.md`. |
| `antislop-layoutmobile` | same | same | MIT | Instruction-only; mobile reflow, overflow and tap-target rules. |
| `antislop-copywriting` | same | same | MIT | Instruction-only; anti-AI prose patterns. |
| `taste-skill` | `tasteskill/tasteskill` | `37c8c376b92ebc02456f7c70776b514fddda88e1` | MIT | Instruction-only (one 21 KB `SKILL.md`). Prescribes Next.js/RSC, Phosphor/Radix icons and Geist/Outfit fonts, which conflict with Norfold's Vite/Capacitor/lucide stack. A local override block was prepended; project rules still win. |
| `impeccable` | `pbakaus/impeccable` | `924bbd194d02e5e15a227e75b5901fb0d7a4ecad` | Apache-2.0 | Includes `scripts/impeccable`, which downloads a version-pinned engine binary from the project's GitHub Releases and verifies its SHA-256 against `engine-checksums.txt` before running. `live-browser.js` talks only to localhost. No installer was run; first use will trigger the verified download. If binary execution is not wanted, delete `scripts/` and use the `reference/` documents only. |
| `impeccable` command | same | same | Apache-2.0 | `.opencode/commands/impeccable.md` invokes the skill; copied manually. |

Not installed from the anti-slop repo: `antislop-human` (requests `Bash(python*)` for its contrast
checker; skipped to avoid adding executable Python from a skill) and `antislop-code` (comment
hygiene, outside the current UI scope).

## Removed global skills

70 irrelevant global skills were moved to `/home/sheikh/.config/opencode/skill-archive-2026-11-08/`
with a manifest. They are not deleted. Restore one with:

```bash
mv ~/.config/opencode/skill-archive-2026-11-08/<name> ~/.config/opencode/skill/
```

Removed categories: Android/Compose/Kotlin UI and testing, Cloudflare/Workers/Agents SDK/Ably,
perfetto, R8, Navigation 3, and other non-Norfold platform skills. General workflow, adb/device,
web performance, accessibility, design and testing-strategy skills were kept.

## Supabase MCP

- Endpoint changed from `read_only=false` to **`read_only=true`**.
- `supabase_*` was already re-admitted for `orchestrator`, `builder` and `verifier`.
- OAuth credential already stored; `opencode mcp list` reports `supabase connected`.
- Verified with `list_migrations`: live head is `20261108060000_norfold_chat_replies`.
  Only read tools are exposed (`list_migrations`, `list_tables`, `execute_sql`, `list_extensions`,
  `generate_typescript_types`, `get_project_url`, `get_publishable_keys`, `search_docs`).
