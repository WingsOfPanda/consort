import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

// Fails if Star-Wars / clone-wars residue appears in shipped source, config, or commands.
// Excludes node_modules, dist, docs (the design doc legitimately discusses the rename),
// and this test file itself.
describe("stale-token gate", () => {
  const banned = ["clone-wars", "cw_", "master-yoda", "MISSION ACCOMPLISHED", "@cw_"];
  for (const token of banned) {
    it(`no shipped file contains '${token}'`, () => {
      let out = "";
      try {
        out = execSync(
          `grep -rIn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=docs ` +
          `--exclude-dir=.git --exclude=stale-tokens.test.ts -- ${JSON.stringify(token)} ` +
          `src config commands hooks .claude-plugin || true`,
          { cwd: process.cwd(), encoding: "utf8" },
        );
      } catch { /* grep exit 1 = no match */ }
      expect(out.trim()).toBe("");
    });
  }
});
