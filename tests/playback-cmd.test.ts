// tests/playback-cmd.test.ts — survey + archive verbs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { surveyWith, archiveWith } from "../src/commands/playback.js";

function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (c: any) => { buf += String(c); return true; };
  return { text: () => buf, restore: () => { (process.stdout as any).write = orig; } };
}

// A captured forensics file with `n` findings of the given source/key/context.
function forensicsDoc(command: string, topic: string, findings: Array<[string, string, string]>): string {
  const fm = `---\ncommand: ${command}\ntopic: ${topic}\ntopic_slug: ${topic}\nrepo_hash: h\nart_dir: /x\ninvoked_at: 2026-05-30T00:00:00Z\nn_findings_mechanical: ${findings.length}\n---\n\n`;
  const body = "## Mechanical findings\n\n" + findings.map(([s, k, c]) => `- **${s}** ${k} _(source: ${c})_`).join("\n") + "\n";
  return fm + body;
}

describe("playback survey", () => {
  let h: { home: string; cleanup: () => void };
  let froot: string;
  let out: ReturnType<typeof captureStdout>;
  beforeEach(() => {
    h = freshHome();
    froot = join(h.home, "forensics", "2026-05-30");
    mkdirSync(froot, { recursive: true });
    out = captureStdout();
  });
  afterEach(() => { out.restore(); h.cleanup(); });

  it("lists live forensics as TSV + a TRENDS block; excludes .reviewed/", async () => {
    writeFileSync(join(froot, "11-00-00-perform-add-oauth.md"),
      forensicsDoc("perform", "add-oauth", [["audit_log", "ISSUE=todo_marker", "audit.log"]]));
    // A pre-archived file under .reviewed/ must NOT be listed by default.
    const reviewed = join(h.home, "forensics", ".reviewed", "2026-05-29");
    mkdirSync(reviewed, { recursive: true });
    writeFileSync(join(reviewed, "10-00-00-score-old.md"), forensicsDoc("score", "old", [["status", "state=error", "part=a"]]));
    // A seeded ledger so the TRENDS block has content.
    writeFileSync(join(h.home, "forensics", ".trends.json"),
      '{"counts":{"audit_log||ISSUE=todo_marker":{"count":3,"firstSeen":"2026-05-01","lastSeen":"2026-05-30"}}}');

    const rc = await surveyWith({});
    expect(rc).toBe(0);
    const t = out.text();
    expect(t).toContain(`${join(froot, "11-00-00-perform-add-oauth.md")}\tperform\tadd-oauth\t1`);
    expect(t).not.toContain("score\told");                 // .reviewed/ excluded by default
    expect(t).toContain("TRENDS\naudit_log||ISSUE=todo_marker\t3\t2026-05-01\t2026-05-30");
  });

  it("--command filters; --all includes .reviewed/", async () => {
    writeFileSync(join(froot, "11-00-00-perform-x.md"), forensicsDoc("perform", "x", [["status", "state=error", "part=a"]]));
    const reviewed = join(h.home, "forensics", ".reviewed", "2026-05-29");
    mkdirSync(reviewed, { recursive: true });
    writeFileSync(join(reviewed, "10-00-00-score-y.md"), forensicsDoc("score", "y", [["status", "state=error", "part=b"]]));
    await surveyWith({ all: true, command: "score" });
    const t = out.text();
    expect(t).toContain("score\ty");                       // --all surfaced the archived file
    expect(t).not.toContain("perform\tx");                 // --command=score filtered out perform
  });

  it("bad --since spec -> rc 2", async () => {
    expect(await surveyWith({ since: "2w" })).toBe(2);
  });

  it("--since excludes files older than the cutoff (by mtime)", async () => {
    const { utimesSync } = await import("node:fs");
    const oldF = join(froot, "09-00-00-perform-old.md");
    const newF = join(froot, "12-00-00-perform-new.md");
    writeFileSync(oldF, forensicsDoc("perform", "old", [["status", "state=error", "part=a"]]));
    writeFileSync(newF, forensicsDoc("perform", "new", [["status", "state=error", "part=b"]]));
    const now = Date.now();
    utimesSync(oldF, new Date(now - 3 * 86_400_000), new Date(now - 3 * 86_400_000));
    utimesSync(newF, new Date(now), new Date(now));
    await surveyWith({ since: "1d", now });
    const t = out.text();
    expect(t).toContain("perform\tnew");
    expect(t).not.toContain("perform\told");
  });
});

describe("playback archive", () => {
  let h: { home: string; cleanup: () => void };
  let froot: string;
  beforeEach(() => { h = freshHome(); froot = join(h.home, "forensics", "2026-05-30"); mkdirSync(froot, { recursive: true }); });
  afterEach(() => h.cleanup());

  it("accrues the trend and moves files to .reviewed/", async () => {
    const f = join(froot, "11-00-00-perform-x.md");
    writeFileSync(f, forensicsDoc("perform", "x", [["audit_log", "ISSUE=todo_marker", "audit.log"], ["status", "state=error", "part=a"]]));
    const rc = await archiveWith([f], { now: new Date("2026-05-30T00:00:00Z") });
    expect(rc).toBe(0);
    // file moved
    expect(existsSync(f)).toBe(false);
    expect(existsSync(join(h.home, "forensics", ".reviewed", "2026-05-30", "11-00-00-perform-x.md"))).toBe(true);
    // trend accrued
    const led = JSON.parse(readFileSync(join(h.home, "forensics", ".trends.json"), "utf8"));
    expect(led.counts["audit_log||ISSUE=todo_marker"]).toEqual({ count: 1, firstSeen: "2026-05-30", lastSeen: "2026-05-30" });
    expect(led.counts["status||state=error"].count).toBe(1);
  });

  it("accrues onto a seeded ledger: bumps count, advances lastSeen, preserves firstSeen (cross-window trend)", async () => {
    const f = join(froot, "11-00-00-perform-x.md");
    writeFileSync(f, forensicsDoc("perform", "x", [["audit_log", "ISSUE=todo_marker", "audit.log"]]));
    writeFileSync(join(h.home, "forensics", ".trends.json"),
      '{"counts":{"audit_log||ISSUE=todo_marker":{"count":3,"firstSeen":"2026-05-01","lastSeen":"2026-05-20"}}}');
    await archiveWith([f], { now: new Date("2026-05-30T00:00:00Z") });
    const led = JSON.parse(readFileSync(join(h.home, "forensics", ".trends.json"), "utf8"));
    expect(led.counts["audit_log||ISSUE=todo_marker"]).toEqual({ count: 4, firstSeen: "2026-05-01", lastSeen: "2026-05-30" });
  });

  it("is idempotent: a path already under .reviewed/ is skipped (no re-accrue)", async () => {
    const reviewed = join(h.home, "forensics", ".reviewed", "2026-05-29");
    mkdirSync(reviewed, { recursive: true });
    const r = join(reviewed, "10-00-00-score-y.md");
    writeFileSync(r, forensicsDoc("score", "y", [["status", "state=error", "part=b"]]));
    expect(await archiveWith([r])).toBe(0);
    // not re-moved, ledger empty (skip-before-accrue)
    expect(existsSync(r)).toBe(true);
    const led = JSON.parse(readFileSync(join(h.home, "forensics", ".trends.json"), "utf8"));
    expect(led.counts).toEqual({});
  });

  it("rc 2 when no paths given", async () => {
    const { run } = await import("../src/commands/playback.js");
    expect(await run(["archive"])).toBe(2);
  });
});
