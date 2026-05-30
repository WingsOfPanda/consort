import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHandoffKv, extractHandoffData } from "../src/core/preludeHandoff.js";

describe("buildHandoffKv", () => {
  it("emits the frozen key order with convergence", () => {
    const kv = buildHandoffKv({
      topic: "attention kernels", landscapeDoc: "landscape-2026-05-30-attention.md",
      topApproach: "FlashAttention", findingsPaths: ["findings-rex.md", "findings-viola.md"],
      confidenceSignals: "S1=true,S2=true,S3=true,S4=true,S5=true",
      adversaryFindingsPaths: ["adversary-rex.md"], tradeoffMatrixPresent: true,
      generatedTs: "2026-05-30T00:00:00Z",
    });
    expect(kv).toBe(
      "mode=prelude\n" +
      "topic=attention kernels\n" +
      "landscape_doc=landscape-2026-05-30-attention.md\n" +
      "top_approach=FlashAttention\n" +
      "findings_paths=findings-rex.md,findings-viola.md\n" +
      "confidence_signals=S1=true,S2=true,S3=true,S4=true,S5=true\n" +
      "adversary_findings_paths=adversary-rex.md\n" +
      "tradeoff_matrix_present=true\n" +
      "session_path=.\n" +
      "topic_txt_path=topic.txt\n" +
      "generated_ts=2026-05-30T00:00:00Z\n",
    );
  });
  it("mode=prelude-no-convergence when top_approach empty (and omits related lines)", () => {
    const kv = buildHandoffKv({
      topic: "x", landscapeDoc: "landscape-draft.md", topApproach: "",
      findingsPaths: [], confidenceSignals: "", adversaryFindingsPaths: [],
      tradeoffMatrixPresent: false, generatedTs: "2026-05-30T00:00:00Z",
    });
    expect(kv).toContain("mode=prelude-no-convergence\n");
    expect(kv).not.toContain("top_approach=");
    expect(kv).not.toContain("findings_paths=");
    expect(kv).toContain("tradeoff_matrix_present=false\n");
  });
});

describe("extractHandoffData (reconciled reads)", () => {
  const mk = () => mkdtempSync(join(tmpdir(), "prelude-art-"));
  it("reads adversary-skip.txt for signals and adversary-*.md for findings", () => {
    const art = mk();
    try {
      writeFileSync(join(art, "topic.txt"), "attention kernels\n");
      writeFileSync(join(art, "landscape-2026-05-30-attention.md"),
        "## Approaches\n1. FlashAttention — fused\n## Tradeoff matrix\n| a | b | c |\n");
      writeFileSync(join(art, "findings-rex.md"), "x");
      writeFileSync(join(art, "adversary-skip.txt"),
        "timestamp: t\nsignals_passed: S1=true S2=false S3=true S4=true S5=true\nuser_decision: continue\n");
      writeFileSync(join(art, "adversary-rex.md"), "critique");
      const path = extractHandoffData(art);
      expect(path).toBe(join(art, "handoff-data.kv"));
      const kv = readFileSync(path!, "utf8");
      expect(kv).toContain("mode=prelude\n");
      expect(kv).toContain("top_approach=FlashAttention\n");
      expect(kv).toContain("confidence_signals=S1=true,S2=false,S3=true,S4=true,S5=true\n");
      expect(kv).toContain("adversary_findings_paths=adversary-rex.md\n");
      expect(kv).toContain("tradeoff_matrix_present=true\n");
    } finally { rmSync(art, { recursive: true, force: true }); }
  });
  it("returns null when topic.txt is missing", () => {
    const art = mk();
    try { expect(extractHandoffData(art)).toBeNull(); }
    finally { rmSync(art, { recursive: true, force: true }); }
  });
  it("adversary-*.md glob excludes adversary-skip.txt and *_adversary_prompt.md", () => {
    const art = mk();
    try {
      writeFileSync(join(art, "topic.txt"), "x");
      writeFileSync(join(art, "adversary-skip.txt"), "signals_passed: S1=true S2=true S3=true S4=true S5=true\n");
      writeFileSync(join(art, "viola_adversary_prompt.md"), "prompt");
      writeFileSync(join(art, "adversary-viola.md"), "critique");
      const kv = readFileSync(extractHandoffData(art)!, "utf8");
      expect(kv).toContain("adversary_findings_paths=adversary-viola.md\n");
    } finally { rmSync(art, { recursive: true, force: true }); }
  });
});
