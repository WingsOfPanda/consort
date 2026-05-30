// tests/perform-dag-parse.test.ts — C2: perform dag-parse executor verb (deploy-dag-parse.sh).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import { run as performRun, dagParseWith, type DagParseDeps } from "../src/commands/perform.js";

const TOPIC = "multi-svc";

// Seed performArtDir(topic)/design.md with the given body; returns the art dir.
function seed(designText: string): string {
  const art = performArtDir(TOPIC);
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, "design.md"), designText);
  return art;
}

function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (chunk: any, ..._rest: any[]) => { buf += String(chunk); return true; };
  return { text: () => buf, restore: () => { (process.stdout as any).write = orig; } };
}

const deps: DagParseDeps = { artDir: (t) => performArtDir(t) };

describe("perform dag-parse (deploy-dag-parse.sh — multi-repo DAG executor wiring)", () => {
  let h: { home: string; cleanup: () => void };
  let cap: ReturnType<typeof captureStdout>;
  beforeEach(() => { h = freshHome(); cap = captureStdout(); });
  afterEach(() => { cap.restore(); h.cleanup(); });

  it("2-wave doc → rc 0; byte-exact dag-waves.txt / dag-edges.txt; WAVES=2 STEPS=2 on stdout", async () => {
    const art = seed("# T\n## Execution DAG\n1. api (/abs/api) — build\n2. web — wire (depends on 1)\n");
    const rc = await dagParseWith(TOPIC, deps);
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "dag-waves.txt"), "utf8")).toBe("1\t1\tapi\t/abs/api\tbuild\n2\t2\tweb\tnone\twire\n");
    expect(readFileSync(join(art, "dag-edges.txt"), "utf8")).toBe("1\t2\n");
    expect(cap.text()).toContain("WAVES=2\n");
    expect(cap.text()).toContain("STEPS=2\n");
  });

  it("diamond → waves 1 / 2,2 / 3 (a@1; b,c@2; d@3); byte-exact composition", async () => {
    const art = seed(
      "# T\n## Execution DAG\n" +
      "1. a — x\n" +
      "2. b — y (depends on 1)\n" +
      "3. c — z (depends on 1)\n" +
      "4. d — w (depends on 2, 3)\n",
    );
    const rc = await dagParseWith(TOPIC, deps);
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "dag-waves.txt"), "utf8")).toBe(
      "1\t1\ta\tnone\tx\n" +
      "2\t2\tb\tnone\ty\n" +
      "2\t3\tc\tnone\tz\n" +
      "3\t4\td\tnone\tw\n",
    );
    expect(readFileSync(join(art, "dag-edges.txt"), "utf8")).toBe("1\t2\n1\t3\n2\t4\n3\t4\n");
    expect(cap.text()).toContain("WAVES=3\n");
    expect(cap.text()).toContain("STEPS=4\n");
  });

  it("malformed numbered line (no repo) → rc 1", async () => {
    seed("# T\n## Execution DAG\n1. — no repo\n");
    expect(await dagParseWith(TOPIC, deps)).toBe(1);
  });

  it("no '## Execution DAG' section → rc 1", async () => {
    seed("# T\n## Components\n- foo\n");
    expect(await dagParseWith(TOPIC, deps)).toBe(1);
  });

  it("cycle (1->2 and 2->1) → rc 1", async () => {
    seed("# T\n## Execution DAG\n1. a — x (depends on 2)\n2. b — y (depends on 1)\n");
    expect(await dagParseWith(TOPIC, deps)).toBe(1);
  });

  it("missing design.md → rc 1", async () => {
    mkdirSync(performArtDir(TOPIC), { recursive: true }); // art dir but no design.md
    expect(await dagParseWith(TOPIC, deps)).toBe(1);
  });

  it("empty '## Execution DAG' section (no numbered lines) → rc 1", async () => {
    seed("# T\n## Execution DAG\n");
    expect(await dagParseWith(TOPIC, deps)).toBe(1);
  });

  it("zero args via the run() dispatcher → rc 2 (usage)", async () => {
    expect(await performRun(["dag-parse"])).toBe(2);
  });
});
