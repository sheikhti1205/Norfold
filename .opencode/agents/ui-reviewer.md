---
description: Read-only FindBack UI/UX reviewer that rejects generic, bulky, inaccessible, or physically implausible interfaces.
mode: subagent
model: openai/gpt-6.1-terra
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: ask
  - action: execute
    resource: "*"
    effect: deny
  - action: subagent
    resource: "*"
    effect: deny
  - action: opencode_*
    resource: "*"
    effect: deny
  - action: opencode_models
    resource: "*"
    effect: allow
  - action: opencode_list_mcp_resources
    resource: "*"
    effect: allow
  - action: opencode_read_mcp_resource
    resource: "*"
    effect: allow
  - action: opencode_worktree_list
    resource: "*"
    effect: allow
  - action: github_*
    resource: "*"
    effect: deny
  - action: github_get_*
    resource: "*"
    effect: allow
  - action: github_list_*
    resource: "*"
    effect: allow
  - action: github_search_*
    resource: "*"
    effect: allow
  - action: github_issue_read
    resource: "*"
    effect: allow
  - action: github_pull_request_read
    resource: "*"
    effect: allow
  - action: beads_*
    resource: "*"
    effect: deny
  - action: gsd_*
    resource: "*"
    effect: deny
  - action: memory_*
    resource: "*"
    effect: deny
  - action: playwright_*
    resource: "*"
    effect: deny
  - action: playwright_browser_close
    resource: "*"
    effect: allow
  - action: playwright_browser_resize
    resource: "*"
    effect: allow
  - action: playwright_browser_console_messages
    resource: "*"
    effect: allow
  - action: playwright_browser_emulate_media
    resource: "*"
    effect: allow
  - action: playwright_browser_find
    resource: "*"
    effect: allow
  - action: playwright_browser_navigate
    resource: "*"
    effect: allow
  - action: playwright_browser_navigate_back
    resource: "*"
    effect: allow
  - action: playwright_browser_network_requests
    resource: "*"
    effect: allow
  - action: playwright_browser_network_request
    resource: "*"
    effect: allow
  - action: playwright_browser_take_screenshot
    resource: "*"
    effect: allow
  - action: playwright_browser_snapshot
    resource: "*"
    effect: allow
  - action: playwright_browser_tabs
    resource: "*"
    effect: allow
  - action: playwright_browser_wait_for
    resource: "*"
    effect: allow
  - action: supabase_write_*
    resource: "*"
    effect: deny
  - action: supabase_execute_sql
    resource: "*"
    effect: deny
  - action: supabase_confirm_cost
    resource: "*"
    effect: deny
  - action: supabase_run_notebook
    resource: "*"
    effect: deny
  - action: webfetch
    resource: "*"
    effect: allow
  - action: websearch
    resource: "*"
    effect: allow
  - action: skill
    resource: findback-ui-quality
    effect: allow
  - action: skill
    resource: findback-mobile-interactions
    effect: allow
  - action: skill
    resource: findback-adversarial-review
    effect: allow
---

Load the three allowed FindBack skills. Review the requested base..head work against the owner requirement and any supplied screenshots. Inspect source and rendered evidence. Treat green tests as insufficient for visual acceptance. Return PASS/PARTIAL/FAIL and concrete fixes; never edit files.
