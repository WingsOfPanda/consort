// tests/perform-cross-signal.test.ts — D3: cross-signal verb (unsafe heuristic).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import { crossSignalWith, type CrossSignalDeps } from "../src/commands/perform.js";
import type { Runner, RunResult } from "../src/core/gitwork.js";

function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (c: any) => { buf += String(c); return true; };
  return { text: () => buf, restore: () => { (process.stdout as any).write = orig; } };
}

describe("perform cross-signal", () => {
  let h: { home: string; cleanup: () => void };
  let art: string;
  let out: ReturnType<typeof captureStdout>;
  beforeEach(() => {
    h = freshHome();
    art = performArtDir("sig");
    mkdirSync(join(art, "baselines"), { recursive: true });
    out = captureStdout();
  });
  afterEach(() => { out.restore(); h.cleanup(); });

  it("UNSAFE=0 for a 2-wave, no-fan-in, no-shared-path DAG", async () => {
    // 2 waves, linear: step1 (api) -> step2 (web). No fan-in.
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\t.\tbuild api\n2\t2\tweb\t.\tbuild web\n");
    writeFileSync(join(art, "dag-edges.txt"), "1\t2\n");
    writeFileSync(join(art, "parts.txt"), `oboe\t${join(h.home, "api")}\tcodex\nviola\t${join(h.home, "web")}\tcodex\n`);
    writeFileSync(join(art, "baselines", "oboe.tsv"), "slug=oboe\nbaseline_sha=base_a\n");
    writeFileSync(join(art, "baselines", "viola.tsv"), "slug=viola\nbaseline_sha=base_w\n");
    const deps: CrossSignalDeps = {
      runnerFor: (cwd: string): Runner => ({
        run: (_c, _args): RunResult => ({
          code: 0,
          stdout: cwd.endsWith("api") ? "src/a.ts\n" : "src/w.ts\n",  // disjoint paths
        }),
      }),
    };
    const rc = await crossSignalWith("sig", deps);
    expect(rc).toBe(0);
    const t = out.text();
    expect(t).toContain("WAVE_COUNT=2");
    expect(t).toContain("FAN_IN_REPOS=\n");
    expect(t).toContain("SHARED_PATHS=\n");
    expect(t).toContain("UNSAFE=0");
  });

  it("UNSAFE=1 when a shared path is touched by >=2 parts", async () => {
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\t.\tbuild api\n2\t2\tweb\t.\tbuild web\n");
    writeFileSync(join(art, "dag-edges.txt"), "1\t2\n");
    writeFileSync(join(art, "parts.txt"), `oboe\t${join(h.home, "api")}\tcodex\nviola\t${join(h.home, "web")}\tcodex\n`);
    writeFileSync(join(art, "baselines", "oboe.tsv"), "baseline_sha=base_a\n");
    writeFileSync(join(art, "baselines", "viola.tsv"), "baseline_sha=base_w\n");
    const deps: CrossSignalDeps = {
      runnerFor: (_cwd): Runner => ({ run: () => ({ code: 0, stdout: "shared/iface.ts\n" }) }),
    };
    await crossSignalWith("sig", deps);
    const t = out.text();
    expect(t).toContain("SHARED_PATHS=shared/iface.ts");
    expect(t).toContain("UNSAFE=1");
  });

  it("UNSAFE=1 on a fan-in repo (step with >=2 incoming edges)", async () => {
    // step3 (merge) depends on step1 and step2 -> fan-in.
    writeFileSync(join(art, "dag-waves.txt"),
      "1\t1\tapi\t.\ta\n1\t2\tweb\t.\tb\n2\t3\tmerge\t.\tc\n");
    writeFileSync(join(art, "dag-edges.txt"), "1\t3\n2\t3\n");
    writeFileSync(join(art, "parts.txt"), `oboe\t${join(h.home, "api")}\tcodex\n`);
    writeFileSync(join(art, "baselines", "oboe.tsv"), "baseline_sha=base_a\n");
    const deps: CrossSignalDeps = { runnerFor: (_c) => ({ run: () => ({ code: 0, stdout: "" }) }) };
    await crossSignalWith("sig", deps);
    const t = out.text();
    expect(t).toContain("FAN_IN_REPOS=merge");
    expect(t).toContain("UNSAFE=1");
  });

  it("rc 1 when dag-waves.txt is missing", async () => {
    const deps: CrossSignalDeps = { runnerFor: (_c) => ({ run: () => ({ code: 0, stdout: "" }) }) };
    expect(await crossSignalWith("sig", deps)).toBe(1);
  });
});
