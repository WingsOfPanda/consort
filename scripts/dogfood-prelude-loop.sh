#!/usr/bin/env bash
# Simulated-parts end-to-end dogfood for /consort:prelude (port of meditate).
#
# Drives the REAL built CLI (`node dist/consort.cjs prelude <verb>`) across the full
# prelude lifecycle against a throwaway CONSORT_HOME. The model PARTS are SIMULATED:
# real codex pane spawns are blocked by codex's directory-trust prompt + need tmux, so
# instead of `spawn-all` we write the parts' deliverables by hand — findings-<inst>.md
# (research), the landscape-draft.md fixture, adversary-<inst>.md (critiques), and the
# final landscape doc — then run the synth/confidence/handoff verbs against that state.
#
# Self-contained + idempotent: creates its own temp CONSORT_HOME, seeds a 2-provider
# active list (-> N=2), runs, prints PASS/FAIL per assertion + a final tally.
# Exit 0 iff every assertion passed.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1
CS="node dist/consort.cjs"

CONSORT_HOME="$(mktemp -d "${TMPDIR:-/tmp}/consort-prelude-dogfood.XXXXXX")"
export CONSORT_HOME
trap 'rm -rf "$CONSORT_HOME"' EXIT

# 2 consult-validated providers in the active list -> prelude init picks N=2.
printf 'codex\nclaude\n' > "$CONSORT_HOME/providers-active.txt"

