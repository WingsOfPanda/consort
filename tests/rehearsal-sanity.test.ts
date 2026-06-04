import { describe, it, expect } from "vitest";
import { sanityFlags, sanityRow, type SanityInput } from "../src/core/rehearsalSanity.js";

const okResult = (over: Record<string, unknown> = {}) => ({
  status: "ok", metric_value: 0.9, runtime_s: 100, log_paths: ["./stdout.log"],
  integrity: { split_before_fit: true, no_train_test_overlap: true, target_not_in_features: true, trained_steps: 10, seed: 1 },
  ...over,
});
const base = (over: Partial<SanityInput> = {}): SanityInput => ({
  result: okResult(), direction: "maximize", ceiling: undefined, minRuntimeS: 1.0,
  readLog: () => "clean run\n", hardConstraints: [], audit: null, ...over,
});

describe("sanityFlags", () => {
  it("clean result -> no flags", () => {
    expect(sanityFlags(base())).toEqual([]);
  });
  it("ceiling-exceeded (maximize: metric > ceiling)", () => {
    const f = sanityFlags(base({ ceiling: 0.8 }));
    expect(f).toEqual([{ flag: "ceiling-exceeded", detail: "metric=0.9 ceiling=0.8" }]);
  });
  it("ceiling-exceeded (minimize: metric < ceiling/floor)", () => {
    const f = sanityFlags(base({ direction: "minimize", result: okResult({ metric_value: 0.01 }), ceiling: 0.05 }));
    expect(f[0].flag).toBe("ceiling-exceeded");
  });
  it("no ceiling flag when ceiling undefined", () => {
    expect(sanityFlags(base({ ceiling: undefined, result: okResult({ metric_value: 999 }) }))).toEqual([]);
  });
  it("under-run when runtime below floor", () => {
    const f = sanityFlags(base({ result: okResult({ runtime_s: 0 }) }));
    expect(f).toEqual([{ flag: "under-run", detail: "runtime=0 floor=1" }]);
  });
  it("log-contradiction when an ok run's log has a crash marker", () => {
    const f = sanityFlags(base({ readLog: () => "epoch 1\nTraceback (most recent call last)\n" }));
    expect(f[0]).toEqual({ flag: "log-contradiction", detail: "marker=Traceback (most recent call last) file=./stdout.log" });
  });
  it("integrity-attestation-incomplete lists missing keys", () => {
    const f = sanityFlags(base({ result: okResult({ integrity: { split_before_fit: true } }) }));
    expect(f[0].flag).toBe("integrity-attestation-incomplete");
    expect(f[0].detail).toContain("no_train_test_overlap");
    expect(f[0].detail).toContain("seed");
  });
  it("integrity-attestation-incomplete when block absent", () => {
    const f = sanityFlags(base({ result: okResult({ integrity: undefined }) }));
    expect(f[0].flag).toBe("integrity-attestation-incomplete");
  });
  it("audit-knob-drift when audit.json value != mandated", () => {
    const f = sanityFlags(base({ hardConstraints: [{ key: "mcts_sims", value: "200" }], audit: { mcts_sims: 16 } }));
    expect(f[0]).toEqual({ flag: "audit-knob-drift", detail: "mcts_sims=16 vs mandated 200" });
  });
  it("no audit-knob-drift when value matches or audit missing the key", () => {
    expect(sanityFlags(base({ hardConstraints: [{ key: "x", value: "200" }], audit: { x: 200 } }))).toEqual([]);
    expect(sanityFlags(base({ hardConstraints: [{ key: "x", value: "200" }], audit: {} }))).toEqual([]);
  });
  it("non-ok status skips ok-only checks (ceiling/under-run/log)", () => {
    const r = { status: "fail", metric_value: null, runtime_s: 0, log_paths: ["./x"],
      integrity: { split_before_fit: true, no_train_test_overlap: true, target_not_in_features: true, trained_steps: 1, seed: 1 } };
    expect(sanityFlags(base({ result: r, ceiling: 0.1, readLog: () => "Traceback (most recent call last)" }))).toEqual([]);
  });
});

describe("sanityRow", () => {
  it("renders a 5-col tsv row", () => {
    expect(sanityRow({ expId: "exp-001", instrument: "viola", flag: "under-run", detail: "runtime=0 floor=1", ts: "T" }))
      .toBe("exp-001\tviola\tunder-run\truntime=0 floor=1\tT\n");
  });
});
