// src/core/performQuestions.ts — perform-side QUESTION-CLAIM verifier (Phase A).
// Byte-faithful port of the prior bash plugin's deploy-questions lib (question payload extractor)
// + the part-question lib (claim verify dispatcher + reply formatter), rebranded for consort.
// Side effects (git ref resolution, command lookup, diagnostic test runs) shell through an injected
// Runner so unit tests stay pure. Filesystem (path) + environment (env) checks read ambient state.
import { existsSync, accessSync, constants, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { OutboxEvent } from "./ipc.js";

export interface RunResult { code: number; stdout: string; }
export interface QuestionRunner { run(cmd: string, args: string[]): RunResult; }

/** Percent-decode the 6 escapes (TEXT field). %0A->nl, %09->tab, %22->", %5C->\, %2C->comma,
 *  %25->%. Order matters: %25 is decoded LAST so nested encodings like %2522 round-trip. */
export function percentDecode(s: string): string {
  let out = s;
  out = out.split("%0A").join("\n");
  out = out.split("%09").join("\t");
  out = out.split("%22").join('"');
  out = out.split("%5C").join("\\");
  out = out.split("%2C").join(",");
  out = out.split("%25").join("%"); // literal-percent escape — must be LAST
  return out;
}

export type ClaimKind = "path" | "git" | "env" | "cmd" | "test" | "";
export type ClaimRoute = "verify" | "escalate";

export interface QuestionPayload { text: string; claimKind: ClaimKind; claimValue: string; route: ClaimRoute; }

const KNOWN_KINDS = new Set<ClaimKind>(["path", "git", "env", "cmd", "test"]);

/** Parse a question-<part>-<round>.txt payload body. KEY=value lines: TEXT (percent-encoded),
 *  CLAIM_KIND, CLAIM_VALUE, ROUTE. Value = everything after the FIRST '=' on the first matching
 *  line. ROUTE defaults to escalate; CLAIM_KIND/VALUE default to "" when absent. */
export function parseQuestionPayload(body: string): QuestionPayload {
  const first = (key: string): string | null => {
    for (const line of body.split("\n")) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      if (line.slice(0, eq) === key) return line.slice(eq + 1);
    }
    return null;
  };
  const rawText = first("TEXT");
  const text = rawText === null ? "" : percentDecode(rawText);
  const rawKind = first("CLAIM_KIND") ?? "";
  const claimKind: ClaimKind = KNOWN_KINDS.has(rawKind as ClaimKind) ? (rawKind as ClaimKind) : "";
  const claimValue = first("CLAIM_VALUE") ?? "";
  const route: ClaimRoute = (first("ROUTE") ?? "escalate") === "verify" ? "verify" : "escalate";
  return { text, claimKind, claimValue, route };
}

export interface VerifyResult { rc: 0 | 1 | 2; evidence: string; }

/** A cwd-bound synchronous runner for git/cmd/test claims. execFileSync — never a shell for git/cmd
 *  (argv array); kind=test routes through `bash -c` to match the prior plugin's `timeout 30 bash`. */
export function questionRunnerAt(cwd: string): QuestionRunner {
  return {
    run(cmd, args) {
      try {
        const stdout = execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return { code: 0, stdout };
      } catch (e: unknown) {
        const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
        const out = (err.stdout != null ? String(err.stdout) : "") + (err.stderr != null ? String(err.stderr) : "");
        return { code: typeof err.status === "number" ? err.status : 1, stdout: out };
      }
    },
  };
}

/** Strip trailing newline(s), matching bash `$(...)` capture (which strips all trailing newlines)
 *  + the reply's own printf '%s\n'. */
function trimTrailingNewline(s: string): string { return s.replace(/\n+$/, ""); }

/** Verify a claim of `kind` carrying `value`. rc=0 confirmed / rc=1 refuted / rc=2 unverifiable
 *  (empty kind|value, unknown kind, banned test command, test timeout=exit 124). Never throws. */
