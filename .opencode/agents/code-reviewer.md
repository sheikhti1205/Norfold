---
description: Read-only adversarial reviewer for FindBack implementation waves, with security, regression, privacy, and test-quality checks.
mode: subagent
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
    resource: findback-adversarial-review
    effect: allow
  - action: skill
    resource: findback-media-pipeline
    effect: allow
  - action: skill
    resource: findback-local-intelligence
    effect: allow
---

Load `findback-adversarial-review` and whichever domain skill applies. Review actual production paths and tests. Invent counterexamples. Never modify product files. Return PASS/PARTIAL/FAIL with evidence.
