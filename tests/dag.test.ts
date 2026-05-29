// tests/dag.test.ts
import { describe, it, expect } from "vitest";
import { parseDagLine, checkDagSection, emitSoftDag, dagMalformedLines } from "../src/core/dag.js";

describe("dagMalformedLines", () => {
  it("returns [] for a conformant section and the bad line otherwise", () => {
    expect(dagMalformedLines("## Execution DAG\n\n1. api — build it\n2. web — ship it (depends on 1)\n")).toEqual([]);
    expect(dagMalformedLines("## Execution DAG\n\n1. api - build it\n2. web — ok\n")).toEqual(["1. api - build it"]);
  });
  it("absent section / narrative-only → []", () => {
    expect(dagMalformedLines("## Architecture\n\nstuff\n")).toEqual([]);
    expect(dagMalformedLines("## Execution DAG\n\nfree prose, no numbered lines\n")).toEqual([]);
  });
});

describe("parseDagLine", () => {
  it("plain line, no deps", () => {
    expect(parseDagLine("1. api — build the service")).toEqual({ step: "1", repo: "api", path: "none", desc: "build the service", deps: "none" });
  });
  it("with deps, comma-space normalized on parse input", () => {
    expect(parseDagLine("3. web — ship (depends on 1, 2)")).toEqual({ step: "3", repo: "web", path: "none", desc: "ship", deps: "1,2" });
  });
  it("optional (/abspath) group", () => {
    expect(parseDagLine("2. api (/srv/api) — deploy")).toEqual({ step: "2", repo: "api", path: "/srv/api", desc: "deploy", deps: "none" });
  });
  it("malformed (no em-dash) → null", () => { expect(parseDagLine("1. api - build")).toBeNull(); });
});

describe("emitSoftDag", () => {
  it("no deps vs deps (comma → comma-space)", () => {
    expect(emitSoftDag([{ step: "1", repo: "api", desc: "build", deps: "none" }])).toBe("1. api — build");
    expect(emitSoftDag([{ step: "2", repo: "web", desc: "ship", deps: "1,3" }])).toBe("2. web — ship (depends on 1, 3)");
  });
  it("round-trips with parseDagLine", () => {
    const line = emitSoftDag([{ step: "3", repo: "core", desc: "wire it", deps: "1,2" }]);
    expect(parseDagLine(line)).toEqual({ step: "3", repo: "core", path: "none", desc: "wire it", deps: "1,2" });
  });
});

describe("checkDagSection", () => {
  it("absent section → ok", () => { expect(checkDagSection("# X\n## Goal\ng\n")).toBe(true); });
  it("all numbered lines parse → ok", () => {
    expect(checkDagSection("## Execution DAG\n1. api — build\n2. web — ship (depends on 1)\n## Next\n")).toBe(true);
  });
  it("a malformed numbered line → fail", () => {
    expect(checkDagSection("## Execution DAG\n1. api - no emdash\n")).toBe(false);
  });
  it("box-art / prose lines are ignored (only ^digit. checked)", () => {
    expect(checkDagSection("## Execution DAG\nsome prose\n- a bullet\n1. api — build\n")).toBe(true);
  });
  it("suffixed heading is NOT recognized (treated as no-DAG)", () => {
    expect(checkDagSection("## Execution DAG (multi)\n1. bad line\n")).toBe(true);
  });
});
