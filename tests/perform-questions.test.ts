// tests/perform-questions.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { percentDecode, parseQuestionPayload, verifyClaim, formatReply, extractQuestionPayload } from "../src/core/performQuestions.js";
import type { QuestionRunner, RunResult } from "../src/core/performQuestions.js";

function fakeRunner(replies: Record<string, RunResult>) {
  const calls: string[][] = [];
  const r: QuestionRunner = {
    run(cmd, args) { calls.push([cmd, ...args]); return replies[[cmd, ...args].join(" ")] ?? { code: 0, stdout: "" }; },
  };
  return { r, calls };
}

describe("percentDecode", () => {
  it("decodes the 6 escapes", () => {
    expect(percentDecode("a%0Ab")).toBe("a\nb");
    expect(percentDecode("a%09b")).toBe("a\tb");
    expect(percentDecode("say %22hi%22")).toBe('say "hi"');
    expect(percentDecode("path%5Cto")).toBe("path\\to");
    expect(percentDecode("a%2Cb")).toBe("a,b");
    expect(percentDecode("100%25")).toBe("100%");
  });
  it("decodes %25 LAST so nested encodings round-trip", () => {
    expect(percentDecode("%2522")).toBe("%22");
    expect(percentDecode("%250A")).toBe("%0A");
  });
  it("leaves unrelated text untouched", () => {
    expect(percentDecode("hello world")).toBe("hello world");
    expect(percentDecode("")).toBe("");
  });
});

describe("parseQuestionPayload", () => {
  it("verify route: claim present, TEXT percent-decoded", () => {
    const body = "TEXT=line1%0Aline2\nCLAIM_KIND=path\nCLAIM_VALUE=src/a.ts\nROUTE=verify\nASKED_AT=123\n";
    expect(parseQuestionPayload(body)).toEqual({ text: "line1\nline2", claimKind: "path", claimValue: "src/a.ts", route: "verify" });
  });
  it("escalate route: no claim -> kind/value empty, route escalate", () => {
    const body = "TEXT=need%20help\nCLAIM_KIND=\nCLAIM_VALUE=\nROUTE=escalate\nASKED_AT=9\n";
    expect(parseQuestionPayload(body)).toEqual({ text: "need%20help", claimKind: "", claimValue: "", route: "escalate" });
  });
  it("unknown CLAIM_KIND normalizes to empty", () => {
    expect(parseQuestionPayload("TEXT=x\nCLAIM_KIND=bogus\nCLAIM_VALUE=v\nROUTE=verify\n").claimKind).toBe("");
  });
  it("missing ROUTE defaults to escalate; missing TEXT -> empty", () => {
    expect(parseQuestionPayload("CLAIM_KIND=git\nCLAIM_VALUE=HEAD\n").route).toBe("escalate");
    expect(parseQuestionPayload("CLAIM_KIND=git\n").text).toBe("");
  });
  it("CLAIM_VALUE may contain '=' (split on FIRST '=' only)", () => {
    expect(parseQuestionPayload("TEXT=t\nCLAIM_KIND=env\nCLAIM_VALUE=A=B=C\nROUTE=verify\n").claimValue).toBe("A=B=C");
  });
  it("all five known kinds pass through", () => {
    for (const k of ["path", "git", "env", "cmd", "test"]) {
      expect(parseQuestionPayload(`TEXT=x\nCLAIM_KIND=${k}\nCLAIM_VALUE=v\nROUTE=verify\n`).claimKind).toBe(k);
    }
  });
});

describe("verifyClaim — empty/unknown", () => {
  it("empty kind -> rc 2", () => { expect(verifyClaim("", "v").rc).toBe(2); });
  it("empty value -> rc 2", () => { expect(verifyClaim("path", "").rc).toBe(2); });
  it("unknown kind -> rc 2", () => { expect(verifyClaim("bogus", "v").rc).toBe(2); });
});

