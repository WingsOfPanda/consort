import { describe, it, expect } from "vitest";
import * as T from "../src/core/tmux.js";

describe("tmux arg builders", () => {
  it("splitRightArgs: -h, capture pane id, cwd, target", () => {
    expect(T.splitRightArgs("LAUNCH", "%1", "/repo")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-h", "-t", "%1", "-c", "/repo", "LAUNCH"]);
    expect(T.splitRightArgs("LAUNCH", undefined, "/repo")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-h", "-c", "/repo", "LAUNCH"]);
  });
  it("splitDownArgs: -v, requires target", () => {
    expect(T.splitDownArgs("LAUNCH", "%2", "/repo")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-v", "-t", "%2", "-c", "/repo", "LAUNCH"]);
  });
  it("respawnArgs: -k, optional cwd", () => {
    expect(T.respawnArgs("%3", "LAUNCH", "/repo")).toEqual(
      ["respawn-pane", "-k", "-t", "%3", "-c", "/repo", "LAUNCH"]);
    expect(T.respawnArgs("%3", "LAUNCH")).toEqual(["respawn-pane", "-k", "-t", "%3", "LAUNCH"]);
  });
  it("paneBorderArgs: status top + @cs_-aware format + active-border hook (no @cw_)", () => {
    const a = T.paneBorderArgs();
    expect(a[0]).toEqual(["set-option", "-g", "pane-border-status", "top"]);
    expect(a[1][0]).toBe("set-option");
    expect(a[1]).toContain("pane-border-format");
    expect(a[1][3]).toContain("#{@cs_label_fmt}");
    expect(a[1][3]).toContain("#{pane_title}"); // fallback for unlabeled panes
    expect(a[2][0]).toBe("set-hook");
    expect(a[2][1]).toBe("-g");
    expect(a[2][2]).toBe("after-select-pane");
    // rebrand: never reference the clone-wars @cw_ keys
    expect(JSON.stringify(a)).not.toContain("@cw_");
  });
  it("wrapLaunch: bashrc wrap when present", () => {
    expect(T.wrapLaunch("codex --foo", true)).toBe("bash -ic 'exec codex --foo'");
    expect(T.wrapLaunch("codex --foo", false)).toBe("codex --foo");
  });
  it("setOptionArgs / sendKeysLiteralArgs / sendKeysEnterArgs", () => {
    expect(T.setOptionArgs("%1", "@cs_color", "colour110")).toEqual(
      ["set-option", "-p", "-t", "%1", "@cs_color", "colour110"]);
    expect(T.sendKeysLiteralArgs("%1", "Read x")).toEqual(["send-keys", "-t", "%1", "-l", "Read x"]);
    expect(T.sendKeysEnterArgs("%1")).toEqual(["send-keys", "-t", "%1", "Enter"]);
  });
  it("sentinelCommand holds pane open with colored label", () => {
    const c = T.sentinelCommand("#[fg=colour110,bold]strings-violin#[default]");
    expect(c).toContain("reserved — awaiting spawn");
    expect(c).toContain("sleep infinity");
  });
  it("windowBorderStatusArgs sets pane-border-status top on the target window", () => {
    expect(T.windowBorderStatusArgs("%5")).toEqual(["set-option", "-w", "-t", "%5", "pane-border-status", "top"]);
  });
});
