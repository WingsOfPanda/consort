import { describe, it, expect } from "vitest";
import { parseVerdicts, adjudicate, type AdjudicateInput } from "../src/core/scoreAdjudicate.js";

const verdictsMd = (...lines: string[]) => "## Verdicts\n" + lines.join("\n") + "\n";

describe("parseVerdicts", () => {
  it("parses AGREE/DISPUTE/UNCERTAIN under ## Verdicts with optional indented evidence", () => {
    const md = [
      "# Verify", "## Verdicts",
      "1. AGREE [src/a.ts:1] claim one",
      "   confirmed by reading the file",
      "2. DISPUTE [src/b.ts:2] claim two",
      "3. UNCERTAIN [https://x] claim three",
      "   could not fetch",
      "   second evidence line",
      "## Notes", "4. AGREE [out/scope] ignored (outside block)",
    ].join("\n");
    expect(parseVerdicts(md)).toEqual([
      { tag: "AGREE", cite: "src/a.ts:1", text: "claim one", evidence: "confirmed by reading the file" },
      { tag: "DISPUTE", cite: "src/b.ts:2", text: "claim two", evidence: "" },
      { tag: "UNCERTAIN", cite: "https://x", text: "claim three", evidence: "could not fetch second evidence line" },
    ]);
  });
  it("hallucinated tags (UNKNOWN/MAYBE) are dropped; no block → []", () => {
    expect(parseVerdicts("## Verdicts\n1. MAYBE [a] x\n")).toEqual([]);
    expect(parseVerdicts("# V\n")).toEqual([]);
  });
});

describe("adjudicate N=2", () => {
  it("AGREE→Cross-verified (cody first), non-AGREE→PENDING, Not-verified on failed VS", () => {
    const input: AdjudicateInput = {
      parts: [{ commander: "rex", provider: "codex" }, { commander: "cody", provider: "claude" }],
      verify: {
        rex: verdictsMd("1. AGREE [a.ts:1] shared claim", "   rex confirms"),
        cody: verdictsMd("1. DISPUTE [c.ts:1] cody-only thing", "   cody disputes"),
      },
      vs: { rex: "ok", cody: "ok" },
      buckets: { "rex_only_items.txt": "", "cody_only_items.txt": "" },
    };
    const out = adjudicate(input);
    expect(out).toContain("## Cross-verified\n- [a.ts:1] shared claim — REX confirmed: rex confirms\n");
    expect(out).toContain("## Adjudicated\n");
    expect(out).toContain("- PENDING: [c.ts:1] cody-only thing — CODY DISPUTE: cody disputes\n");
    expect(out).toContain("Maestro");        // the comment rebrand
    expect(out).not.toContain("Master Yoda");
    expect(out).toContain("## Contested\n");
    expect(out).toContain("## Not-verified\n");
  });
  it("Not-verified lists the other part's _only items when a VS dispatch failed", () => {
    const input: AdjudicateInput = {
      parts: [{ commander: "rex", provider: "codex" }, { commander: "cody", provider: "claude" }],
      verify: {}, vs: { rex: "timeout", cody: "ok" },
      buckets: { "rex_only_items.txt": "[r.ts:1] rex item\n", "cody_only_items.txt": "[c.ts:1] cody item\n" },
    };
    const out = adjudicate(input);
    // rex VS=timeout → its assigned set (cody_only) is not-verified, annotated REX … timeout
    expect(out).toContain("- [c.ts:1] cody item — REX verify dispatch timeout\n");
  });
});

describe("adjudicate N=3 (_classify)", () => {
  function n3(ownerBucket: string, ownersCsv: string, verifierVerdicts: Record<string, string>): string {
    const parts = [{ commander: "rex", provider: "codex" }, { commander: "cody", provider: "claude" }, { commander: "bly", provider: "agy" }];
    const verify: Record<string, string> = {};
    for (const [cmdr, tag] of Object.entries(verifierVerdicts)) verify[cmdr] = verdictsMd(`1. ${tag} [x.ts:1] the claim`);
    return adjudicate({ parts, verify, vs: {}, buckets: { [ownerBucket]: "[x.ts:1] the claim\n" } });
  }
  it("single-owner, all verifiers AGREE → Cross-verified", () => {
    expect(n3("rex_only_items.txt", "rex", { cody: "AGREE", bly: "AGREE" })).toContain("## Cross-verified\n- [x.ts:1] the claim");
  });
  it("single-owner, all verifiers DISPUTE → Refuted", () => {
    expect(n3("rex_only_items.txt", "rex", { cody: "DISPUTE", bly: "DISPUTE" })).toContain("## Refuted\n- [x.ts:1] the claim");
  });
  it("single-owner, all verifiers UNCERTAIN → Contested", () => {
    expect(n3("rex_only_items.txt", "rex", { cody: "UNCERTAIN", bly: "UNCERTAIN" })).toContain("## Contested\n- [x.ts:1] the claim");
  });
  it("mixed UNCERTAIN + AGREE → PENDING", () => {
    expect(n3("rex_only_items.txt", "rex", { cody: "AGREE", bly: "UNCERTAIN" })).toMatch(/## - PENDING:[\s\S]*- \[x\.ts:1\] the claim/);
  });
  it("consensus.txt lines → Consensus section with [all] srcset", () => {
    const parts = [{ commander: "rex", provider: "codex" }, { commander: "cody", provider: "claude" }, { commander: "bly", provider: "agy" }];
    const out = adjudicate({ parts, verify: {}, vs: {}, buckets: { "consensus.txt": "[a.ts:1] everyone agrees\n" } });
    expect(out).toContain("## Consensus findings (all troopers)\n- [a.ts:1] everyone agrees [rex+cody+bly]\n");
  });
});
