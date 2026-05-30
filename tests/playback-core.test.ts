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
