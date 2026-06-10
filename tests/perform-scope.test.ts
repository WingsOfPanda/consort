// tests/perform-scope.test.ts
import { describe, it, expect } from "vitest";
import { extractComponentsPaths, matchDiffAgainstComponents } from "../src/core/performScope.js";

function doc(...lines: string[]): string { return lines.join("\n") + "\n"; }

describe("extractComponentsPaths", () => {
  it("extracts first-cell paths from the Components table, stripping backticks", () => {
    const d = doc("# Title", "## Goal", "do a thing", "## Components",
      "| File | Change |", "| ---- | ------ |", "| `src/core/foo.ts` | new |", "| `src/core/bar.ts` | edit |",
      "## Testing", "| `tests/should-not-appear.ts` | n/a |");
    expect(extractComponentsPaths(d)).toEqual(["src/core/foo.ts", "src/core/bar.ts"]);
  });
  it("returns [] when there is no Components section", () => {
    expect(extractComponentsPaths(doc("# T", "## Goal", "g", "## Testing", "t"))).toEqual([]);
  });
  it("returns [] when Components has no table", () => {
    expect(extractComponentsPaths(doc("## Components", "prose only, no table", "more prose"))).toEqual([]);
  });
  it("skips the separator row (only |, -, :, spaces)", () => {
    expect(extractComponentsPaths(doc("## Components", "| File |", "| :--- |", "| src/a.ts |"))).toEqual(["src/a.ts"]);
  });
  it("skips header-cell rows: File / Path / Name / Files edited|moved|touched", () => {
    const d = doc("## Components", "| File |", "| Path |", "| Name |", "| Files edited |", "| File moved |", "| Files touched |", "| src/keep.ts |");
    expect(extractComponentsPaths(d)).toEqual(["src/keep.ts"]);
  });
  it("path heuristic: keeps cells with a slash OR a .ext; drops bare words", () => {
    const d = doc("## Components", "| plainword | x |", "| README.md | x |", "| some/dir/ | x |", "| Makefile | x |");
    expect(extractComponentsPaths(d)).toEqual(["README.md", "some/dir/"]);
  });
  it("section ends at the next H2 heading (## something-else)", () => {
    expect(extractComponentsPaths(doc("## Components", "| src/in.ts | x |", "## Architecture", "| src/out.ts | x |"))).toEqual(["src/in.ts"]);
  });
  it("tolerates leading whitespace and a trailing pipe; trims the cell", () => {
    expect(extractComponentsPaths(doc("## Components", "   |  src/spaced.ts  |  notes  |"))).toEqual(["src/spaced.ts"]);
  });
  it("a Components heading with trailing whitespace still opens the section", () => {
    expect(extractComponentsPaths(doc("## Components   ", "| src/a.ts | x |"))).toEqual(["src/a.ts"]);
  });
  it("a non-exact Components heading (## Components (extra)) does NOT open the section", () => {
    expect(extractComponentsPaths(doc("## Components (extra)", "| src/a.ts | x |"))).toEqual([]);
  });
  it("bullet: extracts a backticked path", () => {
    expect(extractComponentsPaths(doc("## Components", "- `src/core/foo.ts` — add helper"))).toEqual(["src/core/foo.ts"]);
  });
  it("bullet: extracts a bare path with a trailing colon label", () => {
    expect(extractComponentsPaths(doc("## Components", "- src/core/bar.ts: edit"))).toEqual(["src/core/bar.ts"]);
  });
  it("bullet: extracts a path that appears mid-line", () => {
    expect(extractComponentsPaths(doc("## Components", "- add a helper to src/core/baz.ts"))).toEqual(["src/core/baz.ts"]);
  });
  it("bullet: extracts ALL path-like tokens from one bullet", () => {
    expect(extractComponentsPaths(doc("## Components", "- src/a.ts and src/b.ts"))).toEqual(["src/a.ts", "src/b.ts"]);
  });
  it("bullet: recognizes * and + markers", () => {
    expect(extractComponentsPaths(doc("## Components", "* src/star.ts", "+ src/plus.ts"))).toEqual(["src/star.ts", "src/plus.ts"]);
  });
  it("bullet: recognizes a nested/indented bullet", () => {
    expect(extractComponentsPaths(doc("## Components", "    - src/deep.ts"))).toEqual(["src/deep.ts"]);
  });
  it("bullet: trims surrounding punctuation but keeps a trailing slash", () => {
    expect(extractComponentsPaths(doc("## Components", "- `src/x.ts`,", "- (src/y.ts).", "- src/core/"))).toEqual(["src/x.ts", "src/y.ts", "src/core/"]);
  });
  it("bullet: drops bare words with no slash and no .ext", () => {
    expect(extractComponentsPaths(doc("## Components", "- just prose here", "- Makefile"))).toEqual([]);
  });
  it("bullet + table mixed in one section, document order", () => {
    const d = doc("## Components", "- src/bullet.ts", "| File | x |", "| `src/table.ts` | y |");
    expect(extractComponentsPaths(d)).toEqual(["src/bullet.ts", "src/table.ts"]);
  });
  it("bullet: a horizontal rule (---) is not a bullet and yields nothing", () => {
    expect(extractComponentsPaths(doc("## Components", "---"))).toEqual([]);
  });
  it("bullet: section still ends at the next H2 (bullet after ## Architecture not harvested)", () => {
    expect(extractComponentsPaths(doc("## Components", "- src/in.ts", "## Architecture", "- src/out.ts"))).toEqual(["src/in.ts"]);
  });
  it("over-match (accepted): a referenced path in a bullet IS pulled into scope", () => {
    expect(extractComponentsPaths(doc("## Components", "- see docs/DESIGN.md for context"))).toEqual(["docs/DESIGN.md"]);
  });
});

describe("matchDiffAgainstComponents", () => {
  it("empty output when every diff path matches a comp path exactly", () => {
    expect(matchDiffAgainstComponents(["src/a.ts", "src/b.ts"], ["src/a.ts", "src/b.ts"])).toEqual([]);
  });
  it("flags diff paths not covered by any comp path", () => {
    expect(matchDiffAgainstComponents(["src/a.ts", "src/rogue.ts"], ["src/a.ts"])).toEqual(["src/rogue.ts"]);
  });
  it("explicit dir comp (trailing slash) covers anything beneath it", () => {
    expect(matchDiffAgainstComponents(["src/core/deep/x.ts"], ["src/core/"])).toEqual([]);
  });
  it("implicit dir comp (no trailing slash) covers descendants via comp + '/'", () => {
    expect(matchDiffAgainstComponents(["src/core/x.ts"], ["src/core"])).toEqual([]);
  });
  it("implicit dir comp does NOT cover a sibling sharing the prefix without a slash boundary", () => {
    expect(matchDiffAgainstComponents(["src/coreutils.ts"], ["src/core"])).toEqual(["src/coreutils.ts"]);
  });
  it("trims whitespace and drops empty lines in both inputs", () => {
    expect(matchDiffAgainstComponents(["  src/a.ts  ", "", "   "], ["  src/a.ts  ", ""])).toEqual([]);
  });
  it("explicit dir prefix only matches when diff starts with the full trailing-slash path", () => {
    expect(matchDiffAgainstComponents(["src/coreother/x.ts"], ["src/core/"])).toEqual(["src/coreother/x.ts"]);
  });
  it("returns the out-of-scope paths in diff order", () => {
    expect(matchDiffAgainstComponents(["src/a.ts", "x/z.ts", "src/b.ts", "y/w.ts"], ["src/a.ts", "src/b.ts"])).toEqual(["x/z.ts", "y/w.ts"]);
  });
});
