import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { realpathSync, existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as P from "../src/core/paths.js";

afterEach(() => { delete process.env.CONSORT_HOME; });

describe("paths", () => {
  it("stateRoot: default vs env-verbatim", () => {
    delete process.env.CONSORT_HOME;
    expect(P.stateRoot({ cwd: "/proj" })).toBe("/proj/.consort");
    process.env.CONSORT_HOME = "/tmp/xx/cs-test";
    expect(P.stateRoot()).toBe("/tmp/xx/cs-test"); // verbatim, no /.consort suffix
  });
  it("repoHash: 64 lowercase hex, matches node crypto, deterministic", () => {
    const dir = mkdtempSync(join(tmpdir(), "rh-"));
    const expected = createHash("sha256").update(realpathSync(dir), "utf8").digest("hex");
    expect(P.repoHash(dir)).toBe(expected);
    expect(P.repoHash(dir)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("path composition", () => {
    process.env.CONSORT_HOME = "/R";
    const h = P.repoHash(process.cwd());
    expect(P.repoStateDir()).toBe(`/R/state/${h}`);
    expect(P.topicDir("foo")).toBe(`/R/state/${h}/foo`);
    expect(P.partDir("violin", "codex", "foo")).toBe(`/R/state/${h}/foo/violin-codex`);
  });
  it("isArtifactDir", () => {
    expect(P.isArtifactDir("/a/b/_consult")).toBe(true);
    expect(P.isArtifactDir("/a/b/violin-codex")).toBe(false);
  });
  it("runDir: unique, .gitignore, .last, sweep", () => {
    process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "rd-"));
    const a = P.runDir("score");
    const b = P.runDir("score");
    expect(a).not.toBe(b);
    expect(readFileSync(join(process.env.CONSORT_HOME, "_run", ".gitignore"), "utf8")).toBe("*\n");
    expect(P.runDirLast()).toBe(b); // no trailing newline
    // stale sweep
    const stale = join(process.env.CONSORT_HOME, "_run", "score.STALE");
    mkdirSync(stale);
    const old = (Date.now() - 100000_000) / 1000;
    utimesSync(stale, old, old);
    P.runDir("score");
    expect(existsSync(stale)).toBe(false);
  });
  it("runArgsFile records path with no newline", () => {
    process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "ra-"));
    const f = P.runArgsFile("score");
    expect(f).toContain("/_args/");
    const recorded = readFileSync(join(P.runDirLast(), "args-path.txt"), "utf8");
    expect(recorded).toBe(f); // exact, no newline
  });
  it("runDirLast throws when absent", () => {
    process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "rl-"));
    expect(() => P.runDirLast()).toThrow();
  });
  it("activeProvidersPath: prefers active when present, else available", () => {
    const home = mkdtempSync(join(tmpdir(), "ap-"));
    process.env.CONSORT_HOME = home;
    // no curated active file yet → resolver returns the medic-detected available path
    expect(P.activeProvidersPath()).toBe(join(home, "providers-available.txt"));
    // once the user-curated active file exists → resolver prefers it
    writeFileSync(join(home, "providers-active.txt"), "codex\n");
    expect(P.activeProvidersPath()).toBe(join(home, "providers-active.txt"));
  });
});
