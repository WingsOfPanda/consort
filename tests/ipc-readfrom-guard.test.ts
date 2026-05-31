import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync } from "node:fs";
import { freshHome } from "./helpers/tmpHome.js";
import { outboxWaitSince, outboxPath } from "../src/core/ipc.js";
import { partDir } from "../src/core/paths.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

describe("readFrom guard (M4)", () => {
  it("degrades to a timeout (null) instead of throwing when the outbox path is unreadable", async () => {
    // make the outbox path a DIRECTORY so openSync(path,'r') throws EISDIR
    mkdirSync(partDir("violin", "claude", "t"), { recursive: true });
    mkdirSync(outboxPath("violin", "claude", "t")); // outbox.jsonl as a dir
    await expect(outboxWaitSince("violin", "claude", "t", 0, ["done"], 1)).resolves.toBeNull();
  });
});
