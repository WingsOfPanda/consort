// tests/perform-find-latest-doc.test.ts — T6: perform find-latest-doc verb (no-arg source defaulting).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { repoStateDir } from "../src/core/paths.js";
import { run } from "../src/commands/perform.js";

function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (chunk: any, ..._rest: any[]) => { buf += String(chunk); return true; };
  return { text: () => buf, restore: () => { (process.stdout as any).write = orig; } };
}

describe("perform find-latest-doc", () => {
  let h: { home: string; cleanup: () => void };
  let outSpy: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    h = freshHome();
    outSpy = captureStdout();
  });
  afterEach(() => { outSpy.restore(); h.cleanup(); });

  it("prints the newest *-design.md under */_score/design-doc by mtime", async () => {
    const sd = repoStateDir();
    const a = join(sd, "topic-a", "_score", "design-doc"); mkdirSync(a, { recursive: true });
    const b = join(sd, "topic-b", "_score", "design-doc"); mkdirSync(b, { recursive: true });
    const older = join(a, "2026-05-01-topic-a-design.md"); writeFileSync(older, "x");
    const newer = join(b, "2026-05-30-topic-b-design.md"); writeFileSync(newer, "x");
    utimesSync(older, new Date(1000), new Date(1000));
    utimesSync(newer, new Date(2000), new Date(2000));
    const rc = await run(["find-latest-doc"]);
    expect(rc).toBe(0);
    expect(outSpy.text()).toContain(`DOC=${newer}`);
  });

  it("rc 1 when none found", async () => {
    mkdirSync(repoStateDir(), { recursive: true });
    const rc = await run(["find-latest-doc"]);
    expect(rc).toBe(1);
  });
});
