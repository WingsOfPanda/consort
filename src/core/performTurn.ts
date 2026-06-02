// src/core/performTurn.ts — single-part TURN machinery for `perform` (Phase A).
// Byte-faithful port of deploy-turn-wait.sh (the TS= state machine) + deploy_build_turn_prompt_round1
// and deploy_build_turn_prompt_fix. Mirrors scoreTurn.ts conventions; prompt composers OMIT
// END_OF_INSTRUCTION and the done line (inboxWrite appends them). A question round-trip is ONE
// logical turn; the re-armed wait reads the LATEST OFFSET= line (scoreTurn.parseLatestOffset).
import type { OutboxEvent } from "./ipc.js";
import { dirname } from "node:path";

export type PerformState = "ok" | "failed" | "timeout" | "question";

/** Map a single-part turn's wait outcome to TS= (port of the `case "$EVENT"` block in
 *  deploy-turn-wait.sh:59-93). null -> timeout; question -> question; done + verify present AND
 *  non-empty -> ok else failed; error / unknown -> failed. */
export function performState(ev: OutboxEvent | null, verifyText: string | null): PerformState {
  if (!ev) return "timeout";
  if (ev.event === "question") return "question";
  if (ev.event === "done") return verifyText !== null && verifyText.length > 0 ? "ok" : "failed";
  return "failed";
}

const BRANCH_DISCIPLINE =
  "BRANCH DISCIPLINE (hard rule):\n" +
  "- You are operating on the conductor's current branch in the target\n" +
  "  repository. Do NOT run 'git checkout', 'git switch',\n" +
  "  'git branch -m', or create new branches.\n" +
  "- Commit per task with Conventional Commits prefixes on the current\n" +
  "  branch (rule already stated above).\n" +
  "- If your work genuinely needs a fresh branch, abort with\n" +
  '  {"event":"error","reason":"branch-discipline: needed new branch"}\n' +
  "  and let the conductor decide.\n";

function blockers(testCmd: string): string {
  const suiteLine = testCmd
    ? `  is NOT for running your test suite. Running '${testCmd}' is your job.\n  Banned values fail with rc=2.\n`
    : "  is NOT for running your test suite. Running your repository's test suite is your job.\n  Banned values fail with rc=2.\n";
  return (
    "BLOCKERS / QUESTIONS (read carefully):\n" +
    "- If a referenced path, file, checkpoint, git ref, env var, or\n" +
    "  command is NOT where the notes say it is, DO NOT search the\n" +
    "  filesystem yourself, DO NOT invent a workaround. Halt and ask by\n" +
    "  appending ONE question event to your outbox.jsonl, then stop:\n" +
    '    {"event":"question","message":"<why you are asking>",' +
    '"claim":{"kind":"<path|git|env|cmd|test>","value":"<the value to check>"},"ts":"<iso>"}\n' +
    '  Omit the "claim" object for a judgment question (no ground-truth to check).\n' +
    "- If you believe the PLAN ITSELF is wrong — a design flaw, a contradiction,\n" +
    "  or an approach that will not work (NOT a missing referent) — do NOT\n" +
    "  silently implement it. Halt and append ONE question whose message begins\n" +
    '  "OBJECTION:" explaining why, OMIT the "claim" object, then stop. The\n' +
    "  Maestro will revise the plan or tell you to proceed.\n" +
    "- The Maestro verifies the claim and replies via your inbox.md, then re-engages you.\n" +
    "- After reading any inbox.md reply, acknowledge by appending an ack event:\n" +
    '    {"event":"ack","task_summary":"<what you read>","ts":"<iso>"}\n' +
    "- The 'test' kind runs a diagnostic command under a 30s timeout — it\n" +
    suiteLine
  );
}
export { blockers };

/** Round-1 plan+implement+self-verify prompt body (port of deploy_build_turn_prompt_round1). MUST
 *  NOT include END_OF_INSTRUCTION or the done line. */
export function composeRound1Prompt(args: { designPath: string; planPath: string; verifyPath: string; round?: number; testCmd: string }): string {
  const { designPath, planPath, verifyPath, testCmd } = args;
  const round = args.round ?? 1;
  const testLog = `${dirname(verifyPath)}/test-output-${round}.log`;
  return [
    `You are entering ROUND ${round} of /consort:perform.`,
    "",
    "This is a single-turn workflow: you will write the implementation plan,",
    "implement it, run the test suite, and write the verify report — all in",
    "one autonomous run. The conductor will only re-engage when you emit done.",
    "",
    "RESUME CHECK (do this BEFORE starting):",
    `- If ${planPath} already exists, skip the planning phase — read the`,
    "  existing plan and proceed to implementation.",
    "- If `git log --oneline` shows commits past the design-doc commit on",
    `  this branch, identify the next pending task from ${planPath}'s checkbox`,
    "  state and continue from there. Do not redo already-committed tasks.",
    `- If ${verifyPath} already exists, you previously completed implementation`,
    `  — re-run the test suite and update ${verifyPath} if test outcomes changed.`,
    "",
    `PHASE 1: Plan (skip if ${planPath} exists)`,
    "  Use the superpowers:writing-plans skill. Read the design doc at:",
    `    ${designPath}`,
    "  Produce a comprehensive implementation plan and write it to:",
    `    ${planPath}`,
    "",
    "PHASE 2: Implement",
    `  Use the superpowers:subagent-driven-development skill. Walk ${planPath}`,
    "  task-by-task. Commit per task (Conventional Commits prefix). Run",
    testCmd
      ? `  the full test suite (\`${testCmd}\`) after each task and confirm green.`
      : "  the repository's full test suite after each task and confirm green.",
    "",
    "PHASE 3: Self-verify",
    "  Use the superpowers:verification-before-completion skill. Run the full",
    "  test suite, tee output to:",
    `    ${testLog}`,
    "  Write a structured verify report to:",
    `    ${verifyPath}`,
    "",
    "  The report MUST start with `VERDICT: PASS|PARTIAL|FAIL` on the first",
    "  line, followed by per-requirement evidence (file:line citations) and a",
    "  short summary.",
    "",
    BRANCH_DISCIPLINE,
    blockers(testCmd),
  ].join("\n");
}

