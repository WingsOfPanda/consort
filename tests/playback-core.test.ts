// tests/playback-core.test.ts — pure logic for /consort:playback.
import { describe, it, expect } from "vitest";
import {
  parseSince, parseForensicsFrontmatter, parseMechanicalFindings,
} from "../src/core/playback.js";

describe("parseSince", () => {
  it("Nd / Nh to cutoff epoch-ms", () => {
    const now = 1_000_000_000_000;
    expect(parseSince("2d", now)).toBe(now - 2 * 86_400_000);
    expect(parseSince("6h", now)).toBe(now - 6 * 3_600_000);
  });
  it("rejects a bad spec", () => {
    expect(() => parseSince("2w", 0)).toThrow();
    expect(() => parseSince("x", 0)).toThrow();
  });
});

describe("parseForensicsFrontmatter", () => {
  const doc =
    "---\ncommand: perform\ntopic: add-oauth\ntopic_slug: add-oauth\n" +
    "repo_hash: abc\nart_dir: /x\ninvoked_at: 2026-05-30T00:00:00Z\nn_findings_mechanical: 3\n---\n\n## Mechanical findings\n";
  it("parses command / topic / n_findings", () => {
    expect(parseForensicsFrontmatter(doc)).toEqual({ command: "perform", topic: "add-oauth", nFindings: 3 });
  });
  it("missing keys -> empty / 0", () => {
    expect(parseForensicsFrontmatter("no frontmatter here")).toEqual({ command: "", topic: "", nFindings: 0 });
  });
  it("non-numeric n_findings_mechanical -> 0 (NaN guard)", () => {
    expect(parseForensicsFrontmatter("n_findings_mechanical: not-a-number")).toEqual({ command: "", topic: "", nFindings: 0 });
  });
});

describe("parseMechanicalFindings", () => {
  it("parses bullets back into findings (inverse of renderArtForensics)", () => {
    const body =
      "## Mechanical findings\n\n" +
      "- **audit_log** ISSUE=todo_marker _(source: audit.log)_\n" +
      '- **outbox** {"event":"error","reason":"timeout"} _(source: part=oboe)_\n';
    expect(parseMechanicalFindings(body)).toEqual([
      { source: "audit_log", key: "ISSUE=todo_marker", context: "audit.log" },
      { source: "outbox", key: '{"event":"error","reason":"timeout"}', context: "part=oboe" },
    ]);
  });
  it("key with spaces round-trips (non-greedy key / greedy context boundary)", () => {
    const body = "- **spawn_results** rc=124 reason=timeout _(source: part=oboe)_\n";
    expect(parseMechanicalFindings(body)).toEqual([
      { source: "spawn_results", key: "rc=124 reason=timeout", context: "part=oboe" },
    ]);
  });
  it("skips malformed lines", () => {
    expect(parseMechanicalFindings("- not a finding\nrandom text")).toEqual([]);
  });
});

import { findingSignature, normalizeVolatile } from "../src/core/playback.js";

describe("normalizeVolatile", () => {
  it("strips ts / sha / path / bare ints", () => {
    expect(normalizeVolatile("at /home/x/y.ts:42 sha 3827f1c4f6 t 2026-05-30T00:00:00Z n 7"))
      .toBe("at <path> sha <sha> t <ts> n <n>");
  });
});

