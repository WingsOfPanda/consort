import { describe, it, expect } from "vitest";
import { paneListedFor } from "../src/core/score.js";

const TSV = "violin\t%5\ncello\t%6\n";
describe("paneListedFor (L10)", () => {
  it("true when the instrument+pane pair is listed", () => {
    expect(paneListedFor(TSV, "violin", "%5")).toBe(true);
  });
  it("false when the pane belongs to a different instrument", () => {
    expect(paneListedFor(TSV, "violin", "%6")).toBe(false);
  });
  it("false when the pane is foreign / unlisted", () => {
    expect(paneListedFor(TSV, "violin", "%99")).toBe(false);
  });
});
