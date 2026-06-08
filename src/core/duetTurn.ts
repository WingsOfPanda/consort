// src/core/duetTurn.ts — round-1 brief + round-N follow-up builders for /consort:duet.
// Like turn.ts's composers, these bodies do NOT carry a done-event line or END_OF_INSTRUCTION;
// inboxWrite appends exactly one of each (the prelude duplicate-END_OF_INSTRUCTION lesson, 0.1.25).
import { BRANCH_DISCIPLINE, BLOCKERS } from "./turn.js";

/** Round 1: state the cross-repo framing (repo B path + branch), then the opening task. */
export function composeDuetBrief(task: string, repoPath: string, branch: string): string {
  return [
    `You are collaborating with a conductor on a multi-round task in the repository at \`${repoPath}\`.`,
    `You are on the branch \`${branch}\` of THAT repository (your shell is already there). The conductor`,
    "is running from a SEPARATE repository and will coordinate with you over several rounds — expect",
    "follow-up messages after this one.",
    "",
    "THE OPENING TASK:",
    "",
    task.trim(),
    "",
    "INSTRUCTIONS:",
    `- Work directly in \`${repoPath}\`, on \`${branch}\`.`,
    "- This is one round of an ongoing collaboration: do this round's work, commit per logical change",
    "  with Conventional Commits messages, then report by emitting the done event (see below).",
    "- The conductor will review your work and may send refinements for the next round.",
    "- If the repository has a test suite, run it and make your change pass it.",
    "",
    BRANCH_DISCIPLINE,
    BLOCKERS,
  ].join("\n");
}

/** Round >= 2: wrap the conductor's free-form follow-up text. */
export function composeDuetFollowup(text: string, round: number): string {
  return [
    `You are continuing the collaboration — round ${round}, still on the same branch and repository.`,
    "",
    "The conductor's message for this round:",
    "",
    text.trim(),
    "",
    "INSTRUCTIONS:",
    "- Address the above. Commit per logical change with Conventional Commits messages.",
    "- If the repository has a test suite, run it and keep it passing.",
    "- When this round's work is done and committed, emit the done event (see below).",
    "",
    BRANCH_DISCIPLINE,
    BLOCKERS,
  ].join("\n");
}
