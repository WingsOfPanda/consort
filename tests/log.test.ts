import { describe, it, expect } from "vitest";
import { createLogger } from "../src/core/log.js";

function capture(): { lines: string[]; stream: NodeJS.WritableStream } {
  const lines: string[] = [];
  const stream = { write: (s: string) => (lines.push(s), true) } as unknown as NodeJS.WritableStream;
  return { lines, stream };
}

describe("log", () => {
  it("no-color format is byte-exact", () => {
    const { lines, stream } = capture();
    const log = createLogger({ color: false, stream });
    log.info("hi");
    log.error("boom");
    log.ok("done");
    log.warn("careful");
    expect(lines).toEqual(["[INFO]  hi\n", "[FAIL]  boom\n", "[ OK ]  done\n", "[WARN]  careful\n"]);
  });
  it("color on wraps label only", () => {
    const { lines, stream } = capture();
    const log = createLogger({ color: true, stream });
    log.info("hi");
    log.ok("done");
    expect(lines[0]).toBe("\x1b[34m[INFO]\x1b[0m  hi\n");
    expect(lines[1]).toBe("\x1b[32m[ OK ]\x1b[0m  done\n");
  });
  it("joins multiple args with one space", () => {
    const { lines, stream } = capture();
    createLogger({ color: false, stream }).info("a", "b");
    expect(lines[0]).toBe("[INFO]  a b\n");
  });
});
