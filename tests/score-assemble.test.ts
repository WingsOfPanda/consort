// tests/score-assemble.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scoreArtDir, scoreDraftDir, scoreDocPath } from "../src/core/score.js";
import { run as score } from "../src/commands/score.js";

let prev: string | undefined;
beforeEach(() => { prev = process.env.CONSORT_HOME; process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "sa-")); });
afterEach(() => { if (prev === undefined) delete process.env.CONSORT_HOME; else process.env.CONSORT_HOME = prev; });

function scaffold(topic: string, sections: Record<string, string>) {
  const dd = scoreDraftDir(topic); mkdirSync(dd, { recursive: true });
  writeFileSync(join(scoreArtDir(topic), "topic.txt"), "My Topic Title");
  writeFileSync(join(scoreArtDir(topic), "multi-repo.txt"), "single\n");
  for (const [k, v] of Object.entries(sections)) writeFileSync(join(dd, `${k}.md`), v);
}
function cap() { const c: string[] = []; const s = vi.spyOn(process.stdout, "write").mockImplementation(((x: unknown) => { c.push(String(x)); return true; }) as never); return { text: () => c.join(""), restore: () => s.mockRestore() }; }

const FULL = {
  problem: "## Problem\n\np", goal: "## Goal\n\ng", architecture: "## Architecture\n\na",
  components: "## Components\n\nc", testing: "## Testing\n\nt", "success-criteria": "## Success Criteria\n\ns",
};

describe("score assemble", () => {
  it("audit PASS: writes the doc + audit.log, prints the doc path, rc 0", async () => {
    scaffold("ok-topic", FULL);
    const c = cap();
    const rc = await score(["assemble", "ok-topic"]);
    c.restore();
    expect(rc).toBe(0);
    const date = new Date().toISOString().slice(0, 10);
    const docPath = scoreDocPath("ok-topic", date);
    expect(existsSync(docPath)).toBe(true);
    expect(readFileSync(docPath, "utf8")).toMatch(/^# My Topic Title\n/);
    expect(existsSync(join(scoreArtDir("ok-topic"), "design-doc", "audit.log"))).toBe(true);
    expect(c.text()).toContain(docPath);
  });
  it("audit FAIL (Goal draft lacks its heading): rc 1, emits ISSUE= lines", async () => {
    // A drafted goal.md whose body has no `## Goal` heading trips no_goal_section.
    // (A *missing* draft would emit assembleDoc's `## Goal\n\n_(missing draft)_`
    //  placeholder heading, which clone-wars' byte-identical audit accepts — so the
    //  failing case the directive's audit-retry handles is a mis-drafted heading.)
    const partial = { ...FULL, goal: "g (no heading here)" };
    scaffold("bad-topic", partial);
    const errs: string[] = [];
    const s = vi.spyOn(process.stderr, "write").mockImplementation(((x: unknown) => { errs.push(String(x)); return true; }) as never);
    const rc = await score(["assemble", "bad-topic"]);
    s.mockRestore();
    expect(rc).toBe(1);
    expect(errs.join("")).toContain("ISSUE=no_goal_section");
    expect(errs.join("")).toContain("SECTION=goal"); // mapped target for the directive's re-walk
  });
});
