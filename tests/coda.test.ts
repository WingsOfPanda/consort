import { describe, it, expect } from "vitest";
import { teardownBatch, GRACEFUL_BATCH_WAIT_MS, run as codaRun } from "../src/commands/coda.js";

function deps(alive: Record<string, boolean>) {
  const calls = { graceful: 0, killNow: 0, sleep: 0, archive: 0 };
  return {
    calls,
    d: {
      paneMetaRead: (i: string, _m: string, _t: string) => `%${i}`,
      paneAlive: async (p: string) => alive[p] ?? false,
      killGraceful: async () => { calls.graceful++; },
      killNow: async () => { calls.killNow++; },
      stateArchive: (i: string, m: string) => { calls.archive++; return `/archive/${i}-${m}`; },
      sleep: async (_ms: number) => { calls.sleep++; },
      lastPanePath: () => "/tmp/none/.last_pane",
      readLastPane: () => "",
      removeLastPane: () => {},
      pluginRoot: "/plugin",
    },
  };
}

describe("coda batch", () => {
  it("sleeps ONCE for a 3-pane batch and killNow each; archive all", async () => {
    const { calls, d } = deps({ "%violin": true, "%viola": true, "%cello": true });
    await teardownBatch("demo", [
      { instrument: "violin", model: "codex" }, { instrument: "viola", model: "codex" }, { instrument: "cello", model: "codex" },
    ], d as any);
    expect(calls.graceful).toBe(3);
    expect(calls.sleep).toBe(1);              // ONE wait for the whole batch
    expect(calls.killNow).toBe(3);
    expect(calls.archive).toBe(3);
  });
  it("no alive panes → no graceful, no sleep, but still archives every pair", async () => {
    const { calls, d } = deps({});
    await teardownBatch("demo", [{ instrument: "violin", model: "codex" }], d as any);
    expect(calls.graceful).toBe(0);
    expect(calls.sleep).toBe(0);
    expect(calls.archive).toBe(1);
  });
  it("GRACEFUL_BATCH_WAIT_MS is 9000", () => { expect(GRACEFUL_BATCH_WAIT_MS).toBe(9000); });
  it("--all without --yes refuses (exit 2), no teardown", async () => {
    expect(await codaRun(["--all"])).toBe(2);
  });
});
