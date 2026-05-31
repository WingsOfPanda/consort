import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readdirSync, readFileSync, existsSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { captureSpawnFailure, bootstrapFailureArgs, NO_EVENT_SENTINEL } from "../src/core/forensics.js";
import { parseForensicsFrontmatter, parseMechanicalFindings } from "../src/core/playback.js";
import { globalRoot } from "../src/core/paths.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

function forensicsMd(): string[] {
  const root = join(globalRoot(), "forensics");
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }) as Dirent[]) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith(".md")) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

describe("bootstrapFailureArgs", () => {
  it("maps no event to a timeout with the no-event sentinel", () => {
    expect(bootstrapFailureArgs(null, "/p/failure-reason.txt"))
      .toEqual({ reason: "timeout", detail: NO_EVENT_SENTINEL, failureReportPath: "/p/failure-reason.txt" });
  });
  it("maps an error event to error_event with the serialized event line", () => {
    const ev = { event: "error", message: "boom" };
    expect(bootstrapFailureArgs(ev, undefined))
      .toEqual({ reason: "error_event", detail: JSON.stringify(ev), failureReportPath: undefined });
  });
});

describe("captureSpawnFailure", () => {
  it("writes a command:spawn forensics file playback can parse", () => {
    const path = captureSpawnFailure({
      instrument: "trumpet", model: "codex", topic: "plan-x",
      reason: "config_error", detail: "identity template not found",
      failureReportPath: "/p/failure-reason.txt",
    });
    expect(path).not.toBe("");
    const files = forensicsMd();
    expect(files).toEqual([path]);
    const md = readFileSync(path, "utf8");
    const meta = parseForensicsFrontmatter(md);
    expect(meta.command).toBe("spawn");
    expect(meta.topic).toBe("plan-x");
    expect(meta.nFindings).toBe(2);
    const findings = parseMechanicalFindings(md);
    expect(findings.some((f) => f.source === "spawn_failure" && /reason=config_error/.test(f.key))).toBe(true);
    expect(findings.some((f) => /failure_report=\/p\/failure-reason\.txt/.test(f.key))).toBe(true);
    expect(md).toContain("part=trumpet-codex");
  });

  it("emits a single finding when no failure report is given", () => {
    const path = captureSpawnFailure({
      instrument: "viol", model: "claude", topic: "t", reason: "timeout", detail: NO_EVENT_SENTINEL,
    });
    expect(parseForensicsFrontmatter(readFileSync(path, "utf8")).nFindings).toBe(1);
  });

  it("is best-effort: returns '' and writes nothing when the forensics dir can't be created", () => {
    writeFileSync(join(globalRoot(), "forensics"), "x"); // a FILE where the dir would go -> mkdirSync throws
    expect(captureSpawnFailure({ instrument: "a", model: "b", topic: "t", reason: "spawn_error", detail: "x" })).toBe("");
  });
});
