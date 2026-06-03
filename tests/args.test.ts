import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenizeArgsLine, applyArgsFile, kvParse, ArgsFileError, KvError } from "../src/args.js";

describe("args", () => {
  it("tokenize preserves quoted phrases + literal metachars", () => {
    expect(tokenizeArgsLine('violin codex demo "hello world"')).toEqual(["violin", "codex", "demo", "hello world"]);
    expect(tokenizeArgsLine('a "; touch /tmp/x; #"')).toEqual(["a", "; touch /tmp/x; #"]);
  });
  it("applyArgsFile passthrough + empty", () => {
    expect(applyArgsFile(["foo", "bar"])).toEqual(["foo", "bar"]);
    expect(applyArgsFile([])).toEqual([]);
  });
  it("applyArgsFile loads + consumes + appends", () => {
    const f = join(mkdtempSync(join(tmpdir(), "af-")), "args");
    writeFileSync(f, 'violin codex auth-review "hello world"');
    expect(applyArgsFile(["--args-file", f, "extra1"])).toEqual(["violin", "codex", "auth-review", "hello world", "extra1"]);
    expect(existsSync(f)).toBe(false); // consumed
  });
  it("applyArgsFile: no path throws code 2", () => {
    expect(() => applyArgsFile(["--args-file"])).toThrow(ArgsFileError);
  });
  it("applyArgsFile: missing file → silent fallback", () => {
    expect(applyArgsFile(["--args-file", "/nope/x", "extra"])).toEqual(["extra"]);
  });
  it("applyArgsFile preserves content after the first newline (multi-line $ARGUMENTS)", () => {
    const f = join(mkdtempSync(join(tmpdir(), "af-")), "args");
    writeFileSync(f, "enhance debug mode\nENHANCEMENT one\nENHANCEMENT two");
    expect(applyArgsFile(["--args-file", f])).toEqual([
      "enhance", "debug", "mode", "ENHANCEMENT", "one", "ENHANCEMENT", "two",
    ]);
  });
  it("applyArgsFile: a flag on line 1 and a multi-line topic body all survive", () => {
    const f = join(mkdtempSync(join(tmpdir(), "af-")), "args");
    writeFileSync(f, "--ensemble\nresearch the thing\nwith more detail");
    expect(applyArgsFile(["--args-file", f])).toEqual([
      "--ensemble", "research", "the", "thing", "with", "more", "detail",
    ]);
  });
  it("applyArgsFile handles CRLF line endings", () => {
    const f = join(mkdtempSync(join(tmpdir(), "af-")), "args");
    writeFileSync(f, "alpha beta\r\ngamma");
    expect(applyArgsFile(["--args-file", f])).toEqual(["alpha", "beta", "gamma"]);
  });
  it("applyArgsFile: consecutive and trailing newlines yield no empty tokens", () => {
    const f = join(mkdtempSync(join(tmpdir(), "af-")), "args");
    writeFileSync(f, "one\n\ntwo\n");
    expect(applyArgsFile(["--args-file", f])).toEqual(["one", "two"]);
  });
  it("kvParse forms", () => {
    expect(kvParse("--mode=test")).toEqual({ value: "test", shift: 1 });
    expect(kvParse("--mode", "v")).toEqual({ value: "v", shift: 2 });
    expect(kvParse("--targets", "")).toEqual({ value: "", shift: 2 }); // empty ok
    expect(kvParse("--mode=a=b=c")).toEqual({ value: "a=b=c", shift: 1 }); // first = only
    expect(() => kvParse("--mode")).toThrow(KvError);
  });
});
