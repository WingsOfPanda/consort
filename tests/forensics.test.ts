import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as F from "../src/core/forensics.js";
import { scrapeAuditLog, scrapeOutbox, scrapeStatus, scrapeSpawnResults, scrapeLogs } from "../src/core/forensics.js";
import { partDir } from "../src/core/paths.js";

afterEach(() => { delete process.env.CONSORT_HOME; });
function home() { const h = mkdtempSync(join(tmpdir(), "fx-")); process.env.CONSORT_HOME = h; return h; }
const deps = (scroll = "") => ({
  partDir,
  capturePane: async () => scroll,
  atomicWriteSync: (d: string, c: string) => writeFileSync(d, c),
  isWritableDir: (d: string) => existsSync(d),
  now: () => "2026-05-21T10:00:00Z",
});

describe("forensics", () => {
  it("timeout, no event_line → file with sentinel", async () => {
    home(); mkdirSync(partDir("violin", "codex", "demo"), { recursive: true });
    const r = await F.captureFailure({ instrument: "violin", model: "codex", topic: "demo", paneId: "%999", reason: "timeout" }, deps("line A\nline B"));
    expect(r.ok).toBe(true);
    const txt = readFileSync(join(partDir("violin", "codex", "demo"), "failure-reason.txt"), "utf8");
    expect(txt).toContain("# Spawn bootstrap failure");
    expect(txt).toContain("fail_reason:   timeout");
    expect(txt).toContain("ready_timeout: unknown");
    expect(txt).toContain("## Pane scrollback (last 50 lines, captured BEFORE pane kill)");
    expect(txt).toContain("no error event before timeout");
    expect(txt).toContain("line A\nline B");
  });
  it("error_event with event_line stored verbatim", async () => {
    home(); mkdirSync(partDir("violin", "codex", "demo"), { recursive: true });
    const evt = '{"event":"error","reason":"codex_bootstrap_failed","ts":"2026-05-21T10:00:00Z"}';
    const r = await F.captureFailure({ instrument: "violin", model: "codex", topic: "demo", paneId: "%9", reason: "error_event", eventLine: evt }, deps());
    expect(r.ok).toBe(true);
    const txt = readFileSync(join(partDir("violin", "codex", "demo"), "failure-reason.txt"), "utf8");
    expect(txt).toContain("fail_reason:   error_event");
    expect(txt).toContain(evt);
  });
  it("missing/unwritable dir → code 1, no file", async () => {
    home();
    const r = await F.captureFailure({ instrument: "ghost", model: "codex", topic: "demo", paneId: "%1", reason: "timeout" }, deps());
    expect(r).toEqual({ ok: false, code: 1 });
  });
  it("invalid reason → code 2", async () => {
    home(); mkdirSync(partDir("violin", "codex", "demo"), { recursive: true });
    const r = await F.captureFailure({ instrument: "violin", model: "codex", topic: "demo", paneId: "%1", reason: "kaboom" as any }, deps());
    expect(r).toEqual({ ok: false, code: 2 });
  });
});

describe("forensics scrapers", () => {
  it("audit.log → ^ISSUE= lines", () => {
    expect(scrapeAuditLog("VERDICT=FAIL\nISSUE=no_goal_section\nISSUE=tbd_marker\n"))
      .toEqual([{ source: "audit_log", key: "ISSUE=no_goal_section", context: "audit.log" },
                { source: "audit_log", key: "ISSUE=tbd_marker", context: "audit.log" }]);
  });
  it("outbox → error/question events via JSON.parse, labelled by part; skips non-JSON + done", () => {
    const ob = '{"event":"done","summary":"ok"}\nnot json\n{"event":"error","reason":"boom"}\n{"event":"question","message":"?"}\n';
    const f = scrapeOutbox(ob, "viola");
    expect(f.map((x) => x.source)).toEqual(["outbox", "outbox"]);
    expect(f.every((x) => x.context === "part=viola")).toBe(true);
    expect(f[0].key).toContain('"event":"error"');
  });
  it("status.json state=error; spawn-results rc!=0; logs [error]/log_error", () => {
    expect(scrapeStatus('{"state":"error","updated":"x"}', "cello")).toEqual([{ source: "status", key: "state=error", context: "part=cello" }]);
    expect(scrapeStatus('{"state":"ready"}', "cello")).toEqual([]);
    expect(scrapeSpawnResults("viola\tcodex\t0\t\ncello\tclaude\t1\tspawn-failed\n").map((x) => x.context)).toEqual(["part=cello"]);
    expect(scrapeLogs("all good\n[error] boom\nplain\n", "dispatch.log").length).toBe(1);
  });
});
