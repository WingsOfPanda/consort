// src/core/turn.ts
import type { OutboxEvent } from "./ipc.js";

export const BRANCH_DISCIPLINE =
  "BRANCH DISCIPLINE (hard rule):\n" +
  "- You are already on the correct branch. Do NOT run `git checkout`, `git switch`,\n" +
  "  or `git branch`, and do NOT create new branches.\n" +
  "- If the work genuinely needs a different branch, do NOT switch; instead emit\n" +
  '  {"event":"error","reason":"branch-discipline: needed a different branch"} and stop.\n';

export const BLOCKERS =
  "IF YOU ARE BLOCKED:\n" +
  "- If a path, file, command, or assumption is wrong or missing, do NOT guess or invent a\n" +
  "  workaround. Append a question event to your outbox and stop:\n" +
  '  {"event":"question","message":"<what you need and why>","ts":"<iso>"}\n' +
  "  The conductor will reply via your inbox, then re-engage you.\n";

/** Round-1 prompt body (the IMPLEMENT instructions + the inlined brief). NOTE: must NOT include
 *  END_OF_INSTRUCTION or the done-event line — inboxWrite() appends the canonical done instruction
 *  and the END_OF_INSTRUCTION fence when this becomes the inbox task. */
export function composeRound1Prompt(briefText: string, branch: string): string {
  return [
    `You are implementing a single, self-contained change on the branch \`${branch}\` of this repository.`,
    "",
    "This is one autonomous turn: read the task, implement it, commit your work, then report.",
    "",
    "THE TASK:",
    "",
    briefText.trim(),
    "",
    "INSTRUCTIONS:",
    `- Implement the change directly in this repository's working tree (you are on \`${branch}\`).`,
    "- Commit per logical change with Conventional Commits messages.",
    "- If the repository has a test suite, run it and make your change pass it.",
    "- When the implementation is complete and committed, emit the done event (see below).",
    "",
    BRANCH_DISCIPLINE,
    BLOCKERS,
  ].join("\n");
}

export type TurnStatus = "ok" | "failed" | "question" | "timeout";

/** done → ok; question → question; null (no event before timeout) → timeout; everything else (error, unknown) → failed. */
export function classifyTurn(ev: OutboxEvent | null): TurnStatus {
  if (!ev) return "timeout";
  if (ev.event === "done") return "ok";
  if (ev.event === "question") return "question";
  return "failed";
}

/** Read the OFFSET=<n> line from a turn state file's contents. null if absent/unparseable. */
export function parseOffset(stateText: string): number | null {
  const m = stateText.match(/^OFFSET=(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

/** Fix-round prompt body (round >= 2). Same fence note as composeRound1Prompt. */
export function composeFixPrompt(issuesText: string, round: number): string {
  return [
    `You are entering ROUND ${round} of /consort:solo (fix loop), still on the same branch.`,
    "",
    "This is one autonomous turn: fix each issue below, commit per fix, re-run the tests, then report.",
    "",
    "ISSUES TO ADDRESS:",
    "",
    issuesText.trim(),
    "",
    "INSTRUCTIONS:",
    "- Fix each issue above. Commit per fix with Conventional Commits messages.",
    "- Re-run the repository's test suite and confirm it passes.",
    "- When all issues are addressed and committed, emit the done event (see below).",
    "",
    BRANCH_DISCIPLINE,
    BLOCKERS,
  ].join("\n");
}
