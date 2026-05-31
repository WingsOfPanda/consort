import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { repoStateDir, isArtifactDir } from "../core/paths.js";
import { paneMetaReadForDir, outboxPath } from "../core/ipc.js";
import { paneAlive } from "../core/tmux.js";

export function deriveState(lastEvent: string | undefined): string {
  switch (lastEvent) {
    case undefined: case "": return "spawning";
    case "done": return "idle (done)";
    case "error": return "idle (error)";
    case "ack": return "working";
    case "ready": return "ready";
    default: return lastEvent;
  }
}

export function lastOutboxEvent(outbox: string): string | undefined {
  if (!existsSync(outbox)) return undefined;
  const lines = readFileSync(outbox, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) return undefined;
  try { return (JSON.parse(lines[lines.length - 1]) as { event?: string }).event; } catch { return undefined; }
}

export function classifyStale(state: string, outbox: string, thresholdS = 180): string {
  if (state !== "working" || !existsSync(outbox)) return state;
  const t = Number.isInteger(thresholdS) && thresholdS >= 0 ? thresholdS : 180;
  const ageS = (Date.now() - statSync(outbox).mtimeMs) / 1000;
  return ageS > 0 && ageS > t ? "stale" : state;
}

export async function run(args: string[]): Promise<number> {
  const filter = args.find((a) => !a.startsWith("--"));
  const repo = repoStateDir();
  if (!existsSync(repo)) { process.stdout.write(`no parts deployed (state dir absent: ${repo})\n`); return 0; }
  const W = (s: string, n: number) => s.padEnd(n);
  process.stdout.write(`${W("PART", 32)} ${W("MODEL", 8)} ${W("TOPIC", 12)} ${W("PANE", 9)} STATE\n`);
  process.stdout.write(`${"-".repeat(32)} ${"-".repeat(8)} ${"-".repeat(12)} ${"-".repeat(9)} -----\n`);
  for (const t of readdirSync(repo, { withFileTypes: true })) {
    if (!t.isDirectory()) continue;
    if (filter && t.name !== filter) continue;
    const td = join(repo, t.name);
    for (const p of readdirSync(td, { withFileTypes: true })) {
      if (!p.isDirectory() || isArtifactDir(p.name)) continue;
      const dir = join(td, p.name);
      const meta = paneMetaReadForDir(dir);
      const pane = meta.paneId || "?";
      const ob = outboxPath(meta.instrument, meta.model, t.name);
      let state = "[ORPHAN]";
      if (pane !== "?" && (await paneAlive(pane))) state = classifyStale(deriveState(lastOutboxEvent(ob)), ob);
      process.stdout.write(`${W(meta.instrument, 32)} ${W(meta.model, 8)} ${W(t.name, 12)} ${W(pane, 9)} ${state}\n`);
    }
  }
  return 0;
}
