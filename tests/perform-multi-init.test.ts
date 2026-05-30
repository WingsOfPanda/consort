// tests/perform-multi-init.test.ts — C3: perform multi-init (deploy-multi-init.sh) roster +
// send-unit (deploy.md Step 3b per-repo dispatch) dag-unit prompt verbs. Injected deps; no real
// panes/git. CONSORT_HOME temp; byte-exact parts.txt + branch-base.sha asserts; iterTargets round-trip.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir, iterTargets } from "../src/core/perform.js";
import type { Runner, RunResult } from "../src/core/gitwork.js";
import {
  run, multiInitWith, sendUnitWith, type MultiInitDeps, type SendUnitDeps,
} from "../src/commands/perform.js";

const TOPIC = "multi-svc";

// ---- fakeRunner: maps "cmd arg arg..." -> {code,stdout}; unscripted argv -> {code:0,stdout:""}. ----
function fakeRunner(script: Record<string, { code?: number; stdout?: string }>): Runner {
  return {
    run(cmd: string, args: string[]): RunResult {
      const key = [cmd, ...args].join(" ");
      const hit = script[key];
      return { code: hit?.code ?? 0, stdout: hit?.stdout ?? "" };
    },
  };
}

// capture process.stdout.write + process.stderr.write for the duration of fn().
async function capture(fn: () => Promise<number>): Promise<{ rc: number; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string | Uint8Array) => { out.push(String(s)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array) => { err.push(String(s)); return true; }) as typeof process.stderr.write;
  try { const rc = await fn(); return { rc, out: out.join(""), err: err.join("") }; }
  finally { process.stdout.write = so; process.stderr.write = se; }
}

function seedArt(): string {
  const art = performArtDir(TOPIC);
  mkdirSync(art, { recursive: true });
  return art;
}

// create a sub-repo dir <hub>/<name> with a CLAUDE.md (or AGENTS.md) by default.
function seedSubRepo(hub: string, name: string, marker: "CLAUDE.md" | "AGENTS.md" | "none"): string {
  const cwd = join(hub, name);
  mkdirSync(cwd, { recursive: true });
  if (marker !== "none") writeFileSync(join(cwd, marker), "# guide\n");
  return cwd;
}

describe("perform multi-init (deploy-multi-init.sh — one part per sub-repo in DAG order)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  function depsFor(instruments: string[], sha = "deadbeef\n"): MultiInitDeps {
    return {
      detectProvider: () => "codex",
      pickInstruments: () => instruments,
      runnerFor: () => fakeRunner({ "git rev-parse HEAD": { code: 0, stdout: sha } }),
    };
  }

  it("happy: 2 sub-repos → parts.txt (3-col, first-occurrence order) + per-instrument branch-base.sha, rc 0", async () => {
    const art = seedArt();
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\tnone\tbuild\n2\t2\tweb\tnone\twire\n");
    const apiCwd = seedSubRepo(h.home, "api", "CLAUDE.md");
    const webCwd = seedSubRepo(h.home, "web", "CLAUDE.md");
    const { rc } = await capture(() => multiInitWith(TOPIC, h.home, depsFor(["viola", "cello"])));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "parts.txt"), "utf8")).toBe(`viola\t${apiCwd}\tcodex\ncello\t${webCwd}\tcodex\n`);
    expect(readFileSync(join(art, "viola-branch-base.sha"), "utf8")).toBe("deadbeef\n");
    expect(readFileSync(join(art, "cello-branch-base.sha"), "utf8")).toBe("deadbeef\n");
  });

  it("first-occurrence order: a repo in two dag-waves rows yields ONE part, in first-seen order", async () => {
    const art = seedArt();
    // api appears at rows 1 and 3; web at row 2. first-seen order is api, web.
    writeFileSync(join(art, "dag-waves.txt"),
      "1\t1\tapi\tnone\tbuild\n2\t2\tweb\tnone\twire\n3\t3\tapi\tnone\tfinish\n");
    const apiCwd = seedSubRepo(h.home, "api", "CLAUDE.md");
    const webCwd = seedSubRepo(h.home, "web", "CLAUDE.md");
    const { rc } = await capture(() => multiInitWith(TOPIC, h.home, depsFor(["viola", "cello"])));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "parts.txt"), "utf8")).toBe(`viola\t${apiCwd}\tcodex\ncello\t${webCwd}\tcodex\n`);
  });

  it("missing dag-waves.txt → rc 1", async () => {
    seedArt(); // no dag-waves.txt
    const { rc } = await capture(() => multiInitWith(TOPIC, h.home, depsFor(["viola", "cello"])));
    expect(rc).toBe(1);
  });

  it("sub-repo dir missing → rc 1", async () => {
    const art = seedArt();
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\tnone\tbuild\n");
    // do NOT create <hub>/api
    const { rc } = await capture(() => multiInitWith(TOPIC, h.home, depsFor(["viola"])));
    expect(rc).toBe(1);
  });

  it("sub-repo without CLAUDE.md/AGENTS.md → rc 1", async () => {
    const art = seedArt();
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\tnone\tbuild\n");
    seedSubRepo(h.home, "api", "none"); // dir exists but no guide marker
    const { rc } = await capture(() => multiInitWith(TOPIC, h.home, depsFor(["viola"])));
    expect(rc).toBe(1);
  });

  it("instrument pool exhausted (1 instrument, 2 repos) → rc 1", async () => {
    const art = seedArt();
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\tnone\tbuild\n2\t2\tweb\tnone\twire\n");
    seedSubRepo(h.home, "api", "CLAUDE.md");
    seedSubRepo(h.home, "web", "CLAUDE.md");
    const { rc } = await capture(() => multiInitWith(TOPIC, h.home, depsFor(["viola"])));
    expect(rc).toBe(1);
  });

  it("round-trip: parts.txt written by multi-init is byte-transparent to the 2-col iterTargets reader", async () => {
    const art = seedArt();
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\tnone\tbuild\n2\t2\tweb\tnone\twire\n");
    const apiCwd = seedSubRepo(h.home, "api", "CLAUDE.md");
    const webCwd = seedSubRepo(h.home, "web", "CLAUDE.md");
    const { rc } = await capture(() => multiInitWith(TOPIC, h.home, depsFor(["viola", "cello"])));
    expect(rc).toBe(0);
    expect(iterTargets(TOPIC)).toEqual([
      { slug: "viola", cwd: apiCwd },
      { slug: "cello", cwd: webCwd },
    ]);
  });

  it("AGENTS.md alone satisfies the guide check → rc 0", async () => {
    const art = seedArt();
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\tnone\tbuild\n");
    seedSubRepo(h.home, "api", "AGENTS.md");
    const { rc } = await capture(() => multiInitWith(TOPIC, h.home, depsFor(["viola"])));
    expect(rc).toBe(0);
  });

  it("multiInitRun arg validation: wrong arg count → rc 2", async () => {
    const { rc } = await capture(() => run(["multi-init", TOPIC])); // only 1 of 2 args
    expect(rc).toBe(2);
  });
});

