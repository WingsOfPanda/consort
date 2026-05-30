import { describe, it, expect } from "vitest";
import { parseScoreboard, buildHandoffKv } from "../src/core/rehearsalHandoff.js";

const SB = [
  "<!-- scoreboard schema_version=2 -->", "# Scoreboard", "",
  "| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |",
  "|---|---|---|---|---|---|---|---|",
  "| 1 | exp-003 | violin | 0.9950 | ok | 40.00s | augment-a2 | accuracy |",
  "| 2 | exp-002 | viola | 0.9100 | ok | 41.00s | augment-b | accuracy |",
  "| ~3 | exp-001 | cello | n/a | partial | 5.00s | baseline | accuracy |",
].join("\n") + "\n";

describe("parseScoreboard", () => {
  it("picks first-ok winner + next-ok runner-ups (skips partial)", () => {
    const r = parseScoreboard(SB);
    expect(r.winner).toMatchObject({ expId: "exp-003", instrument: "violin", metric: "0.9950", status: "ok" });
    expect(r.runnerUps.map((x) => x.instrument)).toEqual(["viola"]);
    expect(r.rows.length).toBe(3); // all data rows incl. the partial
  });
  it("winner null when no ok row", () => {
    const md = SB.replace(/ ok /g, " partial ");
    expect(parseScoreboard(md).winner).toBeNull();
  });
});

describe("buildHandoffKv", () => {
  it("winner branch — exact key order + winner_code_dir always emitted", () => {
    const kv = buildHandoffKv({
      topic: "rehearsal-x", landscapeDoc: "rehearsal-2026-05-30-x.md", hasMetricMd: true,
      generatedTs: "2026-05-30T11:00:00Z",
      winner: { instrument: "violin", exp: "exp-003", approach: "augment-a2", metric: "0.9950",
                checkpoint: "parts/violin/experiments/exp-003/model.pt", notes: "best run",
                codeDir: "parts/violin/experiments/exp-003/code/" },
      runnerUps: [{ instrument: "viola", exp: "exp-002", metric: "0.9100", approach: "augment-b" }],
    });
    expect(kv.split("\n").filter(Boolean)).toEqual([
      "mode=rehearsal", "topic=rehearsal-x", "landscape_doc=rehearsal-2026-05-30-x.md",
      "winner_instrument=violin", "winner_exp=exp-003", "winner_approach=augment-a2", "winner_metric=0.9950",
      "winner_checkpoint=parts/violin/experiments/exp-003/model.pt", "winner_notes=best run",
      "winner_code_dir=parts/violin/experiments/exp-003/code/",
      "runner_up_1=viola/exp-002:0.9100:augment-b",
      "mandates_block_path=metric.md", "session_path=.", "topic_txt_path=topic.txt",
      "generated_ts=2026-05-30T11:00:00Z",
    ]);
  });
  it("winner branch omits conditional keys (no checkpoint/notes/landscape), approach default unknown", () => {
    const kv = buildHandoffKv({
      topic: "rehearsal-x", hasMetricMd: false, generatedTs: "t",
      winner: { instrument: "violin", exp: "exp-003", approach: "", metric: "0.99",
                codeDir: "parts/violin/experiments/exp-003/code/" },
      runnerUps: [{ instrument: "viola", exp: "exp-002", metric: "0.91", approach: "" }],
    });
    expect(kv.split("\n").filter(Boolean)).toEqual([
      "mode=rehearsal", "topic=rehearsal-x",
      "winner_instrument=violin", "winner_exp=exp-003", "winner_approach=unknown", "winner_metric=0.99",
      "winner_code_dir=parts/violin/experiments/exp-003/code/",
      "runner_up_1=viola/exp-002:0.91:unknown",
      "session_path=.", "topic_txt_path=topic.txt", "generated_ts=t",
    ]);
  });
  it("no-winner branch", () => {
    const kv = buildHandoffKv({ topic: "rehearsal-x", hasMetricMd: false, generatedTs: "t", winner: null, runnerUps: [] });
    expect(kv.split("\n").filter(Boolean)).toEqual([
      "mode=rehearsal-no-winner", "topic=rehearsal-x", "session_path=.", "topic_txt_path=topic.txt", "generated_ts=t",
    ]);
  });
});
