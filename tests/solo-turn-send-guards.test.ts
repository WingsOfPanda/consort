import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { turnSendWith } from "../src/commands/solo.js";
import { soloArtDir, soloExecDir } from "../src/core/solo.js";
import { partDir } from "../src/core/paths.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

function stageSolo(topic: string, instrument: string, provider: string) {
  const art = soloArtDir(topic);
  mkdirSync(art, { recursive: true });
  mkdirSync(soloExecDir(topic), { recursive: true }); // real `solo init` always creates the exec dir before turn-send
  writeFileSync(join(art, "instrument.txt"), instrument + "\n");
  writeFileSync(join(art, "selected-provider.txt"), provider + "\n");
  const pd = partDir(instrument, provider, topic);
  mkdirSync(pd, { recursive: true });
  return { art, pd };
}
const deps = { offsetFor: () => 0, send: async () => 0 };

describe("solo turn-send guards", () => {
  it("L7: fails when the part outbox is absent ('was it spawned?')", async () => {
    stageSolo("topic-a", "violin", "claude"); // no outbox.jsonl
    expect(await turnSendWith("topic-a", 1, deps)).toBe(1);
  });
  it("M2: fails when the part is not idle (previous turn in flight)", async () => {
    const { pd } = stageSolo("topic-b", "violin", "claude");
    writeFileSync(join(pd, "outbox.jsonl"), "");
    writeFileSync(join(pd, "status.json"), JSON.stringify({ state: "working" }) + "\n");
    expect(await turnSendWith("topic-b", 1, deps)).toBe(1);
  });
  it("proceeds (rc 0) when outbox exists and the part is idle", async () => {
    const { pd } = stageSolo("topic-c", "violin", "claude");
    writeFileSync(join(pd, "outbox.jsonl"), "");
    writeFileSync(join(pd, "status.json"), JSON.stringify({ state: "idle" }) + "\n");
    writeFileSync(join(soloArtDir("topic-c"), "task-brief.md"), "do x");
    expect(await turnSendWith("topic-c", 1, deps)).toBe(0);
  });
});