/** Per-repo build prompt for the multi-repo DAG path (port of deploy_build_dag_unit_prompt
 *  @ deploy.sh:300). `slug` is the SUB-REPO slug (the part focuses on its `### <slug>` subsections).
 *  OMITS END_OF_INSTRUCTION + the done-line — inboxWrite appends the fence. */
export function composeDagUnitPrompt(args: { slug: string; designPath: string; step: string; total: number; upstreamCsv: string }): string {
  const { slug, designPath, step, total } = args;
  const upstream = !args.upstreamCsv || args.upstreamCsv === "none"
    ? "none (this is a wave-1 / root sub-repo)"
    : args.upstreamCsv.split(",").join(", ");
  return [
    `Read ${designPath}. Your sub-repo is "${slug}".`,
    "",
    `Multi-repo design docs use \`### ${slug}\` subsection headings inside the`,
    "Architecture and Components sections — focus on the subsections matching",
    `your slug. The DAG context (Step ${step} of ${total}) is in the`,
    `"## Execution DAG" section; you depend on: ${upstream}.`,
    "",
    "Run the full superpowers ceremony for your sub-repo:",
    "1. superpowers:writing-plans — produce an implementation plan from the",
    `   design-doc's slice for "${slug}", saved to`,
    `   docs/superpowers/plans/YYYY-MM-DD-${slug}-plan.md`,
    "2. superpowers:subagent-driven-development — execute the plan task-by-",
    "   task, two-stage review per task",
    "3. superpowers:verification-before-completion — confirm tests pass,",
    "   diff matches the plan, no half-finished work, before reporting done",
    "",
    'Report status via outbox: emit {"event":"done"} when all tasks are',
    'complete and verified. Emit {"event":"error", "reason":"..."} on any',
    "unrecoverable failure.",
    "",
    blockers(""),
    "",
    "BRANCH DISCIPLINE (hard rule):",
    `- You are operating on the current branch in sub-repo "${slug}".`,
    "  Do NOT run 'git checkout', 'git switch', 'git branch -m', or",
    "  create new branches.",
    "- Commit per task with Conventional Commits prefixes on the current",
    "  branch.",
    "- If your work genuinely needs a fresh branch, abort with",
    '  {"event":"error","reason":"branch-discipline: needed new branch"}',
    "  and let the conductor decide.",
  ].join("\n");
}

/** Fix-round prompt body (round >= 2; port of deploy_build_turn_prompt_fix). `bundleText` is the
 *  on-disk fix bundle, embedded VERBATIM (the bash `cat`s it raw). Same fence-omission note. */
export function composeFixPrompt(round: number, bundleText: string, verifyPath: string, testCmd: string): string {
  const testLog = `${dirname(verifyPath)}/test-output-${round}.log`;
  return [
    `You are entering ROUND ${round} of /consort:perform (fix loop).`,
    "",
    "This is a single-turn workflow: address each issue below, re-run the test",
    "suite, and write the verify report — all in one autonomous run.",
    "",
    "RESUME CHECK (do this BEFORE starting):",
    "- Check `git log --oneline` for commits since the previous round's",
    "  verify report was written. If some issues already have addressing",
    "  commits, identify which remain unaddressed and start from those.",
    `- If ${verifyPath} already exists, re-run tests and update it if outcomes`,
    "  changed.",
    "",
    "ISSUES TO ADDRESS:",
    "",
    bundleText,
    "",
    "ROUTING:",
    "- For each issue tagged [bug] or [regression]: use the",
    "  superpowers:systematic-debugging skill.",
    "- For each issue tagged [spec-gap]: use the superpowers:writing-plans",
    "  skill (re-plan the gap, then implement).",
    "- After EACH fix commit: dispatch a code-review subagent via the",
    "  superpowers:requesting-code-review skill with the fix commit's SHA as",
    "  scope. Address Critical and Important findings before moving to the next",
    "  issue. Round 1's subagent-driven-development walks code review per-task",
    "  automatically; fix rounds need this explicit invocation.",
    "",
    "For EACH issue: implement the fix, commit per fix (Conventional Commits",
    "prefix `fix:`, `feat:`, or `test:` as appropriate), run the",
    "code-review subagent on the new commit, then re-run the full test suite.",
    "Do NOT skip any listed issue.",
    "",
    "After all issues are addressed AND the test suite is green:",
    "  Run the full test suite, tee output to:",
    `    ${testLog}`,
    "  Write the verify report to:",
    `    ${verifyPath}`,
    "  The report MUST start with `VERDICT: PASS|PARTIAL|FAIL`.",
    "",
    BRANCH_DISCIPLINE,
    blockers(testCmd),
  ].join("\n");
}
