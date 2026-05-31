import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { soloArtDir } from "../src/core/solo.js";
import { partDir, globalRoot } from "../src/core/paths.js";
import { forensicsRun } from "../src/commands/solo.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

function walkForensicsMd(): string[] {
  const root = join(globalRoot(), "forensics");
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }) as Dirent[]) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

describe("solo forensics", () => {
  it("captures a part's outbox errors into a command:solo forensics file under globalRoot/forensics", async () => {
    mkdirSync(soloArtDir("fix-bug"), { recursive: true });
    const pd = partDir("cody", "codex", "fix-bug");
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "outbox.jsonl"), JSON.stringify({ event: "error", message: "boom", fatal: false }) + "\n");

    const rc = await forensicsRun(["fix-bug"]);
    expect(rc).toBe(0);

    const files = walkForensicsMd();
    expect(files.length).toBe(1);
    const md = readFileSync(files[0], "utf8");
    expect(md).toContain("command: solo");
    expect(md).toContain("topic: fix-bug");
    expect(md).toContain("boom");
  });

  it("writes nothing when there are no mechanical findings (best-effort, rc 0)", async () => {
    mkdirSync(soloArtDir("clean"), { recursive: true });
    const rc = await forensicsRun(["clean"]);
    expect(rc).toBe(0);
    expect(walkForensicsMd().length).toBe(0);
  });

  it("rc 2 on missing topic", async () => {
    expect(await forensicsRun([])).toBe(2);
  });
});
