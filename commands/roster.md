---
description: Show active parts (panes + state); optionally scoped to a topic
argument-hint: [<topic>]
allowed-tools: Bash, Write
---

# /consort:roster

Show every active part across topics, or scope to a single topic.

## Steps

1. Run this Bash block to mint an args path and capture it:
   `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs roster --mint-args-file`
   (prints an absolute path under `.consort/_args/`).
2. **Write** `$ARGUMENTS` into that exact path using the Write tool (never echo it into a shell).
3. Run: `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs roster --args-file <path-from-step-1>`
