import { describe, it, expect } from "vitest";
import * as C from "../src/core/colors.js";

describe("colors", () => {
  it("sectionFor maps instruments to orchestral sections", () => {
    expect(C.sectionFor("violin")).toBe("strings");
    expect(C.sectionFor("trumpet")).toBe("brass");
    expect(C.sectionFor("oboe")).toBe("woodwinds");
    expect(C.sectionFor("timpani")).toBe("percussion");
    expect(C.sectionFor("piano")).toBe("keys");
    expect(C.sectionFor("lute")).toBe("early");
    expect(C.sectionFor("zzz-unknown")).toBe("tutti");
  });
  it("colorFor returns Morandi primary; unknown → white", () => {
    expect(C.colorFor("violin")).toBe("colour110");
    expect(C.colorFor("zzz-unknown")).toBe("white");
  });
  it("labelFor: <section>-<instrument>:<model>:<topic>", () => {
    expect(C.labelFor("violin", "codex", "auth-review")).toBe("strings-violin:codex:auth-review");
  });
  it("labelFmt: colored striped border fragment", () => {
    const f = C.labelFmt("violin", "codex", "demo");
    expect(f).toBe("#[fg=colour110,bold]strings-violin#[default]:#[fg=colour187,bold]codex#[default]:demo");
  });
  it("ansiFromColor: colourNNN and bare number", () => {
    expect(C.ansiFromColor("colour110")).toBe("\x1b[38;5;110m");
    expect(C.ansiFromColor("42")).toBe("\x1b[38;5;42m");
    expect(C.ansiFromColor("white")).toBe("");
  });
  it("renderBannerHead: FINE banner, no MISSION ACCOMPLISHED", () => {
    const head = C.renderBannerHead("strings-violin:codex:demo", "colour110");
    expect(head).toContain("FINE — pane closing");
    expect(head).toContain("strings-violin:codex:demo");
    expect(head).not.toContain("MISSION ACCOMPLISHED");
    expect(head).toContain("━");
  });
});
