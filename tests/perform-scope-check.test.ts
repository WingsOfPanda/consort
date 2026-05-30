// tests/perform-scope-check.test.ts — D4: multi-repo-aware scope-check.
// Single-repo cases lock the byte-identical legacy path; multi-repo cases exercise the
// per-sub-repo diff prefixed with <repo>/ (deploy.md:1304-1319 multi-repo branch).
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import { scopeCheckWith } from "../src/commands/perform.js";
import type { Runner, RunResult } from "../src/core/gitwork.js";

describe("perform scope-check (single-repo path locked)", () => {
  it("single-repo: one out-of-scope path → scope-out-of-scope.txt + OOS_COUNT=1, rc 0", async () => {
    const h = freshHome();
    const art = performArtDir("scope-s");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "target_cwd.txt"), "/repo/main\n");
    writeFileSync(join(art, "branch-base.sha"), "BASE\n");
    writeFileSync(join(art, "design.md"),
      "# d\n\n## Components\n\n| File | Note |\n| --- | --- |\n| `src/a.ts` | x |\n");
    const deps = {
      runnerFor: (_cwd: string): Runner => ({
        run: (_c: string, _a: string[]): RunResult => ({ code: 0, stdout: "src/a.ts\nsrc/rogue.ts\n" }),
      }),
    };
    const rc = await scopeCheckWith("scope-s", deps);
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "diff-paths.txt"), "utf8")).toBe("src/a.ts\nsrc/rogue.ts\n");
    expect(readFileSync(join(art, "scope-out-of-scope.txt"), "utf8")).toBe("src/rogue.ts\n");
    h.cleanup();
  });

  it("single-repo: missing target_cwd.txt/branch-base.sha → rc 1", async () => {
    const h = freshHome();
    const art = performArtDir("scope-s2");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "design.md"), "# d\n\n## Components\n");
    const deps = { runnerFor: (_cwd: string): Runner => ({ run: (): RunResult => ({ code: 0, stdout: "" }) }) };
    expect(await scopeCheckWith("scope-s2", deps)).toBe(1);
    h.cleanup();
  });
});

describe("perform scope-check (multi-repo path)", () => {
  // Multi-repo scope-check: a sub-repo file outside the Components table is flagged, prefixed <repo>/.
  it("multi-repo: flags out-of-scope sub-repo paths prefixed with the repo slug", async () => {
    const h = freshHome();
    const art = performArtDir("scope-m");
    mkdirSync(join(art, "baselines"), { recursive: true });
    const apiCwd = join(h.home, "api"), webCwd = join(h.home, "web");
    writeFileSync(join(art, "parts.txt"), `oboe\t${apiCwd}\tcodex\nviola\t${webCwd}\tcodex\n`);
    writeFileSync(join(art, "baselines", "oboe.tsv"), "baseline_sha=base_a\n");
    writeFileSync(join(art, "baselines", "viola.tsv"), "baseline_sha=base_w\n");
    // Components table declares api/src/** only; web/src/rogue.ts is out of scope.
    writeFileSync(join(art, "design.md"),
      "# D\n\n## Components\n\n| Path | Role |\n|---|---|\n| `api/src/` | api |\n");
    const deps = {
      runnerFor: (cwd: string): Runner => ({
        run: (_c: string, _a: string[]): RunResult => ({
          code: 0,
          stdout: cwd.endsWith("api") ? "src/a.ts\n" : "src/rogue.ts\n",
        }),
      }),
    };
    const rc = await scopeCheckWith("scope-m", deps);
    expect(rc).toBe(0);
    const diffPaths = readFileSync(join(art, "diff-paths.txt"), "utf8");
    expect(diffPaths).toContain("api/src/a.ts");
    expect(diffPaths).toContain("web/src/rogue.ts");
    // web/src/rogue.ts is NOT under api/src/ → out of scope.
    expect(readFileSync(join(art, "scope-out-of-scope.txt"), "utf8")).toContain("web/src/rogue.ts");
    h.cleanup();
  });
});
