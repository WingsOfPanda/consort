// src/core/scoreTurn.ts — multi-part research-phase turn helpers for score.
// Built on the ipc primitives + the classifyTurn/parseOffset *semantics* from turn.ts
// (reused, not bent). The verify-phase composer + state machine land in Phase D.
import type { OutboxEvent } from "./ipc.js";
import { parseClaims } from "./scoreDiff.js";

/** Research findings.md health, ported from consult_findings_status (lib/consult.sh).
 *  null (file absent) -> "missing"; >=1 parseable `N. [cite] text` claim -> "ok";
 *  else non-blank lines under `## Claims` -> "malformed"; otherwise -> "empty". */
export function findingsStatus(text: string | null): "ok" | "empty" | "malformed" | "missing" {
  if (text === null) return "missing";
  if (parseClaims(text).length > 0) return "ok";
  let inClaims = false;
  let count = 0;
  for (const line of text.split("\n")) {
    if (/^## Claims/.test(line)) { inClaims = true; continue; }
    if (/^## /.test(line)) { inClaims = false; }
    if (inClaims && line.trim() !== "") count++;
  }
  return count > 0 ? "malformed" : "empty";
}

export type FsState = "ok" | "empty" | "malformed" | "missing" | "failed" | "timeout" | "question";

/** Map a research wait outcome to its FS= value, ported from consult_wait (lib/consult-wait.sh):
 *  null (no terminal event before timeout) -> timeout; question -> question;
 *  done -> findingsStatus; any other event (error/unknown) -> failed. */
export function researchState(ev: OutboxEvent | null, findingsText: string | null): FsState {
  if (!ev) return "timeout";
  if (ev.event === "question") return "question";
  if (ev.event === "done") return findingsStatus(findingsText);
  return "failed";
}

/** The LAST `OFFSET=<n>` line in a state file's contents. The question re-arm appends a second
 *  OFFSET= line (bumped past the question event); the re-armed wait must resume from the latest.
 *  Distinct from turn.ts parseOffset (first match — correct for solo's single-offset file).
 *  null if absent/unparseable. */
export function parseLatestOffset(stateText: string): number | null {
  const ms = [...stateText.matchAll(/^OFFSET=(\d+)\s*$/gm)];
  return ms.length ? Number(ms[ms.length - 1][1]) : null;
}

/** Apply a provider's timeout_multiplier to a base timeout, ported from the consult_wait loop's
 *  `printf "%d", b*m + 0.5` (round-half-up to an integer second). Bad/<=0 multiplier -> identity. */
export function scaledTimeout(baseSec: number, multiplier: string): number {
  const m = Number(multiplier);
  return Math.floor(baseSec * (Number.isFinite(m) && m > 0 ? m : 1) + 0.5);
}

const RESEARCH_BLOCKERS =
  "IF YOU ARE BLOCKED:\n" +
  "- If a referenced path, file, command, env var, or assumption is wrong or missing, do NOT guess\n" +
  "  or silently work around it. Append a question event to your outbox and stop:\n" +
  '  {"event":"question","message":"<what you need and why>","ts":"<iso>"}\n' +
  "  The Maestro will reply via your inbox, then re-engage you.\n";

/** Research-phase prompt body (port of config/prompt-templates/consult/research.md, rebranded).
 *  NOTE: must NOT include END_OF_INSTRUCTION or the done-event line — inboxWrite() appends the
 *  canonical done instruction and the fence when this becomes the inbox task (cf. composeRound1Prompt). */
export function composeResearchPrompt(topicText: string, findingsPath: string): string {
  const topic = topicText.trim();
  return [
    "Investigate the following topic and produce structured findings.",
    "",
    `Topic: ${topic}`,
    "",
    `Output requirements — write to ${findingsPath} with this EXACT structure:`,
    "",
    `  # Findings: ${topic}`,
    "",
    "  ## Summary",
    "  <2-3 sentence overview, free-form prose>",
    "",
    "  ## Claims",
    "  1. [<source citation>] <one-sentence claim>",
    "  2. [<source citation>] <one-sentence claim>",
    "  ...",
    "",
    "  ## Notes",
    "  <any free-form additions; not parsed>",
    "",
    "Citation format options:",
    "  - <file path>:<line>          e.g. src/auth/store.py:42",
    "  - <file path>:<line-range>    e.g. src/auth/refresh.py:15-30",
    "  - <URL>                       e.g. https://datatracker.ietf.org/doc/html/rfc6749",
    "  - runtime: <command>          e.g. runtime: pytest tests/test_auth.py",
    "",
    "Each claim must have a citation in [brackets]. Claims without citations will be silently",
    "dropped — and if NO claim has a citation, your findings will be flagged as malformed.",
    "",
    "Research methods: use any tool available in your environment. When local repository evidence is",
    "insufficient or the topic references external knowledge (RFCs, standards, library docs, vendor",
    "APIs, recent CVEs, design patterns), you SHOULD use web search / fetch to find authoritative",
    "sources and cite them as URL citations. Prefer primary sources over blog posts. If a tool is",
    "unavailable, fall back to local-only investigation and note the gap as an [unverified] claim.",
    "",
    RESEARCH_BLOCKERS,
  ].join("\n");
}

/** Verify wait outcome → VS= value, ported from the consult_wait verify branch (lib/consult-wait.sh):
 *  null → timeout; question → question; done → ok iff verify.md non-empty (the `-s` test) else missing;
 *  any other event → failed. (VS=skipped is written by verify-send on empty scope, not here.) */
export function verifyState(ev: OutboxEvent | null, verifyText: string | null): "ok" | "missing" | "failed" | "timeout" | "question" {
  if (!ev) return "timeout";
  if (ev.event === "question") return "question";
  if (ev.event === "done") return verifyText !== null && verifyText.length > 0 ? "ok" : "missing";
  return "failed";
}

export type GateStatus = "terminal" | "question" | "pending";

/** Per-part readiness for the research/verify wait gate. `key` is the status-line prefix
 *  (`FS` for research, `VS` for verify). A part is `terminal` once its `.done` marker exists and
 *  its LAST `<key>=` line is a non-`question` value; `question` while its last `<key>=` line is
 *  `question` (transient — awaiting a relay+re-arm); otherwise `pending` (still running). Pure:
 *  callers pass the pre-read `.done` existence and `.txt` text so this stays IPC-free and testable. */
export function gateState(
  parts: Array<{ instrument: string; doneExists: boolean; stateText: string | null }>,
  key: "FS" | "VS",
): Array<{ instrument: string; status: GateStatus }> {
  return parts.map((p) => {
    const matches = (p.stateText ?? "").split("\n").filter((l) => l.startsWith(`${key}=`));
    const last = matches.length ? matches[matches.length - 1].slice(key.length + 1).trim() : null;
    const status: GateStatus =
      last === "question" ? "question"
        : p.doneExists && last !== null ? "terminal"
          : "pending";
    return { instrument: p.instrument, status };
  });
}

/** Verify-phase prompt body (port of config/prompt-templates/consult/verify.md, rebranded).
 *  Numbers the items (nl -ba -w1 -s'. '). No END_OF_INSTRUCTION/done-line — inboxWrite appends them. */
export function composeVerifyPrompt(itemsText: string, verifyPath: string): string {
  const items = itemsText.split("\n").filter((l) => l.length > 0).map((l, i) => `${i + 1}. ${l}`).join("\n");
  return [
    "You researched a topic in your previous turn. Below are claims the OTHER researchers raised that",
    "you did not. For EACH item, do ONE of:",
    "",
    "  AGREE     — confirm with your own evidence (cite a file/line/source)",
    "  DISPUTE   — explain why it's wrong, with counter-evidence",
    "  UNCERTAIN — you cannot tell from available evidence; say so",
    "",
    "Items to verify:",
    items,
    "",
    `Write your verdicts to ${verifyPath} in this exact format:`,
    "",
    "  # Verify",
    "  ## Verdicts",
    "  1. <TAG> <original [citation] and text>",
    "     <one-line evidence>",
    "  2. ...",
    "",
    "Where <TAG> is one of: AGREE / DISPUTE / UNCERTAIN.",
    "",
    "Verification methods: use any tool in your environment. WebSearch / fetch are authorized when an",
    "item cites a URL, references external standards/docs, or makes a claim local repo evidence cannot",
    "resolve. For URL-cited items, fetching the source is the default. For file-cited items prefer the",
    "local file. If a tool is unavailable, mark the item UNCERTAIN and note the gap — never fabricate.",
    "",
    RESEARCH_BLOCKERS,
  ].join("\n");
}

/** Drilldown wait outcome → state (port of consult-drilldown.sh await_drill): a terminal done|error
 *  event with a NON-EMPTY drill file → ok; terminal with an empty/absent file → missing (NOT success);
 *  no terminal event before timeout → timeout. Drilldown does not relay questions. */
export function drilldownState(ev: OutboxEvent | null, fileText: string | null): "ok" | "missing" | "timeout" {
  if (!ev) return "timeout";
  return fileText !== null && fileText.length > 0 ? "ok" : "missing";
}

/** Drilldown prompt body (port of config/prompt-templates/consult/drilldown.md, rebranded). No
 *  END_OF_INSTRUCTION/done-line — inboxWrite appends them. */
export function composeDrilldownPrompt(opts: { section: string; designDocPath: string; focus: string; outPath: string }): string {
  const focus = opts.focus.trim() || `Provide more depth, citations, and concrete trade-offs for the ${opts.section} section.`;
  return [
    `You are drilling deeper into the **${opts.section}** section of a design doc derived from the`,
    "investigation you just completed.",
    "",
    `Read the design doc you produced: ${opts.designDocPath}`,
    "",
    `Focus: ${focus}`,
    "",
    "Write your expanded notes (with [citation] anchors) to:",
    `  ${opts.outPath}`,
  ].join("\n");
}
