// tests/perform-turn-cmd.test.ts — B2a: perform turn-send / turn-wait verbs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import { composeRound1Prompt } from "../src/core/performTurn.js";
import { parseLatestOffset } from "../src/core/scoreTurn.js";
import { outboxPath } from "../src/core/ipc.js";
import {
  turnSendWith, turnWaitWith,
  type PerformSendDeps, type PerformWaitDeps,
} from "../src/commands/perform.js";

const TOPIC = "add-oauth";

// Seed the art dir + part dir for a given provider; returns the art path.
function seed(provider: "codex" | "claude", opts?: { state?: string }): string {
  const art = performArtDir(TOPIC);
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, "provider.txt"), provider + "\n");
  writeFileSync(join(art, "design.md"), "# design\n");
  const outbox = outboxPath("cody", provider, TOPIC);
  mkdirSync(dirname(outbox), { recursive: true });
  writeFileSync(outbox, ""); // touch the outbox so existsSync passes
  if (opts?.state !== undefined) {
    writeFileSync(join(dirname(outbox), "status.json"), `{"state":"${opts.state}"}`);
  }
  return art;
}

function sendDeps(over: Partial<PerformSendDeps> & { record?: (label: string) => void } = {}): PerformSendDeps {
  return {
    offsetFor: over.offsetFor ?? (() => 17),
    send: over.send ?? (async () => 0),
  };
}

describe("perform turn-send", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  it("round 1: writes state BEFORE send, composes round-1 prompt, calls send, rc 0", async () => {
    const art = seed("codex");
    let stateExistedAtSend = false;
    let captured: string[] | null = null;
    const stateFile = join(art, "turn-cody-1.txt");
    const d = sendDeps({
      offsetFor: () => 17,
      send: async (a) => { stateExistedAtSend = existsSync(stateFile); captured = a; return 0; },
    });
    const rc = await turnSendWith(TOPIC, 1, d);
    expect(rc).toBe(0);
    expect(readFileSync(stateFile, "utf8")).toBe("OFFSET=17\n");
    expect(stateExistedAtSend).toBe(true); // state file written BEFORE send ran
    const promptFile = join(art, "cody_turn_prompt_1.md");
    expect(readFileSync(promptFile, "utf8")).toBe(composeRound1Prompt({
      designPath: join(art, "design.md"),
      planPath: join(art, "plan.md"),
      verifyPath: join(art, "verify-report-1.md"),
      round: 1,
    }));
    expect(captured).toEqual(["--from", "maestro", "cody", TOPIC, "@" + promptFile]);
  });

  it("round 2 with NO fix-prompt-2.md → rc 1, send NOT called", async () => {
    seed("codex");
    let called = false;
    const rc = await turnSendWith(TOPIC, 2, sendDeps({ send: async () => { called = true; return 0; } }));
    expect(rc).toBe(1);
    expect(called).toBe(false);
  });

  it("existing turn-cody-1.txt → rc 1, send NOT called", async () => {
    const art = seed("codex");
    writeFileSync(join(art, "turn-cody-1.txt"), "OFFSET=5\n");
    let called = false;
    const rc = await turnSendWith(TOPIC, 1, sendDeps({ send: async () => { called = true; return 0; } }));
    expect(rc).toBe(1);
    expect(called).toBe(false);
  });

  it("status.json state=working → rc 1 (part not idle)", async () => {
    seed("codex", { state: "working" });
    let called = false;
    const rc = await turnSendWith(TOPIC, 1, sendDeps({ send: async () => { called = true; return 0; } }));
    expect(rc).toBe(1);
    expect(called).toBe(false);
  });

  it("status.json state=idle → proceeds (rc 0)", async () => {
    seed("codex", { state: "idle" });
    const rc = await turnSendWith(TOPIC, 1, sendDeps());
    expect(rc).toBe(0);
  });

  it("send returns 2 → rc 1 AND turn-cody-1.txt still exists (kept for retry)", async () => {
    const art = seed("codex");
    const rc = await turnSendWith(TOPIC, 1, sendDeps({ send: async () => 2 }));
    expect(rc).toBe(1);
    expect(existsSync(join(art, "turn-cody-1.txt"))).toBe(true);
  });

  it("provider.txt=claude → uses the cody-claude part dir outbox", async () => {
    const art = seed("claude");
    let captured: string[] | null = null;
    const rc = await turnSendWith(TOPIC, 1, sendDeps({ send: async (a) => { captured = a; return 0; } }));
    expect(rc).toBe(0);
    // round-1 prompt path is provider-independent (art dir), but the outbox/status checks
    // keyed on cody-claude must have passed — which they did since rc 0.
    expect(captured![0]).toBe("--from");
    expect(readFileSync(join(art, "turn-cody-1.txt"), "utf8")).toBe("OFFSET=17\n");
  });
});

