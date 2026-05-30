import { describe, it, expect } from "vitest";
import { computeSignals, renderSkipRecord, matrixBadRows, topApproach } from "../src/core/preludeConfidence.js";

// NOTE on S4: the ported bash heuristic (grep -cE '^\| [^|]+\| [^|]+\| [^/:][^|]*\|$') flags any
// matrix row whose Reason (3rd) cell's FIRST char is not '/' or ':'. This is intentionally
// byte-faithful and strict — a conventional markdown header row ("| Priority | Best fit | Reason |")
// is itself counted as bad. The all-hold fixture below therefore uses a header-less matrix whose
// one Reason cell starts with '/'. The strictness is exercised directly by the matrixBadRows test.
const DRAFT_OK = [
  "## Topic",
  "x",
  "## Approaches",
  "1. FlashAttention — fused kernel",
  "2. Ring attention — sharded",
  "## Tradeoff matrix",
  "| latency | FlashAttention | /papers see https://arxiv.org/abs/2205.14135 |",
  "## Citations",
  "- https://arxiv.org/abs/2205.14135",
].join("\n");

const FIND_A = "FlashAttention is fast. https://arxiv.org/abs/2205.14135 . I am uncertain about batch.";
const FIND_B = "FlashAttention wins. https://arxiv.org/abs/2205.14135 confirms it.";

describe("computeSignals", () => {
  it("all hold on a clean draft (N=2)", () => {
    const s = computeSignals(DRAFT_OK, [FIND_A, FIND_B]);
    expect(s).toEqual({ s1: true, s2: true, s3: true, s4: true, s5: true, allHold: true });
  });
  it("S3 false when CONTESTED appears", () => {
    const s = computeSignals(DRAFT_OK + "\nCONTESTED: ring vs flash", [FIND_A, FIND_B]);
    expect(s.s3).toBe(false);
    expect(s.allHold).toBe(false);
  });
  it("S1 false when top approach is absent from N-1 findings", () => {
    const s = computeSignals(DRAFT_OK, ["nothing relevant here", "also nothing"]);
    expect(s.s1).toBe(false);
  });
  it("S2 false when a draft citation is solo-cited (< 2 findings)", () => {
    const draft = DRAFT_OK.replace("## Citations", "## Citations\n- https://solo.example/x");
    const s = computeSignals(draft, [FIND_A + " https://solo.example/x", FIND_B]);
    expect(s.s2).toBe(false);
  });
  it("S4 false when a matrix Reason cell starts with prose (no leading / or : anchor)", () => {
    const draft = DRAFT_OK.replace(
      "/papers see https://arxiv.org/abs/2205.14135",
      "it is simply faster, per https://arxiv.org/abs/2205.14135",
    );
    const s = computeSignals(draft, [FIND_A, FIND_B]);
    expect(s.s4).toBe(false);
  });
  it("S5 false when no finding acknowledges uncertainty", () => {
    const s = computeSignals(DRAFT_OK, [
      "FlashAttention. https://arxiv.org/abs/2205.14135",
      FIND_B.replace("confirms it.", "confirms it. https://arxiv.org/abs/2205.14135"),
    ]);
    expect(s.s5).toBe(false);
  });
});

describe("topApproach", () => {
  it("strips the numbering and the em-dash tail", () => {
    expect(topApproach(DRAFT_OK)).toBe("FlashAttention");
  });
  it("empty when no Approaches section", () => {
    expect(topApproach("## Topic\nx")).toBe("");
  });
});

describe("matrixBadRows (faithful strict heuristic)", () => {
  it("counts a markdown header row as bad; excludes the |--- separator and a /-anchored row", () => {
    const m = [
      "## Tradeoff matrix",
      "| Priority | Best fit | Reason |",
      "|---|---|---|",
      "| latency | flash | /papers/flash.pdf |",
      "## End",
    ].join("\n");
    expect(matrixBadRows(m)).toBe(1); // only the header trips it
  });
});

describe("renderSkipRecord", () => {
  it("emits the 3-line body with the chosen decision", () => {
    const body = renderSkipRecord({
      signals: { s1: true, s2: true, s3: true, s4: true, s5: true, allHold: true },
      decision: "skip", now: "2026-05-30T00:00:00Z",
    });
    expect(body).toBe(
      "timestamp: 2026-05-30T00:00:00Z\n" +
      "signals_passed: S1=true S2=true S3=true S4=true S5=true\n" +
      "user_decision: skip\n",
    );
  });
});
