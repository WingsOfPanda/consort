import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { preludeArtDir } from "../src/core/prelude.js";
import { preludeWaitGateRun } from "../src/commands/prelude.js";

describe("prelude wait-gate (verb)", () => {
  let env: { home: string; cleanup: () => void };
  beforeEach(() => { env = freshHome(); });
  afterEach(() => { env.cleanup(); });

  function seedRoster(topic: string): string {
    const art = preludeArtDir(topic); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "roster.txt"), "# generated\ncodex\tviola\nclaude\tcello\n");
    return art;
  }

  it("research phase (FS): rc 0 only when every part terminal", async () => {
    const art = seedRoster("t");
    for (const inst of ["viola", "cello"]) {
      writeFileSync(join(art, `research-${inst}.txt`), "OFFSET=1\nFS=ok\n");
      writeFileSync(join(art, `research-${inst}.done`), "");
    }
    expect(await preludeWaitGateRun(["t", "research"])).toBe(0);
  });

  it("research phase: rc 1 when one part is still pending (no .done)", async () => {
    const art = seedRoster("t");
    writeFileSync(join(art, "research-viola.txt"), "OFFSET=1\nFS=ok\n");
    writeFileSync(join(art, "research-viola.done"), "");
    expect(await preludeWaitGateRun(["t", "research"])).toBe(1);
  });

  it("adversary phase (AS): rc 1 when one part's last line is a question", async () => {
    const art = seedRoster("t");
    writeFileSync(join(art, "adversary-viola.txt"), "OFFSET=1\nAS=ok\n");
    writeFileSync(join(art, "adversary-viola.done"), "");
    writeFileSync(join(art, "adversary-cello.txt"), "OFFSET=2\nAS=question\n");
    writeFileSync(join(art, "adversary-cello.done"), "");
    expect(await preludeWaitGateRun(["t", "adversary"])).toBe(1);
  });

  it("adversary phase: rc 0 when all terminal (AS=ok / AS=missing both count)", async () => {
    const art = seedRoster("t");
    writeFileSync(join(art, "adversary-viola.txt"), "OFFSET=1\nAS=ok\n");
    writeFileSync(join(art, "adversary-viola.done"), "");
    writeFileSync(join(art, "adversary-cello.txt"), "OFFSET=2\nAS=missing\n");
    writeFileSync(join(art, "adversary-cello.done"), "");
    expect(await preludeWaitGateRun(["t", "adversary"])).toBe(0);
  });

  it("bad/absent phase and missing roster → rc 2", async () => {
    expect(await preludeWaitGateRun(["t"])).toBe(2);
    expect(await preludeWaitGateRun(["t", "verify"])).toBe(2);
    expect(await preludeWaitGateRun(["t", "research"])).toBe(2);
  });
});
