import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProviderList, readProviderList, planRoster, formatActiveFile, formatProviderFile } from "../src/core/providers.js";

describe("parseProviderList", () => {
  it("keeps providers, skips blank + # lines, trims whitespace", () => {
    expect(parseProviderList("# header\n\ncodex\n  claude  \n#trailing\n")).toEqual(["codex", "claude"]);
  });
  it("empty input → []", () => {
    expect(parseProviderList("")).toEqual([]);
  });
});

describe("readProviderList", () => {
  it("missing file → []", () => {
    expect(readProviderList("/no/such/providers.txt")).toEqual([]);
  });
  it("reads + parses an on-disk file", () => {
    const f = join(mkdtempSync(join(tmpdir(), "pl-")), "providers.txt");
    writeFileSync(f, "# generated …\ncodex\nclaude\n");
    expect(readProviderList(f)).toEqual(["codex", "claude"]);
  });
});

describe("planRoster", () => {
  it("0 validated → skip", () => {
    expect(planRoster({ detectedValidated: [], prior: [] }).decision).toBe("skip");
  });
  it("1 validated → auto + carries the provider", () => {
    const p = planRoster({ detectedValidated: ["codex"], prior: [] });
    expect(p.decision).toBe("auto");
    expect(p.auto).toBe("codex");
  });
  it("2 validated → prompt, no auto field", () => {
    const p = planRoster({ detectedValidated: ["codex", "claude"], prior: [] });
    expect(p.decision).toBe("prompt");
    expect(p.auto).toBeUndefined();
  });
  it("4 validated → prompt", () => {
    expect(planRoster({ detectedValidated: ["codex", "claude", "agy", "opencode"], prior: [] }).decision).toBe("prompt");
  });
  it("drops stale prior with a note, keeps still-detected prior", () => {
    const p = planRoster({ detectedValidated: ["codex", "claude"], prior: ["codex", "gone"] });
    expect(p.prior).toEqual(["codex"]);
    expect(p.dropped).toEqual(["gone (no longer detected)"]);
  });
});

describe("formatActiveFile", () => {
  it("header + one provider per line + trailing newline", () => {
    expect(formatActiveFile(["codex", "claude"], "2026-05-29T00:00:00Z")).toBe(
      "# generated 2026-05-29T00:00:00Z by /consort:soundcheck\n# active providers selected by user\ncodex\nclaude\n",
    );
  });
  it("empty set → headers only, no trailing provider newline", () => {
    expect(formatActiveFile([], "2026-05-29T00:00:00Z")).toBe(
      "# generated 2026-05-29T00:00:00Z by /consort:soundcheck\n# active providers selected by user\n",
    );
  });
});

describe("formatProviderFile", () => {
  it("renders a custom subtitle (the available-file form)", () => {
    expect(formatProviderFile(["codex", "claude"], "2026-05-29T00:00:00Z", "providers detected with binary on PATH + contracts.yaml row")).toBe(
      "# generated 2026-05-29T00:00:00Z by /consort:soundcheck\n# providers detected with binary on PATH + contracts.yaml row\ncodex\nclaude\n",
    );
  });
});