describe("verifyClaim — path", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pq-path-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  it("existing readable file -> rc 0 with evidence", () => {
    const f = join(dir, "f.txt"); writeFileSync(f, "hi");
    const res = verifyClaim("path", f);
    expect(res.rc).toBe(0); expect(res.evidence).toContain(f);
  });
  it("existing directory -> rc 0", () => {
    const sub = join(dir, "sub"); mkdirSync(sub);
    expect(verifyClaim("path", sub).rc).toBe(0);
  });
  it("missing path -> rc 1", () => {
    expect(verifyClaim("path", join(dir, "nope")).rc).toBe(1);
    expect(verifyClaim("path", join(dir, "nope")).evidence).toBe("");
  });
});

describe("verifyClaim — git (injected runner)", () => {
  it("resolvable ref -> rc 0 with sha evidence (trailing newline stripped)", () => {
    const { r, calls } = fakeRunner({ "git rev-parse --verify HEAD": { code: 0, stdout: "deadbeef\n" } });
    expect(verifyClaim("git", "HEAD", r)).toEqual({ rc: 0, evidence: "deadbeef" });
    expect(calls[0]).toEqual(["git", "rev-parse", "--verify", "HEAD"]);
  });
  it("unknown ref -> rc 1", () => {
    const { r } = fakeRunner({ "git rev-parse --verify nope": { code: 128, stdout: "" } });
    expect(verifyClaim("git", "nope", r)).toEqual({ rc: 1, evidence: "" });
  });
  it("no runner -> rc 1 (cannot resolve)", () => { expect(verifyClaim("git", "HEAD").rc).toBe(1); });
});

describe("verifyClaim — env", () => {
  const KEY = "PQ_TEST_VAR_XYZ";
  afterEach(() => { delete process.env[KEY]; });
  it("set non-empty -> rc 0, evidence is the value", () => {
    process.env[KEY] = "thevalue";
    expect(verifyClaim("env", KEY)).toEqual({ rc: 0, evidence: "thevalue" });
  });
  it("unset -> rc 1", () => { delete process.env[KEY]; expect(verifyClaim("env", KEY)).toEqual({ rc: 1, evidence: "" }); });
  it("set but empty string -> rc 1 (matches bash non-empty test)", () => {
    process.env[KEY] = ""; expect(verifyClaim("env", KEY)).toEqual({ rc: 1, evidence: "" });
  });
});

describe("verifyClaim — cmd (injected runner)", () => {
  it("command present -> rc 0 with path evidence", () => {
    const { r, calls } = fakeRunner({ "command -v -- git": { code: 0, stdout: "/usr/bin/git\n" } });
    expect(verifyClaim("cmd", "git", r)).toEqual({ rc: 0, evidence: "/usr/bin/git" });
    expect(calls[0]).toEqual(["command", "-v", "--", "git"]);
  });
  it("command absent -> rc 1", () => {
    const { r } = fakeRunner({ "command -v -- nope": { code: 1, stdout: "" } });
    expect(verifyClaim("cmd", "nope", r)).toEqual({ rc: 1, evidence: "" });
  });
  it("no runner -> rc 1", () => { expect(verifyClaim("cmd", "git").rc).toBe(1); });
});

describe("verifyClaim — test (injected runner)", () => {
  it("exit 0 -> rc 0 with captured output", () => {
    const { r, calls } = fakeRunner({ "timeout 30 bash -c -- echo ok": { code: 0, stdout: "ok\n" } });
    expect(verifyClaim("test", "echo ok", r)).toEqual({ rc: 0, evidence: "ok" });
    expect(calls[0]).toEqual(["timeout", "30", "bash", "-c", "--", "echo ok"]);
  });
  it("non-zero exit -> rc 1 with output", () => {
    const { r } = fakeRunner({ "timeout 30 bash -c -- false": { code: 1, stdout: "boom\n" } });
    expect(verifyClaim("test", "false", r)).toEqual({ rc: 1, evidence: "boom" });
  });
  it("timeout (exit 124) -> rc 2 unverifiable, not refuted", () => {
    const { r } = fakeRunner({ "timeout 30 bash -c -- sleep 99": { code: 124, stdout: "" } });
    expect(verifyClaim("test", "sleep 99", r).rc).toBe(2);
  });
  it("banned suite command -> rc 2 without running", () => {
    const { r, calls } = fakeRunner({});
    expect(verifyClaim("test", "tests/run.sh", r).rc).toBe(2);
    expect(verifyClaim("test", "bash tests/run.sh --x", r).rc).toBe(2);
    expect(calls.length).toBe(0);
  });
  it("no runner -> rc 2 unverifiable", () => { expect(verifyClaim("test", "echo ok").rc).toBe(2); });
});