function waitDeps(over: Partial<PerformWaitDeps> = {}): PerformWaitDeps {
  return {
    wait: over.wait ?? (async () => null),
    multiplier: over.multiplier ?? (() => "1"),
    now: over.now ?? (() => 1700000000),
  };
}

describe("perform turn-wait (rc 0 always; TS= carries the outcome)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); delete process.env.CONSORT_PERFORM_TURN_TIMEOUT_S; });

  function seedWait(round = 1): string {
    const art = seed("codex");
    writeFileSync(join(art, `turn-cody-${round}.txt`), "OFFSET=10\n");
    return art;
  }

  it("done + non-empty verify-report-1.md → TS=ok, .done created, rc 0", async () => {
    const art = seedWait();
    writeFileSync(join(art, "verify-report-1.md"), "VERDICT: PASS\n");
    const rc = await turnWaitWith(TOPIC, 1, waitDeps({ wait: async () => ({ event: "done", summary: "x" }) }));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "turn-cody-1.txt"), "utf8")).toContain("TS=ok\n");
    expect(existsSync(join(art, "turn-cody-1.done"))).toBe(true);
  });

  it("done + missing verify report → TS=failed, rc 0", async () => {
    const art = seedWait();
    const rc = await turnWaitWith(TOPIC, 1, waitDeps({ wait: async () => ({ event: "done", summary: "x" }) }));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "turn-cody-1.txt"), "utf8")).toContain("TS=failed\n");
  });

  it("ev=null → TS=timeout, rc 0", async () => {
    const art = seedWait();
    const rc = await turnWaitWith(TOPIC, 1, waitDeps({ wait: async () => null }));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "turn-cody-1.txt"), "utf8")).toContain("TS=timeout\n");
  });

  it("question with claim → writes question payload, re-arms OFFSET, TS=question, rc 0", async () => {
    const art = seedWait();
    // bump the outbox so the re-armed offset is > 10
    writeFileSync(outboxPath("cody", "codex", TOPIC), '{"event":"question","message":"need X"}\n');
    const ev = { event: "question", message: "need X", claim: { kind: "path", value: "/x" } };
    const rc = await turnWaitWith(TOPIC, 1, waitDeps({ wait: async () => ev, now: () => 1700000000 }));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "question-cody-1.txt"), "utf8")).toBe(
      "TEXT=need X\nCLAIM_KIND=path\nCLAIM_VALUE=/x\nROUTE=verify\nASKED_AT=1700000000\n",
    );
    const stateText = readFileSync(join(art, "turn-cody-1.txt"), "utf8");
    expect(stateText).toContain("TS=question\n");
    const bumped = parseLatestOffset(stateText);
    expect(bumped).not.toBeNull();
    expect(bumped!).toBeGreaterThan(10); // re-armed past the question event
  });

  it("question with no message → downgraded TS=failed, no payload file, rc 0", async () => {
    const art = seedWait();
    const ev = { event: "question" }; // no message
    const rc = await turnWaitWith(TOPIC, 1, waitDeps({ wait: async () => ev }));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "turn-cody-1.txt"), "utf8")).toContain("TS=failed\n");
    expect(existsSync(join(art, "question-cody-1.txt"))).toBe(false);
  });

  it("CONSORT_PERFORM_TURN_TIMEOUT_S=5 → wait dep receives scaledTimeout(5,'1')===5", async () => {
    seedWait();
    process.env.CONSORT_PERFORM_TURN_TIMEOUT_S = "5";
    let gotTimeout = -1;
    const rc = await turnWaitWith(TOPIC, 1, waitDeps({
      multiplier: () => "1",
      wait: async (_i, _m, _t, _off, _ev, to) => { gotTimeout = to; return null; },
    }));
    expect(rc).toBe(0);
    expect(gotTimeout).toBe(5);
  });

  it("missing state file → rc 1 (turn-send not run)", async () => {
    seed("codex"); // no turn-cody-1.txt
    const rc = await turnWaitWith(TOPIC, 1, waitDeps());
    expect(rc).toBe(1);
  });
});
