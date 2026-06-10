// tests/perform-scope-check.test.ts — scope-check (single-repo only).
// Single-repo cases lock the byte-identical legacy path (target_cwd.txt + branch-base.sha).
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import { scopeCheckWith } from "../src/commands/perform.js";
import type { Runner, RunResult } from "../src/core/gitwork.js";

async function capture(fn: () => Promise<number>): Promise<{ rc: number; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string | Uint8Array) => { out.push(String(s)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array) => { err.push(String(s)); return true; }) as typeof process.stderr.write;
  try { const rc = await fn(); return { rc, out: out.join(""), err: err.join("") }; }
  finally { process.stdout.write = so; process.stderr.write = se; }
}

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

  it("emits SCOPE_DECLARED=<n> on stdout when the design declares component paths", async () => {
    const h = freshHome();
    const art = performArtDir("scope-decl");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "target_cwd.txt"), "/repo/main\n");
    writeFileSync(join(art, "branch-base.sha"), "BASE\n");
    writeFileSync(join(art, "design.md"), "# d\n\n## Components\n\n- `src/a.ts` — edit\n");
    const deps = { runnerFor: (_cwd: string): Runner => ({ run: (): RunResult => ({ code: 0, stdout: "src/a.ts\n" }) }) };
    const { rc, out } = await capture(() => scopeCheckWith("scope-decl", deps));
    expect(rc).toBe(0);
    expect(out).toContain("SCOPE_DECLARED=1\n");
    expect(out).toContain("OOS_COUNT=0\n");
    h.cleanup();
  });

  it("empty-scope: SCOPE_DECLARED=0 on stdout + a WARN, OOS still computed", async () => {
    const h = freshHome();
    const art = performArtDir("scope-empty");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "target_cwd.txt"), "/repo/main\n");
    writeFileSync(join(art, "branch-base.sha"), "BASE\n");
    writeFileSync(join(art, "design.md"), "# d\n\n## Components\n\nprose only, no paths\n");
    const deps = { runnerFor: (_cwd: string): Runner => ({ run: (): RunResult => ({ code: 0, stdout: "src/a.ts\n" }) }) };
    const { rc, out, err } = await capture(() => scopeCheckWith("scope-empty", deps));
    expect(rc).toBe(0);
    expect(out).toContain("SCOPE_DECLARED=0\n");
    expect(out).toContain("OOS_COUNT=1\n");
    expect(err).toContain("0 parseable component paths");
    h.cleanup();
  });
});
