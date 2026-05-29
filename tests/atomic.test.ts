import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, appendJsonl } from "../src/core/atomic.js";

describe("atomic", () => {
  it("writes content and leaves no tmp", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-"));
    const dest = join(dir, "status.json");
    atomicWrite(dest, "hello\nworld\n");
    expect(readFileSync(dest, "utf8")).toBe("hello\nworld\n");
    expect(readdirSync(dir).filter((f) => f.startsWith("status.json.tmp"))).toEqual([]);
  });
  it("concurrent-style overwrite stays whole", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw2-"));
    const dest = join(dir, "f");
    for (let i = 0; i < 10; i++) atomicWrite(dest, `writer-${i}\n`);
    expect(readFileSync(dest, "utf8")).toMatch(/^writer-\d+\n$/);
  });
  it("appendJsonl appends one line per object", () => {
    const dir = mkdtempSync(join(tmpdir(), "aj-"));
    const f = join(dir, "outbox.jsonl");
    writeFileSync(f, "");
    appendJsonl(f, { event: "ready", ts: "t" });
    appendJsonl(f, { event: "done", summary: "ok" });
    expect(readFileSync(f, "utf8")).toBe(
      `{"event":"ready","ts":"t"}\n{"event":"done","summary":"ok"}\n`,
    );
  });
});
