import { describe, it, expect } from "vitest";
import { paneBorderDiagnosis } from "../src/commands/soundcheck.js";

// consort's native @cs_ format (what spawn's ensurePaneBorders sets)
const CS_FMT = " #{?@cs_label_fmt,#{@cs_label_fmt},#[fg=#{?@cs_color,#{@cs_color},default}#,bold]#{?@cs_label,#{@cs_label},#{pane_title}}#[default]} ";
// a stale clone-wars-only format (the leftover that silently breaks consort labels)
const STALE_CW = " #{?@cw_label_fmt,#{@cw_label_fmt},#[fg=#{?@cw_color,#{@cw_color},default}#,bold]#{?@cw_label,#{@cw_label},#{pane_title}}#[default]} ";
// a unified format reading both key-sets
const UNIFIED = " #{?@cs_label_fmt,#{@cs_label_fmt},#{?@cw_label_fmt,#{@cw_label_fmt},#{?@cs_label,#{@cs_label},#{?@cw_label,#{@cw_label},#{pane_title}}}}} ";

describe("paneBorderDiagnosis (port of medic's pane-border check)", () => {
  it("ok when status=top and the format reads @cs_label", () => {
    const d = paneBorderDiagnosis("top", CS_FMT);
    expect(d.ok).toBe(true);
    expect(d.lines[0]).toMatch(/@cs_label-aware/);
  });
  it("ok with status=bottom too", () => {
    expect(paneBorderDiagnosis("bottom", CS_FMT).ok).toBe(true);
  });
  it("warns when pane-border-status is off, naming it (upstream issue checked first)", () => {
    const d = paneBorderDiagnosis("off", CS_FMT);
    expect(d.ok).toBe(false);
    expect(d.lines[0]).toMatch(/pane-border-status is 'off'/);
  });
  it("treats empty status as 'off'", () => {
    expect(paneBorderDiagnosis("", CS_FMT).lines[0]).toMatch(/'off'/);
  });
  it("warns when the format is a stale @cw_-only one (the clone-wars leftover that broke score)", () => {
    const d = paneBorderDiagnosis("top", STALE_CW);
    expect(d.ok).toBe(false);
    expect(d.lines[0]).toMatch(/doesn't read @cs_label/);
  });
  it("ok for a unified @cs_+@cw_ format", () => {
    expect(paneBorderDiagnosis("top", UNIFIED).ok).toBe(true);
  });
  it("includes the tmux.conf fix snippet when warning", () => {
    const d = paneBorderDiagnosis("off", "");
    expect(d.lines.some((l) => l.includes("pane-border-status top"))).toBe(true);
    expect(d.lines.some((l) => l.includes("@cs_label_fmt"))).toBe(true);
  });
});
