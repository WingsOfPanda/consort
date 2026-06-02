import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, existsSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { recordMaestroFlag, runFlag } from "../src/core/forensics.js";
import { parseForensicsFrontmatter, parseMechanicalFindings } from "../src/core/playback.js";
import { globalRoot } from "../src/core/paths.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

const fdir = (date: string) => join(globalRoot(), "forensics", date);

describe("recordMaestroFlag", () => {
  it("writes a maestro_flag finding straight to the global feed", () => {
    const now = new Date("2026-06-02T09:15:30Z");
    const p = recordMaestroFlag({ command: "perform", topic: "auth-x", note: "  the diff touched an unrelated file  ", now });
    expect(p).toBe(join(fdir("2026-06-02"), "09-15-30-perform-flag-auth-x.md"));
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, "utf8");
    const meta = parseForensicsFrontmatter(text);
    expect(meta.command).toBe("perform");
    expect(meta.topic).toBe("auth-x");
    expect(meta.nFindings).toBe(1);
    expect(parseMechanicalFindings(text)).toEqual([
      { source: "maestro_flag", key: "the diff touched an unrelated file", context: "from=maestro command=perform" },
    ]);
  });
  it("returns '' for an empty/whitespace note (nothing written)", () => {
    expect(recordMaestroFlag({ command: "score", topic: "t", note: "   " })).toBe("");
  });
});

describe("runFlag", () => {
  it("rc 2 on missing topic or empty note", () => {
    expect(runFlag("solo", undefined, "x")).toBe(2);
    expect(runFlag("solo", "t", "")).toBe(2);
  });
  it("rc 0 and writes a maestro_flag file on a valid flag", () => {
    const rc = runFlag("score", "topic-y", "looks off");
    expect(rc).toBe(0);
    const date = new Date().toISOString().slice(0, 10);
    const files = readdirSync(fdir(date), { withFileTypes: true }).filter((d: Dirent) => d.isFile());
    expect(files.some((f) => f.name.includes("score-flag-topic-y"))).toBe(true);
  });
});
