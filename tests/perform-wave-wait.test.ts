// tests/perform-wave-wait.test.ts — C2: perform wave-wait per-part barrier (deploy-wave-wait.sh).
// rc 0 in EVERY wait-outcome case; TS= carries the outcome; a wave-<instr>.done sentinel is dropped.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import { scaledTimeout } from "../src/core/scoreTurn.js";
import type { OutboxEvent } from "../src/core/ipc.js";
import {
  run as performRun, waveWaitWith, type PerformWaitDeps,
} from "../src/commands/perform.js";

const TOPIC = "multi-svc";
const INSTR = "violin";
const PROVIDER = "codex";

interface WaitCall { i: string; m: string; t: string; off: number; ev: string[]; to: number; }

// Build an injectable PerformWaitDeps that returns `ev` and records the wait call.
function waitDeps(ev: OutboxEvent | null, over: Partial<PerformWaitDeps> = {}): { d: PerformWaitDeps; calls: WaitCall[] } {
  const calls: WaitCall[] = [];
  const d: PerformWaitDeps = {
    wait: over.wait ?? (async (i, m, t, off, evs, to) => { calls.push({ i, m, t, off, ev: evs, to }); return ev; }),
    multiplier: over.multiplier ?? (() => "1"),
    now: over.now ?? (() => 0),
  };
  return { d, calls };
}

function waveFile(art: string): string { return join(art, `wave-${INSTR}.txt`); }

describe("perform wave-wait (rc 0 always; TS= carries the outcome; .done sentinel)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => {
    h = freshHome();
    mkdirSync(performArtDir(TOPIC), { recursive: true }); // pre-create the art dir
  });
  afterEach(() => {
    h.cleanup();
    delete process.env.CONSORT_PERFORM_WAVE_TIMEOUT_OVERRIDE;
    delete process.env.CONSORT_PERFORM_TURN_TIMEOUT_S;
  });

  it("done event → rc 0, TS=ok + EVENT=done, wave-<instr>.done created", async () => {
    const art = performArtDir(TOPIC);
    const { d } = waitDeps({ event: "done", summary: "x" });
    const rc = await waveWaitWith(TOPIC, INSTR, PROVIDER, d);
    expect(rc).toBe(0);
    const txt = readFileSync(waveFile(art), "utf8");
    expect(txt).toContain("TS=ok\n");
    expect(txt).toContain("EVENT=done\n");
    expect(existsSync(join(art, `wave-${INSTR}.done`))).toBe(true);
  });

  it("error event with reason → TS=failed + EVENT=error + REASON=boom, rc 0", async () => {
    const art = performArtDir(TOPIC);
    const { d } = waitDeps({ event: "error", reason: "boom" });
    expect(await waveWaitWith(TOPIC, INSTR, PROVIDER, d)).toBe(0);
    const txt = readFileSync(waveFile(art), "utf8");
    expect(txt).toContain("TS=failed\n");
    expect(txt).toContain("EVENT=error\n");
    expect(txt).toContain("REASON=boom\n");
  });

  it("error event without reason → REASON= (empty), rc 0", async () => {
    const art = performArtDir(TOPIC);
    const { d } = waitDeps({ event: "error" });
    expect(await waveWaitWith(TOPIC, INSTR, PROVIDER, d)).toBe(0);
    const txt = readFileSync(waveFile(art), "utf8");
    expect(txt).toContain("TS=failed\n");
    expect(txt).toContain("REASON=\n");
  });

  it("null (timeout) → TS=timeout + TIMEOUT_S=<scaled>, rc 0", async () => {
    const art = performArtDir(TOPIC);
    const { d } = waitDeps(null); // multiplier '1', default timeout 14400
    expect(await waveWaitWith(TOPIC, INSTR, PROVIDER, d)).toBe(0);
    const txt = readFileSync(waveFile(art), "utf8");
    expect(txt).toContain("TS=timeout\n");
    expect(txt).toContain(`TIMEOUT_S=${scaledTimeout(14400, "1")}\n`);
  });

  it("unknown event (progress) → TS=failed + EVENT=unknown, rc 0", async () => {
    const art = performArtDir(TOPIC);
    const { d } = waitDeps({ event: "progress" });
    expect(await waveWaitWith(TOPIC, INSTR, PROVIDER, d)).toBe(0);
    const txt = readFileSync(waveFile(art), "utf8");
    expect(txt).toContain("TS=failed\n");
    expect(txt).toContain("EVENT=unknown\n");
  });

  it("wait is called with offset===0 and events [done,error]", async () => {
    const { d, calls } = waitDeps({ event: "done" });
    await waveWaitWith(TOPIC, INSTR, PROVIDER, d);
    expect(calls).toHaveLength(1);
    expect(calls[0].off).toBe(0);
    expect(calls[0].ev).toEqual(["done", "error"]);
    expect(calls[0].i).toBe(INSTR);
    expect(calls[0].m).toBe(PROVIDER);
    expect(calls[0].t).toBe(TOPIC);
  });

  it("field order: TS / INSTRUMENT / PROVIDER / TOPIC then extras", async () => {
    const art = performArtDir(TOPIC);
    const { d } = waitDeps({ event: "done" });
    await waveWaitWith(TOPIC, INSTR, PROVIDER, d);
    expect(readFileSync(waveFile(art), "utf8")).toBe(
      `TS=ok\nINSTRUMENT=${INSTR}\nPROVIDER=${PROVIDER}\nTOPIC=${TOPIC}\nEVENT=done\n`,
    );
  });

  it("CONSORT_PERFORM_WAVE_TIMEOUT_OVERRIDE=5 + multiplier '2' → wait gets scaledTimeout(5,'2')===10", async () => {
    process.env.CONSORT_PERFORM_WAVE_TIMEOUT_OVERRIDE = "5";
    const { d, calls } = waitDeps(null, { multiplier: () => "2" });
    await waveWaitWith(TOPIC, INSTR, PROVIDER, d);
    expect(calls[0].to).toBe(scaledTimeout(5, "2"));
    expect(calls[0].to).toBe(10);
  });

  it("missing art dir → rc 1", async () => {
    const { d } = waitDeps({ event: "done" });
    expect(await waveWaitWith("no-such-topic", INSTR, PROVIDER, d)).toBe(1);
  });

  it("runner arg validation: missing provider → rc 2", async () => {
    expect(await performRun(["wave-wait", TOPIC, INSTR])).toBe(2);
  });

  it("runner arg validation: bad topic 'Bad_Topic' → rc 2", async () => {
    expect(await performRun(["wave-wait", "Bad_Topic", INSTR, PROVIDER])).toBe(2);
  });
});
