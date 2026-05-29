import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { topicDir } from "../src/core/paths.js";
import { soloArtDir, soloExecDir, deriveSlug } from "../src/core/solo.js";

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