describe("findingSignature (per-source)", () => {
  it("audit_log -> first ISSUE token (drops trailing fields)", () => {
    expect(findingSignature({ source: "audit_log", key: "ISSUE=unresolved_placeholder", context: "audit.log" }))
      .toBe("audit_log||ISSUE=unresolved_placeholder");
    expect(findingSignature({ source: "audit_log", key: "ISSUE=todo_marker SECTION=ASK", context: "audit.log" }))
      .toBe("audit_log||ISSUE=todo_marker");
  });
  it("status -> state verbatim", () => {
    expect(findingSignature({ source: "status", key: "state=error", context: "part=oboe" }))
      .toBe("status||state=error");
  });
  it("spawn_results -> rc + reason word (lowercased)", () => {
    expect(findingSignature({ source: "spawn_results", key: "rc=124 reason=Timeout waiting", context: "part=oboe" }))
      .toBe("spawn_results||rc=124 reason=timeout");
  });
  it("spawn_results with no reason -> bare rc (empty reason column)", () => {
    expect(findingSignature({ source: "spawn_results", key: "rc=124", context: "part=oboe" }))
      .toBe("spawn_results||rc=124");
  });
  it("outbox -> event + reason from JSON (volatile bits ignored)", () => {
    expect(findingSignature({ source: "outbox", key: '{"event":"error","reason":"dispatch_timeout","ts":"2026-05-30T00:00:00Z"}', context: "part=oboe" }))
      .toBe("outbox||event=error reason=dispatch_timeout");
    expect(findingSignature({ source: "outbox", key: '{"event":"question"}', context: "part=oboe" }))
      .toBe("outbox||event=question");
  });
  it("outbox non-JSON key -> normalized-class fallback", () => {
    expect(findingSignature({ source: "outbox", key: "not json sha 3827f1c4f6", context: "part=oboe" }))
      .toBe("outbox||not json sha <sha>");
  });
  it("session_log -> volatile-normalized error class", () => {
    expect(findingSignature({ source: "session_log", key: "[error] failed at /home/x/y.ts:42 sha 3827f1c4f6", context: "dispatch.log" }))
      .toBe("session_log||[error] failed at <path> sha <sha>");
  });
  it("unknown source -> coarse fallback", () => {
    expect(findingSignature({ source: "weird", key: "x 2026-05-30T00:00:00Z", context: "c" }))
      .toBe("weird||x <ts>");
  });
});

import { parseTrendLedger, accrue, renderTrendDigest, reviewedTarget } from "../src/core/playback.js";

describe("trend ledger", () => {
  it("parse: null / corrupt -> empty; valid -> counts", () => {
    expect(parseTrendLedger(null)).toEqual({ counts: {} });
    expect(parseTrendLedger("not json")).toEqual({ counts: {} });
    expect(parseTrendLedger("[]")).toEqual({ counts: {} });
    expect(parseTrendLedger('{"x":1}')).toEqual({ counts: {} });
    const l = parseTrendLedger('{"counts":{"a||x":{"count":2,"firstSeen":"2026-05-01","lastSeen":"2026-05-02"}}}');
    expect(l.counts["a||x"].count).toBe(2);
  });
  it("accrue: first-seen sets both dates; repeat bumps count + lastSeen", () => {
    const l = { counts: {} as Record<string, { count: number; firstSeen: string; lastSeen: string }> };
    accrue(l, [{ source: "status", key: "state=error", context: "part=a" }], "2026-05-01");
    expect(l.counts["status||state=error"]).toEqual({ count: 1, firstSeen: "2026-05-01", lastSeen: "2026-05-01" });
    accrue(l, [{ source: "status", key: "state=error", context: "part=b" }], "2026-05-03");
    expect(l.counts["status||state=error"]).toEqual({ count: 2, firstSeen: "2026-05-01", lastSeen: "2026-05-03" });
  });
  it("renderTrendDigest: count desc then signature asc; topN", () => {
    const l = { counts: { "a||x": { count: 1, firstSeen: "d", lastSeen: "d" }, "b||y": { count: 5, firstSeen: "d", lastSeen: "d" } } };
    expect(renderTrendDigest(l).map((r) => r.signature)).toEqual(["b||y", "a||x"]);
    expect(renderTrendDigest(l, 1).map((r) => r.signature)).toEqual(["b||y"]);
  });
});

describe("reviewedTarget", () => {
  const root = "/home/u/.consort/forensics";
  it("live file -> .reviewed/<date>/<file>", () => {
    expect(reviewedTarget(root, `${root}/2026-05-30/11-00-00-perform-x.md`))
      .toBe(`${root}/.reviewed/2026-05-30/11-00-00-perform-x.md`);
  });
  it("already reviewed -> unchanged (idempotent)", () => {
    expect(reviewedTarget(root, `${root}/.reviewed/2026-05-30/f.md`)).toBe(`${root}/.reviewed/2026-05-30/f.md`);
  });
  it("not under root -> null", () => {
    expect(reviewedTarget(root, "/tmp/x.md")).toBeNull();
  });
});
