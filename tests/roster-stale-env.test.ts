import { describe, it, expect, afterEach } from "vitest";
import { classifyStale, staleThresholdS } from "../src/commands/roster.js";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// guards the threshold the roster call-site sources from the env
const ORIG = process.env.CONSORT_STALE_THRESHOLD_S;
afterEach(() => { if (ORIG === undefined) delete process.env.CONSORT_STALE_THRESHOLD_S; else process.env.CONSORT_STALE_THRESHOLD_S = ORIG; });

function agedOutbox(ageSec: number): string {
  const f = join(mkdtempSync(join(tmpdir(), "ob-")), "outbox.jsonl");
  writeFileSync(f, "{}\n");
  const t = Date.now() / 1000 - ageSec; utimesSync(f, t, t);
  return f;
}

describe("classifyStale honors a custom threshold (L11 semantics)", () => {
  it("a 300s-old working part is 'working' under a 600 threshold but 'stale' under 180", () => {
    const ob = agedOutbox(300);
    expect(classifyStale("working", ob, 600)).toBe("working");
    expect(classifyStale("working", ob, 180)).toBe("stale");
  });
});

describe("staleThresholdS sources the env (CONSORT_STALE_THRESHOLD_S) with shell `:-` parity", () => {
  it("a set numeric value is used verbatim", () => {
    process.env.CONSORT_STALE_THRESHOLD_S = "600";
    expect(staleThresholdS()).toBe(600);
  });
  it("unset falls back to 180", () => {
    delete process.env.CONSORT_STALE_THRESHOLD_S;
    expect(staleThresholdS()).toBe(180);
  });
  it("set-but-empty falls back to 180 (mirrors the sibling shell `${VAR:-180}`, not `?? 180`)", () => {
    process.env.CONSORT_STALE_THRESHOLD_S = "";
    expect(staleThresholdS()).toBe(180);
  });
  it("explicit '0' passes through (set-and-nonempty in the shell) and reaches classifyStale's guard", () => {
    process.env.CONSORT_STALE_THRESHOLD_S = "0";
    expect(staleThresholdS()).toBe(0);
    const ob = agedOutbox(5);
    expect(classifyStale("working", ob, staleThresholdS())).toBe("stale"); // 0s window -> any positive age is stale
  });
  it("invalid input (abc/-5/10.5) yields a value classifyStale falls back to 180 for", () => {
    const ob = agedOutbox(300);
    for (const bad of ["abc", "-5", "10.5"]) {
      process.env.CONSORT_STALE_THRESHOLD_S = bad;
      // classifyStale's guard rejects each non-finite/negative/fractional value and uses 180; 300 > 180 -> stale
      expect(classifyStale("working", ob, staleThresholdS())).toBe("stale");
    }
  });
});
