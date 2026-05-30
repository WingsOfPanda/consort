// Pure handoff logic for /consort:rehearsal. Faithful to deep-research-handoff-extract.sh
// + the extract-handoff-data helper. Winner source = scoreboard.md first-ok row.

export interface ScoreboardRow { rank: string; expId: string; instrument: string; metric: string; status: string; }

/** Parse scoreboard.md data rows; winner = first status==ok; runnerUps = next ok rows (max 3). */
export function parseScoreboard(md: string): { rows: ScoreboardRow[]; winner: ScoreboardRow | null; runnerUps: ScoreboardRow[] } {
  const rows: ScoreboardRow[] = [];
  for (const line of md.split("\n")) {
    if (!/^\|\s*~?\d+\s*\|\s*exp-\d+\s*\|/.test(line)) continue;
    const c = line.split("|").map((s) => s.trim());
    // c[0]="" c[1]=rank c[2]=exp c[3]=instrument c[4]=metric c[5]=status
    rows.push({ rank: c[1], expId: c[2], instrument: c[3], metric: c[4], status: c[5] });
  }
  const ok = rows.filter((r) => r.status === "ok");
  const winner = ok[0] ?? null;
  const runnerUps = ok.slice(1, 4);
  return { rows, winner, runnerUps };
}

export interface HandoffInput {
  topic: string;
  landscapeDoc?: string;
  hasMetricMd: boolean;
  generatedTs: string;
  winner: null | {
    instrument: string; exp: string; approach: string; metric: string;
    checkpoint?: string; notes?: string; codeDir: string;
  };
  runnerUps: { instrument: string; exp: string; metric: string; approach: string }[];
}

/** Build handoff-data.kv body. Key ORDER is load-bearing (byte-identical fixtures). */
export function buildHandoffKv(i: HandoffInput): string {
  const L: string[] = [];
  if (!i.winner) {
    L.push("mode=rehearsal-no-winner", `topic=${i.topic}`);
    if (i.landscapeDoc) L.push(`landscape_doc=${i.landscapeDoc}`);
    if (i.hasMetricMd) L.push("mandates_block_path=metric.md");
    L.push("session_path=.", "topic_txt_path=topic.txt", `generated_ts=${i.generatedTs}`);
    return L.join("\n") + "\n";
  }
  const w = i.winner;
  L.push("mode=rehearsal", `topic=${i.topic}`);
  if (i.landscapeDoc) L.push(`landscape_doc=${i.landscapeDoc}`);
  L.push(`winner_instrument=${w.instrument}`, `winner_exp=${w.exp}`, `winner_approach=${w.approach || "unknown"}`,
    `winner_metric=${w.metric}`);
  if (w.checkpoint) L.push(`winner_checkpoint=${w.checkpoint}`);
  if (w.notes) L.push(`winner_notes=${w.notes}`);
  L.push(`winner_code_dir=${w.codeDir}`);
  i.runnerUps.forEach((r, n) => L.push(`runner_up_${n + 1}=${r.instrument}/${r.exp}:${r.metric}:${r.approach || "unknown"}`));
  if (i.hasMetricMd) L.push("mandates_block_path=metric.md");
  L.push("session_path=.", "topic_txt_path=topic.txt", `generated_ts=${i.generatedTs}`);
  return L.join("\n") + "\n";
}