describe("perform send-unit (deploy.md Step 3b — compose + deliver the dag-unit prompt)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  // seed parts.txt (3-col), dag-waves (api step1, web step2), dag-edges (1->2), design.md.
  function seedSendUnit(art: string): { apiCwd: string; webCwd: string } {
    const apiCwd = join(h.home, "api");
    const webCwd = join(h.home, "web");
    writeFileSync(join(art, "parts.txt"), `viola\t${apiCwd}\tcodex\ncello\t${webCwd}\tcodex\n`);
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\tnone\tbuild\n2\t2\tweb\tnone\twire\n");
    writeFileSync(join(art, "dag-edges.txt"), "1\t2\n");
    writeFileSync(join(art, "design.md"), "# T\n## Execution DAG\n1. api — build\n2. web — wire\n");
    return { apiCwd, webCwd };
  }

  it("web (wave 2): composes prompt with depends-on api; calls send with maestro+cello args; rc 0", async () => {
    const art = seedArt();
    seedSendUnit(art);
    let captured: string[] = [];
    const deps: SendUnitDeps = { send: async (a) => { captured = a; return 0; } };
    const { rc } = await capture(() => sendUnitWith(TOPIC, "web", deps));
    expect(rc).toBe(0);
    const prompt = readFileSync(join(art, "cello_dag_unit_prompt.md"), "utf8");
    expect(prompt).toContain('Your sub-repo is "web"');
    expect(prompt).toContain("Step 2 of 2");
    expect(prompt).toContain("you depend on: api");
    expect(captured).toEqual(["--from", "maestro", "cello", TOPIC, `@${join(art, "cello_dag_unit_prompt.md")}`]);
  });

  it("api (wave 1, no upstream): prompt has no upstream, log line says upstream: none; rc 0", async () => {
    const art = seedArt();
    seedSendUnit(art);
    const deps: SendUnitDeps = { send: async () => 0 };
    const { rc, err } = await capture(() => sendUnitWith(TOPIC, "api", deps));
    expect(rc).toBe(0);
    expect(err).toContain("upstream: none");
    const prompt = readFileSync(join(art, "viola_dag_unit_prompt.md"), "utf8");
    expect(prompt).toContain('Your sub-repo is "api"');
    expect(prompt).toContain("Step 1 of 2");
  });

  it("repo not in parts.txt → rc 1", async () => {
    const art = seedArt();
    seedSendUnit(art);
    const deps: SendUnitDeps = { send: async () => 0 };
    const { rc } = await capture(() => sendUnitWith(TOPIC, "nope", deps));
    expect(rc).toBe(1);
  });

  it("send failure (rc != 0) → rc 1", async () => {
    const art = seedArt();
    seedSendUnit(art);
    const deps: SendUnitDeps = { send: async () => 3 };
    const { rc } = await capture(() => sendUnitWith(TOPIC, "web", deps));
    expect(rc).toBe(1);
  });

  it("sendUnitRun arg validation: wrong arg count → rc 2", async () => {
    const { rc } = await capture(() => run(["send-unit", TOPIC])); // only 1 of 2 args
    expect(rc).toBe(2);
  });
});