describe("formatReply", () => {
  it("rc 0 -> FOUND verdict, ends with Resume directive", () => {
    expect(formatReply("path", "src/a.ts", 0, "- 12 src/a.ts")).toBe(
      "From: maestro\n\nVerdict: FOUND\nClaim kind: path\nClaim value: src/a.ts\n\nEvidence:\n- 12 src/a.ts\n\nResume implementation.\n");
  });
  it("rc 1 -> NOT FOUND", () => { expect(formatReply("git", "HEAD", 1, "")).toContain("Verdict: NOT FOUND"); });
  it("rc 2 -> UNVERIFIABLE", () => { expect(formatReply("cmd", "foo", 2, "")).toContain("Verdict: UNVERIFIABLE"); });
  it("kind=test inserts the NOTE block before resume", () => {
    expect(formatReply("test", "echo ok", 0, "ok")).toBe(
      "From: maestro\n\nVerdict: FOUND\nClaim kind: test\nClaim value: echo ok\n\nEvidence:\nok\n\n" +
      "NOTE: kind=test was a diagnostic check only — running your full test\nsuite is your job, not mine. Use this protocol for short verification\nqueries, not for offloading work.\n\nResume implementation.\n");
  });
  it("non-test kind has no NOTE block", () => { expect(formatReply("env", "HOME", 0, "/home/x")).not.toContain("NOTE: kind=test"); });
  it("uses the rebranded From: maestro sender", () => { expect(formatReply("path", "v", 0, "e")).toContain("From: maestro"); });
});

describe("extractQuestionPayload", () => {
  it("message + claim → verify-route KV payload", () => {
    expect(extractQuestionPayload({ event: "question", message: "need X", claim: { kind: "path", value: "/x" } }, 1700000000))
      .toBe("TEXT=need X\nCLAIM_KIND=path\nCLAIM_VALUE=/x\nROUTE=verify\nASKED_AT=1700000000\n");
  });
  it("message, no claim → escalate route, empty kind/value", () => {
    expect(extractQuestionPayload({ event: "question", message: "should I keep the fallback?" }, 42))
      .toBe("TEXT=should I keep the fallback?\nCLAIM_KIND=\nCLAIM_VALUE=\nROUTE=escalate\nASKED_AT=42\n");
  });
  it("multiline message → %0A encoded, round-trips through parseQuestionPayload", () => {
    const payload = extractQuestionPayload({ event: "question", message: "line1\nline2" }, 7)!;
    expect(payload).toContain("TEXT=line1%0Aline2\n");
    expect(parseQuestionPayload(payload).text).toBe("line1\nline2");
  });
  it("empty/absent message → null", () => {
    expect(extractQuestionPayload({ event: "question", message: "" }, 1)).toBeNull();
    expect(extractQuestionPayload({ event: "question" }, 1)).toBeNull();
  });
});

describe("round-trip: parse then verify then reply", () => {
  it("env claim payload -> FOUND reply", () => {
    process.env.PQ_RT = "yes";
    const body = "TEXT=is%20HOME%20set%3F\nCLAIM_KIND=env\nCLAIM_VALUE=PQ_RT\nROUTE=verify\n";
    const p = parseQuestionPayload(body);
    expect(p.route).toBe("verify");
    const v = verifyClaim(p.claimKind, p.claimValue);
    const reply = formatReply(p.claimKind, p.claimValue, v.rc, v.evidence);
    expect(reply).toContain("Verdict: FOUND");
    expect(reply).toContain("Evidence:\nyes");
    delete process.env.PQ_RT;
  });
});
