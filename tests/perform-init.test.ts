// tests/perform-init.test.ts — B2a: perform init verb (initWith core path).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import { initWith, run as performRun, type PerformInitDeps } from "../src/commands/perform.js";

// A minimal design doc that satisfies auditDoc (title + the four required sections).
const PASSING_DOC =
  "# Add OAuth Login\n\n" +
  "## Goal\nShip OAuth.\n\n" +
  "## Architecture\nA token exchange.\n\n" +
  "## Testing\nUnit + integration.\n\n" +
  "## Success Criteria\nLogin works.\n";

// Same body but missing ## Goal → audit FAIL with no_goal_section.
const NO_GOAL_DOC =
  "# Add OAuth Login\n\n" +
  "## Architecture\nA token exchange.\n\n" +
  "## Testing\nUnit + integration.\n\n" +
  "## Success Criteria\nLogin works.\n";

// Multi-repo: plural Target header + an Execution DAG section, otherwise audit-passing.
// The DAG section must be parseable (checkDagSection) or audit FAILs on execution_dag_not_parseable.
const MULTI_DOC =
  "# Cross-Repo Refactor\n\n" +
  "**Target Sub-Project(s):** api, web\n\n" +
  "## Goal\nRefactor.\n\n" +
  "## Architecture\nShared lib.\n\n" +
  "## Testing\nPer-repo suites.\n\n" +
  "## Success Criteria\nGreen everywhere.\n\n" +
  "## Execution DAG\n" +
  "- api: (no deps)\n" +
  "- web: api\n";

function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (chunk: any, ..._rest: any[]) => { buf += String(chunk); return true; };
  return { text: () => buf, restore: () => { (process.stdout as any).write = orig; } };
}
function captureStderr() {
  const orig = process.stderr.write.bind(process.stderr);
  let buf = "";
  (process.stderr as any).write = (chunk: any, ..._rest: any[]) => { buf += String(chunk); return true; };
  return { text: () => buf, restore: () => { (process.stderr as any).write = orig; } };
}