PASS=0
FAIL=0
pass() { printf 'PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }
# assert <description> <0-if-ok>
assert() { if [ "$2" -eq 0 ]; then pass "$1"; else fail "$1"; fi; }

TOPIC_TEXT="attention kernels for long context"

echo "===================================================================="
echo "prelude simulated-parts dogfood — TOPIC: $TOPIC_TEXT"
echo "===================================================================="

# --- Step 1: init -----------------------------------------------------------
ARGS="$($CS prelude --mint-args-file)"
printf 'attention kernels for long context' > "$ARGS"
OUT="$($CS prelude init --args-file "$ARGS")"; rc=$?
assert "1a init rc 0" "$rc"
assert "1b init OUT has TOPIC=" "$(printf '%s' "$OUT" | grep -q '^TOPIC=' && echo 0 || echo 1)"
assert "1c init OUT has N=2"    "$(printf '%s' "$OUT" | grep -q '^N=2$' && echo 0 || echo 1)"
TOPIC="$(printf '%s\n' "$OUT" | sed -n 's/^TOPIC=//p')"
ART="$(printf '%s\n' "$OUT" | sed -n 's/^ART=//p')"
assert "1d topic.txt + roster.txt exist" \
  "$([ -n "$ART" ] && [ -f "$ART/topic.txt" ] && [ -f "$ART/roster.txt" ] && echo 0 || echo 1)"

# --- Step 2: classify (topic has 'attention' -> lit-track ON) ---------------
$CS prelude classify "$TOPIC" >/dev/null 2>&1; rc=$?
assert "2a classify rc 0" "$rc"
assert "2b lit-track.txt starts with ON" \
  "$([ -f "$ART/lit-track.txt" ] && head -c2 "$ART/lit-track.txt" | grep -q '^ON$' && echo 0 || echo 1)"

# --- Step 3: simulate research findings (one per instrument in roster) -------
INSTRUMENTS="$(awk -F'\t' '!/^#/ && NF>=2 {print $2}' "$ART/roster.txt")"
assert "3a roster yields >=2 instruments" \
  "$([ "$(printf '%s\n' "$INSTRUMENTS" | grep -c .)" -ge 2 ] && echo 0 || echo 1)"
for inst in $INSTRUMENTS; do
  printf '## Approaches\n1. [https://arxiv.org/abs/2205.14135] FlashAttention — fused kernel\n## Notes\nuncertain about batch sizes.\n' \
    > "$ART/findings-$inst.md"
done
miss=0
for inst in $INSTRUMENTS; do [ -s "$ART/findings-$inst.md" ] || miss=1; done
assert "3b findings-<inst>.md written + non-empty for every instrument" "$miss"

# --- Step 4: synth-preliminary (input validator -> draft path) --------------
DRAFT_PATH="$($CS prelude synth-preliminary "$TOPIC")"; rc=$?
assert "4a synth-preliminary rc 0" "$rc"
assert "4b DRAFT_PATH ends with landscape-draft.md" \
  "$(printf '%s' "$DRAFT_PATH" | grep -q '/landscape-draft\.md$' && echo 0 || echo 1)"
# Write a draft fixture WITH a markdown matrix header row (-> S4 fails -> ALL_HOLD=false,
# the expected/common case that offers no skip gate).
printf '## Topic\n%s\n## Approaches\n1. FlashAttention — fused kernel\n## Tradeoff matrix\n| Priority | Best fit | Reason |\n| latency | FlashAttention | https://arxiv.org/abs/2205.14135 |\n## Citations\n- https://arxiv.org/abs/2205.14135\n' \
  "$TOPIC" > "$ART/landscape-draft.md"

# --- Step 5: confidence (no flag) -> ALL_HOLD + not-offered record ----------
CONF="$($CS prelude confidence "$TOPIC")"; rc=$?
assert "5a confidence rc 0" "$rc"
assert "5b CONF has ALL_HOLD=" "$(printf '%s' "$CONF" | grep -q '^ALL_HOLD=' && echo 0 || echo 1)"
assert "5c adversary-skip.txt has user_decision: not-offered (ALL_HOLD=false gate)" \
  "$([ -f "$ART/adversary-skip.txt" ] && grep -q '^user_decision: not-offered$' "$ART/adversary-skip.txt" && echo 0 || echo 1)"

# --- Step 6: confidence --decision continue -> record updated ---------------
$CS prelude confidence "$TOPIC" --decision continue >/dev/null 2>&1; rc=$?
assert "6a confidence --decision continue rc 0" "$rc"
assert "6b adversary-skip.txt now has user_decision: continue" \
  "$(grep -q '^user_decision: continue$' "$ART/adversary-skip.txt" && echo 0 || echo 1)"

# --- Step 7: simulate adversary critiques (one per instrument) --------------
for inst in $INSTRUMENTS; do
  printf '## Verdict\naccept\n## Material findings\n(none)\n' > "$ART/adversary-$inst.md"
done
miss=0
for inst in $INSTRUMENTS; do [ -s "$ART/adversary-$inst.md" ] || miss=1; done
assert "7a adversary-<inst>.md written + non-empty for every instrument" "$miss"

# --- Step 8: synth-final (input validator -> final landscape path) ----------
FINAL_PATH="$($CS prelude synth-final "$TOPIC")"; rc=$?
assert "8a synth-final rc 0" "$rc"
assert "8b FINAL_PATH is /landscape-<date>-<topic>.md" \
  "$(printf '%s' "$FINAL_PATH" | grep -q '/landscape-.*\.md$' && echo 0 || echo 1)"
printf '## Topic\n%s\n## Approaches\n1. FlashAttention — fused kernel\n## Tradeoff matrix\n| x | y | https://arxiv.org/abs/2205.14135 |\n## Conclusion\nUse FlashAttention.\n' \
  "$TOPIC" > "$FINAL_PATH"

# --- Step 9: forensics (best-effort) ----------------------------------------
$CS prelude forensics "$TOPIC" >/dev/null 2>&1; rc=$?
assert "9a forensics rc 0 (best-effort)" "$rc"

# --- Step 10: teardown (archive _prelude out of the live topic dir) ---------
TD="$($CS prelude teardown "$TOPIC")"; rc=$?
assert "10a teardown rc 0" "$rc"
assert "10b teardown stdout names the _prelude archive dest" \
  "$(printf '%s' "$TD" | grep -q '_prelude' && echo 0 || echo 1)"
ARCH="$(printf '%s\n' "$TD" | grep -oE '/[^ ]*/_prelude[^ ]*' | head -1)"
assert "10c archive dir exists and live ART is gone" \
  "$([ -n "$ARCH" ] && [ -d "$ARCH" ] && [ ! -d "$ART" ] && echo 0 || echo 1)"

# --- Step 11: handoff-extract (runs against the archived art dir) -----------
$CS prelude handoff-extract "$ARCH" >/dev/null 2>&1; rc=$?
assert "11a handoff-extract rc 0" "$rc"
KV="$ARCH/handoff-data.kv"
assert "11b handoff-data.kv exists" "$([ -f "$KV" ] && echo 0 || echo 1)"
assert "11c kv has mode=prelude" "$(grep -q '^mode=prelude$' "$KV" 2>/dev/null && echo 0 || echo 1)"
assert "11d kv has confidence_signals=" "$(grep -q '^confidence_signals=' "$KV" 2>/dev/null && echo 0 || echo 1)"
assert "11e kv has adversary_findings_paths=adversary-" \
  "$(grep -q '^adversary_findings_paths=adversary-' "$KV" 2>/dev/null && echo 0 || echo 1)"
assert "11f kv top_approach=FlashAttention" \
  "$(grep -q '^top_approach=FlashAttention$' "$KV" 2>/dev/null && echo 0 || echo 1)"

# --- Step 12: stale-token scan over the generated artifacts -----------------
assert "12a no clone-wars/cw_/trooper/commander tokens in archived artifacts" \
  "$(! grep -rIE 'clone-wars|cw_|trooper|commander' "$ARCH" >/dev/null 2>&1 && echo 0 || echo 1)"

echo "===================================================================="
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  printf 'PASS (%d/%d)\n' "$PASS" "$TOTAL"
  exit 0
else
  printf 'FAIL (%d failures, %d/%d passed)\n' "$FAIL" "$PASS" "$TOTAL"
  exit 1
fi
