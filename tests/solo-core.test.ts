import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { topicDir } from "../src/core/paths.js";
import { soloArtDir, soloExecDir, deriveSlug, parseSoloArgs } from "../src/core/solo.js";

afterEach(() => { delete process.env.CONSORT_HOME; });

describe("solo paths", () => {
  it("soloArtDir/soloExecDir nest under the topic dir", () => {
    process.env.CONSORT_HOME = "/R";
    expect(soloArtDir("auth")).toBe(join(topicDir("auth"), "_solo"));
    expect(soloExecDir("auth")).toBe(join(topicDir("auth"), "_solo", "execute"));
  });
});

describe("deriveSlug", () => {
  it("lowercases, replaces non [a-z0-9-], collapses dashes, caps at 20, trims dashes", () => {
    expect(deriveSlug("Add OAuth login!")).toBe("add-oauth-login");
    expect(deriveSlug("  spaces   and---dashes  ")).toBe("spaces-and-dashes");
    expect(deriveSlug("A".repeat(40))).toBe("a".repeat(20));
    expect(deriveSlug("trailing dash exactly 20x-")).toBe("trailing-dash-exactl");
    expect(deriveSlug("!!!")).toBe("");
  });
});

describe("parseSoloArgs", () => {
  it("pulls --provider (space + = forms) and --finish out of the topic text", () => {
    expect(parseSoloArgs(["add", "oauth", "login"]))
      .toEqual({ topicText: "add oauth login", provider: undefined, finish: false });
    expect(parseSoloArgs(["fix", "bug", "--provider", "agy"]))
      .toEqual({ topicText: "fix bug", provider: "agy", finish: false });
    expect(parseSoloArgs(["--provider=opencode", "tidy", "imports", "--finish"]))
      .toEqual({ topicText: "tidy imports", provider: "opencode", finish: true });
  });
});