describe("perform init", () => {
  let h: { home: string; cleanup: () => void };
  let tmpRepo: string;
  let outSpy: ReturnType<typeof captureStdout>;
  let errSpy: ReturnType<typeof captureStderr>;
  let deps: PerformInitDeps;

  beforeEach(() => {
    h = freshHome();
    // A real on-disk "repo" dir that detectProvider sees as a non-plugin repo → codex.
    tmpRepo = join(h.home, "repo");
    mkdirSync(tmpRepo, { recursive: true });
    deps = { repoRoot: () => tmpRepo };
    outSpy = captureStdout();
    errSpy = captureStderr();
  });
  afterEach(() => { outSpy.restore(); errSpy.restore(); h.cleanup(); });

  // Helper: write a design doc to a real path on disk and return it.
  function docFile(name: string, body: string): string {
    const p = join(h.home, name);
    writeFileSync(p, body);
    return p;
  }

  it("happy single-repo → rc 0, scaffolds _perform with all artifacts (no trailing \\n in topic.txt)", async () => {
    const p = docFile("2026-05-30-add-oauth-design.md", PASSING_DOC);
    const rc = await initWith([p], deps);
    expect(rc).toBe(0);
    const art = performArtDir("add-oauth");
    expect(existsSync(art)).toBe(true);
    expect(readFileSync(join(art, "topic.txt"), "utf8")).toBe("add-oauth"); // NO trailing newline
    expect(readFileSync(join(art, "target_cwd.txt"), "utf8")).toBe(tmpRepo + "\n");
    expect(readFileSync(join(art, "provider.txt"), "utf8")).toBe("codex\n");
    expect(readFileSync(join(art, "multi-repo.txt"), "utf8")).toBe("single\n");
    expect(readFileSync(join(art, "design.md"), "utf8")).toBe(PASSING_DOC);
    const out = outSpy.text();
    expect(out).toContain(`ART=${art}`);
    expect(out).toContain("TOPIC=add-oauth");
    expect(out).toContain("ROUTING=single");
    expect(out).toContain("PROVIDER=codex");
    expect(out).toContain(`TARGET_CWD=${tmpRepo}`);
  });

  it("audit FAIL (missing ## Goal) → rc 1, ISSUE on stderr, NO _perform dir", async () => {
    const p = docFile("2026-05-30-add-oauth-design.md", NO_GOAL_DOC);
    const rc = await initWith([p], deps);
    expect(rc).toBe(1);
    expect(errSpy.text()).toContain("ISSUE=no_goal_section");
    expect(existsSync(performArtDir("add-oauth"))).toBe(false);
  });

  it("in-flight (art dir pre-exists) → rc 2", async () => {
    mkdirSync(performArtDir("add-oauth"), { recursive: true });
    const p = docFile("2026-05-30-add-oauth-design.md", PASSING_DOC);
    expect(await initWith([p], deps)).toBe(2);
  });

  it("--max-rounds 3 → rc 2 (PerformArgError bubbles via e.code)", async () => {
    const p = docFile("2026-05-30-add-oauth-design.md", PASSING_DOC);
    expect(await initWith(["--max-rounds", "3", p], deps)).toBe(2);
  });

  it("two positionals → rc 2", async () => {
    const a = docFile("a-design.md", PASSING_DOC);
    const b = docFile("b-design.md", PASSING_DOC);
    expect(await initWith([a, b], deps)).toBe(2);
  });

  it("zero positionals → rc 2", async () => {
    expect(await initWith([], deps)).toBe(2);
  });

  it("unreadable design path → rc 1", async () => {
    expect(await initWith([join(h.home, "nope-design.md")], deps)).toBe(1);
  });

  it("--topic custom overrides the derived topic", async () => {
    const p = docFile("2026-05-30-add-oauth-design.md", PASSING_DOC);
    const rc = await initWith(["--topic", "custom", p], deps);
    expect(rc).toBe(0);
    expect(existsSync(performArtDir("custom"))).toBe(true);
    expect(readFileSync(join(performArtDir("custom"), "topic.txt"), "utf8")).toBe("custom");
    expect(outSpy.text()).toContain("TOPIC=custom");
  });

  it("over-length --topic → rc 2 and scaffolds nothing", async () => {
    const p = docFile("2026-05-30-add-oauth-design.md", PASSING_DOC);
    const badTopic = "iris-code-simplify-sweep-2-tiers-bce"; // 36 chars
    const rc = await initWith(["--topic", badTopic, p], deps);
    expect(rc).toBe(2);
    expect(existsSync(performArtDir(badTopic))).toBe(false);
    expect(errSpy.text()).toContain("--topic");
  });

  it("multi-repo doc → rc 0, multi-repo.txt=multi, ROUTING=multi; init writes no dag/parts files (the directive's dag-parse/multi-init do)", async () => {
    const p = docFile("2026-05-30-refactor-design.md", MULTI_DOC);
    const rc = await initWith([p], deps);
    expect(rc).toBe(0);
    const art = performArtDir("refactor");
    expect(readFileSync(join(art, "multi-repo.txt"), "utf8")).toBe("multi\n");
    expect(outSpy.text()).toContain("ROUTING=multi");
    // init only records routing; it no longer warns (the multi-repo flow is the directive's job now).
    expect(existsSync(join(art, "parts.txt"))).toBe(false);
    expect(existsSync(join(art, "dag-waves.txt"))).toBe(false);
  });

  // ---- audit verb (standalone "Proceed anyway" precheck — deploy parity) ----
  it("audit verb: passing doc → rc 0", async () => {
    const p = docFile("good-design.md", PASSING_DOC);
    expect(await performRun(["audit", p])).toBe(0);
  });

  it("audit verb: failing doc (missing ## Goal) → rc 1, ISSUE on stderr", async () => {
    const p = docFile("bad-design.md", NO_GOAL_DOC);
    expect(await performRun(["audit", p])).toBe(1);
    expect(errSpy.text()).toContain("ISSUE=no_goal_section");
  });

  it("audit verb: nonexistent path → rc 2 (unreadable)", async () => {
    expect(await performRun(["audit", join(h.home, "nope-design.md")])).toBe(2);
  });

  it("audit verb: missing arg → rc 2", async () => {
    expect(await performRun(["audit"])).toBe(2);
  });

  // ---- init --force (bypass an audit FAIL — deploy "Proceed anyway") ----
  it("init WITHOUT --force on a failing doc → rc 1 (audit FAIL not bypassed)", async () => {
    const p = docFile("2026-05-30-add-oauth-design.md", NO_GOAL_DOC);
    expect(await initWith([p], deps)).toBe(1);
    expect(existsSync(performArtDir("add-oauth"))).toBe(false);
  });

  it("init WITH --force on a failing doc → rc 0, scaffolds, writes auto_provider.txt", async () => {
    const p = docFile("2026-05-30-add-oauth-design.md", NO_GOAL_DOC);
    const rc = await initWith(["--force", p], deps);
    expect(rc).toBe(0);
    const art = performArtDir("add-oauth");
    expect(existsSync(art)).toBe(true);
    expect(readFileSync(join(art, "auto_provider.txt"), "utf8")).toMatch(/codex|claude/);
  });

  it("init WITH --force on a PASSING doc → rc 0, still writes auto_provider.txt", async () => {
    const p = docFile("2026-05-30-add-oauth-design.md", PASSING_DOC);
    const rc = await initWith(["--force", p], deps);
    expect(rc).toBe(0);
    const art = performArtDir("add-oauth");
    expect(readFileSync(join(art, "auto_provider.txt"), "utf8")).toBe("codex\n");
  });
});
