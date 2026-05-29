import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../src/core/archive.js";
import { partDir, topicDir, globalRoot, repoHash } from "../src/core/paths.js";

afterEach(() => { delete process.env.CONSORT_HOME; delete process.env.CLAUDE_CODE_SESSION_ID; });
function home() { const h = mkdtempSync(join(tmpdir(), "ar-")); process.env.CONSORT_HOME = h; return h; }

describe("archive", () => {
  it("stateInit creates clean part dir + session id", () => {
    home();
    process.env.CLAUDE_CODE_SESSION_ID = "sess-123";
    const dir = partDir("violin", "codex", "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "outbox.jsonl"), "STALE\n");
    A.stateInit("violin", "codex", "demo");
    expect(readFileSync(join(dir, "outbox.jsonl"), "utf8")).toBe(""); // touched fresh
    expect(readFileSync(join(dir, ".session_id"), "utf8")).toBe("sess-123\n");
  });
  it("stateArchive moves dir, returns dest, collision suffixes", () => {
    home();
    const dir = partDir("violin", "codex", "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "f"), "x");
    const d1 = A.stateArchive("violin", "codex", "demo", "FAILED", { now: new Date("2026-05-29T14:30:22Z") });
    expect(d1).toContain("/archive/");
    expect(d1).toContain("violin-codex-20260529T143022Z-FAILED");
    expect(existsSync(dir)).toBe(false);
    // second archive same second → -2
    mkdirSync(dir, { recursive: true });
    const d2 = A.stateArchive("violin", "codex", "demo", "FAILED", { now: new Date("2026-05-29T14:30:22Z") });
    expect(d2).not.toBe(d1);
    expect(d2!.endsWith("-2")).toBe(true);
  });
  it("stateArchive returns null when part dir absent", () => {
    home();
    expect(A.stateArchive("ghost", "codex", "demo")).toBeNull();
  });
  it("finalizeArchived sets archived + archived_ts, preserves fields, idempotent", () => {
    home();
    const td = topicDir("demo");
    const p = join(td, "violin-codex");
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, "status.json"), `{"state":"working","updated":"2026-05-25T14:55:44Z","last_event":"heartbeat"}`);
    A.finalizeArchived(td, { now: new Date("2026-05-29T14:30:22Z") });
    let obj = JSON.parse(readFileSync(join(p, "status.json"), "utf8"));
    expect(obj.state).toBe("archived");
    expect(obj.updated).toBe("2026-05-25T14:55:44Z");
    expect(obj.last_event).toBe("heartbeat");
    expect(obj.archived_ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    A.finalizeArchived(td, { now: new Date("2026-05-29T15:00:00Z") }); // idempotent
    const raw = readFileSync(join(p, "status.json"), "utf8");
    expect(raw).not.toContain(",,");
    obj = JSON.parse(raw);
    expect(obj.state).toBe("archived");
  });
  it("finalizeArchived no-op on empty dir", () => {
    home();
    expect(() => A.finalizeArchived(join(process.env.CONSORT_HOME!, "nope"))).not.toThrow();
  });
});

describe("archiveTopic supports the score suite", () => {
  it("moves _score/ into the archive", () => {
    process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "arch-score-"));
    const topic = "score-demo";
    const art = join(topicDir(topic), "_score");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "topic.txt"), "x");
    A.archiveTopic(topic, "score");
    const dest = join(globalRoot(), "archive", repoHash(), topic);
    const moved = existsSync(dest) ? readdirSync(dest).some((n) => n.startsWith("_score-")) : false;
    expect(moved).toBe(true);
  });
});
