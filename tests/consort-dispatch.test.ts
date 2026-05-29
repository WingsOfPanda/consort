import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist", "consort.cjs");
function run(args: string[], env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
    return { code: 0, stdout };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

describe("dispatcher (requires npm run build first)", () => {
  it("unknown subcommand → exit 2", () => {
    expect(run(["nope"]).code).toBe(2);
  });
  it("--mint-args-file prints a path under _args and creates nothing harmful", () => {
    const home = mkdtempSync(join(tmpdir(), "disp-"));
    const r = run(["roster", "--mint-args-file"], { CONSORT_HOME: home });
    expect(r.code).toBe(0);
    const path = r.stdout.trim();
    expect(path).toContain("/_args/");
  });
  it("_banner renders FINE and exits 0 (fast countdown via CONSORT_BANNER_FAST)", () => {
    const r = run(["_banner", "strings-violin:codex:demo", "colour110"], { CONSORT_BANNER_FAST: "1" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("FINE — pane closing");
  });
});
