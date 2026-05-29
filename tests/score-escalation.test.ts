// tests/score-escalation.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { scoreArtDir } from "../src/core/score.js";
import { partDir } from "../src/core/paths.js";
import { researchSendWith } from "../src/commands/score.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

/** Seed a minimal initialised topic: _score/topic.txt + roster.txt. */
function seedTopic(topic: string, rows: Array<{ provider: string; instrument: string }>): string {
  const art = scoreArtDir(topic);
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, "topic.txt"), topic.replace(/-/g, " "));
  writeFileSync(join(art, "roster.txt"), rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n") + "\n");
  return art;
}

describe("score research-send", () => {
  it("writes the prompt + OFFSET state, then calls send (rc 0)", async () => {
    const art = seedTopic("cache-policy", [{ provider: "codex", instrument: "viola" }]);
    const calls: string[][] = [];
    const rc = await researchSendWith("cache-policy", "viola", "codex", {
      offsetFor: () => 42,
      send: async (args) => { calls.push(args); return 0; },
    });
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toBe("OFFSET=42\n");
    const prompt = readFileSync(join(art, "viola_research_prompt.md"), "utf8");
    expect(prompt).toContain("## Claims");
    expect(prompt).toContain(join(partDir("viola", "codex", "cache-policy"), "findings.md"));
    expect(calls[0]).toEqual(["--from", "maestro", "viola", "cache-policy", `@${join(art, "viola_research_prompt.md")}`]);
  });

  it("refuses if the state file already exists (rc 1)", async () => {
    const art = seedTopic("cache-policy", [{ provider: "codex", instrument: "viola" }]);
    writeFileSync(join(art, "research-viola.txt"), "OFFSET=0\n");
    const rc = await researchSendWith("cache-policy", "viola", "codex", { offsetFor: () => 0, send: async () => 0 });
    expect(rc).toBe(1);
  });

  it("send failure keeps the state file and returns rc 1", async () => {
    const art = seedTopic("cache-policy", [{ provider: "codex", instrument: "viola" }]);
    const rc = await researchSendWith("cache-policy", "viola", "codex", { offsetFor: () => 7, send: async () => 1 });
    expect(rc).toBe(1);
    expect(existsSync(join(art, "research-viola.txt"))).toBe(true);
  });
});