export function verifyClaim(kind: string, value: string, runner?: QuestionRunner): VerifyResult {
  if (!kind || !value) return { rc: 2, evidence: "" };
  switch (kind) {
    case "path": {
      try {
        if (existsSync(value)) {
          accessSync(value, constants.R_OK);
          let detail = value;
          try { const st = statSync(value); detail = `${st.isDirectory() ? "d" : "-"} ${st.size} ${value}`; } catch { /* keep bare value */ }
          return { rc: 0, evidence: detail };
        }
      } catch { /* not readable -> refuted */ }
      return { rc: 1, evidence: "" };
    }
    case "git": {
      if (!runner) return { rc: 1, evidence: "" };
      const r = runner.run("git", ["rev-parse", "--verify", value]);
      if (r.code === 0) return { rc: 0, evidence: trimTrailingNewline(r.stdout) };
      return { rc: 1, evidence: "" };
    }
    case "env": {
      const val = process.env[value];
      if (val !== undefined && val !== "") return { rc: 0, evidence: val };
      return { rc: 1, evidence: "" };
    }
    case "cmd": {
      if (!runner) return { rc: 1, evidence: "" };
      const r = runner.run("command", ["-v", "--", value]);
      if (r.code === 0) return { rc: 0, evidence: trimTrailingNewline(r.stdout) };
      return { rc: 1, evidence: "" };
    }
    case "test": {
      if (value.startsWith("tests/run.sh") || value.startsWith("bash tests/run.sh")) return { rc: 2, evidence: "" };
      if (!runner) return { rc: 2, evidence: "" };
      const r = runner.run("timeout", ["30", "bash", "-c", "--", value]);
      const evidence = trimTrailingNewline(r.stdout);
      if (r.code === 124) return { rc: 2, evidence };
      if (r.code === 0) return { rc: 0, evidence };
      return { rc: 1, evidence };
    }
    default:
      return { rc: 2, evidence: "" };
  }
}

/** Format the inbox.md reply body for the part (rebranded From: maestro). Begins with FOUND /
 *  NOT FOUND / UNVERIFIABLE and ends with "Resume implementation.\n". kind=test inserts a NOTE. */
export function formatReply(kind: string, value: string, rc: number, evidence: string): string {
  const verdict = rc === 0 ? "FOUND" : rc === 1 ? "NOT FOUND" : "UNVERIFIABLE";
  let body =
    `From: maestro\n\n` +
    `Verdict: ${verdict}\n` +
    `Claim kind: ${kind}\n` +
    `Claim value: ${value}\n\n` +
    `Evidence:\n` +
    `${evidence}\n\n`;
  if (kind === "test") {
    body +=
      `NOTE: kind=test was a diagnostic check only — running your full test\n` +
      `suite is your job, not mine. Use this protocol for short verification\n` +
      `queries, not for offloading work.\n\n`;
  }
  body += `Resume implementation.\n`;
  return body;
}

/** Conductor-side extractor (port of deploy_question_extract_to_payload, deploy-questions.sh:15):
 *  a question OutboxEvent -> the KV payload file body. consort uses the frozen `message` field for
 *  the reason text (the prior plugin used `text`); `claim:{kind,value}` is the perform discriminator.
 *  Only the newline is percent-encoded at extract time (%0A) — parseQuestionPayload's full table
 *  decodes it. Returns null when there is no usable message. */
export function extractQuestionPayload(ev: OutboxEvent, askedAt: number): string | null {
  const message = typeof ev.message === "string" ? ev.message : "";
  if (message === "") return null;
  const encoded = message.split("\n").join("%0A");
  const claim = ev.claim as { kind?: string; value?: string } | undefined;
  const kind = claim && typeof claim.kind === "string" ? claim.kind : "";
  const value = claim && typeof claim.value === "string" ? claim.value : "";
  const route = claim ? "verify" : "escalate";
  return `TEXT=${encoded}\nCLAIM_KIND=${kind}\nCLAIM_VALUE=${value}\nROUTE=${route}\nASKED_AT=${askedAt}\n`;
}
