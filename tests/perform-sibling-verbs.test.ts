// tests/perform-sibling-verbs.test.ts — D1/D2: sibling-baseline / sibling-verify / sibling-rescue verbs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import {
  siblingBaselineWith, siblingVerifyWith, type SiblingDeps,
} from "../src/commands/perform.js";
import type { Runner, RunResult } from "../src/core/gitwork.js";

// A scripted Runner: maps a cwd to a queue/lookup of git responses keyed by the joined argv.
function scriptRunner(table: Record<string, Record<string, RunResult>>): (cwd: string) => Runner {
  return (cwd: string): Runner => ({
    run(_cmd: string, args: string[]): RunResult {
      const key = args.join(" ");
      const forCwd = table[cwd] ?? {};
      return forCwd[key] ?? { code: 0, stdout: "" };
    },
  });
}
const ok = (stdout = ""): RunResult => ({ code: 0, stdout });

describe("perform sibling-baseline / sibling-verify", () => {
  let h: { home: string; cleanup: () => void };
  let art: string;
  let hub: string;
  beforeEach(() => {
    h = freshHome();
    art = performArtDir("topic-d");
    mkdirSync(art, { recursive: true });
    // Two declared parts (api, web) + two real sibling repos (libx, oldcli) + one non-repo (docs).
    hub = join(h.home, "hub");
    for (const slug of ["api", "web", "libx", "oldcli"]) mkdirSync(join(hub, slug, ".git"), { recursive: true });
    mkdirSync(join(hub, "docs"), { recursive: true });
    // parts.txt: declared targets api, web (instrument\tcwd\tprovider).
    writeFileSync(join(art, "parts.txt"),
      `oboe\t${join(hub, "api")}\tcodex\nviola\t${join(hub, "web")}\tcodex\n`);
  });
  afterEach(() => h.cleanup());

  it("sibling-baseline enumerates undeclared sibling repos, captures each HEAD, writes TSV", async () => {
    const deps: SiblingDeps = {
      runnerFor: scriptRunner({
        [join(hub, "libx")]: {
          "rev-parse --git-dir": ok(".git"),
          "symbolic-ref --short HEAD": ok("main\n"),
          "rev-parse HEAD": ok("aaaa111\n"),
        },
        [join(hub, "oldcli")]: {
          "rev-parse --git-dir": ok(".git"),
          "symbolic-ref --short HEAD": ok("master\n"),
          "rev-parse HEAD": ok("bbbb222\n"),
        },
      }),
    };
    const rc = await siblingBaselineWith("topic-d", hub, deps);
    expect(rc).toBe(0);
    // libx + oldcli captured (api/web excluded as declared; docs excluded as non-repo); sorted.
    expect(readFileSync(join(art, "sibling-baseline.txt"), "utf8"))
      .toBe("libx\taaaa111\tmain\noldcli\tbbbb222\tmaster\n");
  });

  it("sibling-baseline rc 1 when hub-cwd is not a directory", async () => {
    const deps: SiblingDeps = { runnerFor: scriptRunner({}) };
    expect(await siblingBaselineWith("topic-d", join(h.home, "nope"), deps)).toBe(1);
  });

  it("sibling-verify writes per-commit TSV <slug>\\t<sha>\\t<subject> for rogue commits", async () => {
    writeFileSync(join(art, "sibling-baseline.txt"), "libx\taaaa111\tmain\noldcli\tbbbb222\tmaster\n");
    const deps: SiblingDeps = {
      runnerFor: scriptRunner({
        [join(hub, "libx")]: {
          "rev-parse --git-dir": ok(".git"),
          "rev-parse --verify -q aaaa111": ok("aaaa111\n"),
          "rev-parse --verify -q refs/heads/main": ok("main\n"),
          "log aaaa111..refs/heads/main --oneline": ok("c2c2 second rogue\nc1c1 first rogue\n"),
        },
        [join(hub, "oldcli")]: {
          "rev-parse --git-dir": ok(".git"),
          "rev-parse --verify -q bbbb222": ok("bbbb222\n"),
          "rev-parse --verify -q refs/heads/master": ok("master\n"),
          "log bbbb222..refs/heads/master --oneline": ok(""),  // clean
        },
      }),
    };
    const rc = await siblingVerifyWith("topic-d", hub, deps);
    expect(rc).toBe(0);
    // newest-first per git log; oldcli clean → omitted.
    expect(readFileSync(join(art, "sibling-rogue.txt"), "utf8"))
      .toBe("libx\tc2c2\tsecond rogue\nlibx\tc1c1\tfirst rogue\n");
  });

  it("sibling-verify rc 1 when sibling-baseline.txt is absent", async () => {
    const deps: SiblingDeps = { runnerFor: scriptRunner({}) };
    expect(await siblingVerifyWith("topic-d", hub, deps)).toBe(1);
  });

  it("sibling-verify rc 1 when hub-cwd is not a directory", async () => {
    const deps: SiblingDeps = { runnerFor: scriptRunner({}) };
    expect(await siblingVerifyWith("topic-d", join(h.home, "nope"), deps)).toBe(1);
  });

  it("sibling-verify writes empty file when no rogue commits", async () => {
    writeFileSync(join(art, "sibling-baseline.txt"), "libx\taaaa111\tmain\n");
    const deps: SiblingDeps = {
      runnerFor: scriptRunner({
        [join(hub, "libx")]: {
          "rev-parse --git-dir": ok(".git"),
          "rev-parse --verify -q aaaa111": ok("aaaa111\n"),
          "rev-parse --verify -q refs/heads/main": ok("main\n"),
          "log aaaa111..refs/heads/main --oneline": ok(""),
        },
      }),
    };
    expect(await siblingVerifyWith("topic-d", hub, deps)).toBe(0);
    expect(readFileSync(join(art, "sibling-rogue.txt"), "utf8")).toBe("");
  });
});
