---
description: Health check (tmux/state/config/providers) + roster picker
argument-hint: (no args)
allowed-tools: Bash, Write, AskUserQuestion
---

# /consort:soundcheck

Health check (tmux/state/config/providers) + roster picker.

## Steps

1. Run this Bash block to mint an args path and capture it:
   `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs soundcheck --mint-args-file`
   (prints an absolute path under `.consort/_args/`).
2. **Write** `$ARGUMENTS` into that exact path using the Write tool (never echo it into a shell).
3. Run: `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs soundcheck --args-file <path-from-step-1>`
