import { describe, it, expect } from "vitest";
import { haveCmd, tmuxVersionOk, inTmuxSession } from "../src/core/deps.js";

describe("deps", () => {
  it("haveCmd true/false", () => {
    expect(haveCmd("sh")).toBe(true);
    expect(haveCmd("cs-definitely-not-a-binary-2026")).toBe(false);
  });
  it("tmuxVersionOk: major>=3 only", () => {
    expect(tmuxVersionOk("tmux 3.0a")).toBe(true);
    expect(tmuxVersionOk("tmux 3.4")).toBe(true);
    expect(tmuxVersionOk("tmux 4.1")).toBe(true);
    expect(tmuxVersionOk("tmux 2.9a")).toBe(false); // looks close but major is 2
    expect(tmuxVersionOk("tmux 1.8")).toBe(false);
  });
  it("inTmuxSession reads TMUX", () => {
    expect(inTmuxSession({})).toBe(false);
    expect(inTmuxSession({ TMUX: "" })).toBe(false);
    expect(inTmuxSession({ TMUX: "/tmp/x,123,0" })).toBe(true);
  });
});
