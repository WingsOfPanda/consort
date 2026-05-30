// tests/rehearsal-cmd.test.ts — rehearsal CLI verbs (Phase B).
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { freshHome } from "./helpers/tmpHome.js";
import { initWith, type RehearsalInitDeps } from "../src/commands/rehearsal.js";
import { metricWith, sotaWith } from "../src/commands/rehearsal.js";
import { rehearsalArtDir } from "../src/core/rehearsal.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function home() { const h = freshHome(); cleanups.push(h.cleanup); return h; }

const okDeps = (over: Partial<RehearsalInitDeps> = {}): RehearsalInitDeps => ({
  haveCmd: () => true,
  instrumentBinary: (n) => (n === "codex" ? "codex" : undefined),
  now: () => "2026-05-30T00:00:00Z",
  probeHardware: () => {},
  ...over,
});

describe("rehearsal init", () => {
  it("scaffolds the _rehearsal art dir, topic.txt, and a metric.txt seed; prints TOPIC + ART", async () => {
    const h = home();
    const out: string[] = [];
    const log = (s: string) => out.push(s);
    const rc = await initWith(["maximize accuracy under 100k params"],
      okDeps({ stdout: log, opts: { home: h.home, cwd: h.home } }));
    expect(rc).toBe(0);
    // deriveSlug caps at 20 chars (canonical frozen pipeline) → "maximize-accuracy-un".
    const art = rehearsalArtDir("maximize-accuracy-un", { home: h.home, cwd: h.home });
    expect(existsSync(art)).toBe(true);
    expect(readFileSync(`${art}/topic.txt`, "utf8")).toBe("maximize accuracy under 100k params");
    expect(readFileSync(`${art}/metric.txt`, "utf8").trim()).toBe("accuracy");
    expect(out.join("\n")).toContain(`ART=${art}`);
    expect(out.join("\n")).toContain("TOPIC=maximize-accuracy-un");
  });
  it("gates on codex availability (rc 3)", async () => {
    const h = home();
    const rc = await initWith(["x topic"], okDeps({ haveCmd: () => false, opts: { home: h.home, cwd: h.home } }));
    expect(rc).toBe(3);
  });
  it("rejects an empty slug (rc 2)", async () => {
    const h = home();
    const rc = await initWith(["!!!"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    expect(rc).toBe(2);
  });
  it("refuses an already-in-flight topic (rc 2)", async () => {
    const h = home();
    const d = okDeps({ opts: { home: h.home, cwd: h.home } });
    expect(await initWith(["same topic"], d)).toBe(0);
    expect(await initWith(["same topic"], d)).toBe(2);
  });
  it("--metric pre-writes metric.md; --time-budget pre-writes time-budget.txt + session-start.txt", async () => {
    const h = home();
    const rc = await initWith([
      "--metric", "primary_metric=accuracy,direction=maximize,min_acceptable=>= 0.9,target=>= 0.99",
      "--time-budget", "4h", "tune model",
    ], okDeps({ opts: { home: h.home, cwd: h.home } }));
    expect(rc).toBe(0);
    const art = rehearsalArtDir("tune-model", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art}/metric.md`, "utf8")).toContain("**Primary metric:** accuracy");
    expect(readFileSync(`${art}/time-budget.txt`, "utf8").trim()).toBe("14400");
    expect(readFileSync(`${art}/session-start.txt`, "utf8").trim()).toBe("2026-05-30T00:00:00Z");
  });
  it("--slug overrides derivation; --time-budget none resolves", async () => {
    const h = home();
    expect(await initWith(["--slug", "myrun", "--time-budget", "none", "anything"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(0);
    const art = rehearsalArtDir("myrun", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art}/time-budget.txt`, "utf8").trim()).toBe("none");
  });
  it("unknown flag -> rc 2", async () => {
    const h = home();
    expect(await initWith(["--bogus", "x topic"], okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
  });
  it("--seed-from with a missing path -> rc 1", async () => {
    const h = home();
    expect(await initWith(["--seed-from", "/no/such/file", "seed topic"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(1);
  });
  it("--metric with a malformed block (missing direction) -> rc 2", async () => {
    const h = home();
    expect(await initWith(["--metric", "primary_metric=auc", "bad metric topic"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
  });
  it("--slug rejects a value not matching ^[a-z][a-z0-9-]{0,19}$ -> rc 2", async () => {
    const h = home();
    expect(await initWith(["--slug", "9bad", "x"], okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
    expect(await initWith(["--slug", "WAY-too-long-a-slug-value-here", "x"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
  });
  it("--time-budget accepts <N>s and bare integer seconds", async () => {
    const h = home();
    expect(await initWith(["--slug", "tbsec", "--time-budget", "900s", "t"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(0);
    const art1 = rehearsalArtDir("tbsec", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art1}/time-budget.txt`, "utf8").trim()).toBe("900");
    expect(await initWith(["--slug", "tbint", "--time-budget", "1800", "t"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(0);
    const art2 = rehearsalArtDir("tbint", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art2}/time-budget.txt`, "utf8").trim()).toBe("1800");
  });
  it("--time-budget rejects a malformed value -> rc 2", async () => {
    const h = home();
    expect(await initWith(["--time-budget", "0h", "t"], okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
    expect(await initWith(["--time-budget", "abc", "t"], okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
  });
});

describe("rehearsal metric / sota verbs", () => {
  it("metric writes metric.md from --kv", async () => {
    const h = home();
    await initWith(["--slug", "r1", "topic one"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    const rc = await metricWith(["r1", "--kv", "primary_metric=auc,direction=maximize,min_acceptable=>= 0.8"],
      { opts: { home: h.home, cwd: h.home } });
    expect(rc).toBe(0);
    const art = rehearsalArtDir("r1", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art}/metric.md`, "utf8")).toContain("**Primary metric:** auc");
  });
  it("metric returns 2 on a bad block (missing direction)", async () => {
    const h = home();
    await initWith(["--slug", "r2", "topic two"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    expect(await metricWith(["r2", "--kv", "primary_metric=auc"], { opts: { home: h.home, cwd: h.home } })).toBe(2);
  });
  it("sota writes sota.md from --kv with ref rows", async () => {
    const h = home();
    await initWith(["--slug", "r3", "topic three"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    const rc = await sotaWith(["r3", "--kv",
      "topic=mnist,metric=accuracy,sweep_date=2026-05-30,ref_1=cnn|0.99|fits|url|note"],
      { opts: { home: h.home, cwd: h.home } });
    expect(rc).toBe(0);
    const art = rehearsalArtDir("r3", { home: h.home, cwd: h.home });
    const md = readFileSync(`${art}/sota.md`, "utf8");
    expect(md).toContain("# SOTA reference — mnist");
    expect(md).toContain("| cnn | 0.99 | fits | url | note |");
  });
});
