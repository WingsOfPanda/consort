import { join } from "node:path";
import { topicDir } from "./paths.js";

/** The rehearsal art/state dir for a topic: <topicDir>/_rehearsal. Mirrors score's _score. */
export function rehearsalArtDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  return join(topicDir(topic, opts), "_rehearsal");
}

/** <artDir>/parts — the per-part state root. */
export function partsDir(artDir: string): string {
  return join(artDir, "parts");
}

/** <artDir>/parts/<instrument> — one persistent part's dir (state.txt, experiments/, outbox.jsonl). */
export function partStateDir(artDir: string, instrument: string): string {
  return join(partsDir(artDir), instrument);
}

/** <artDir>/parts/<instrument>/experiments — the part's experiment branches. */
export function experimentsDir(artDir: string, instrument: string): string {
  return join(partStateDir(artDir, instrument), "experiments");
}

/** <artDir>/parts/<instrument>/experiments/<exp-id> — one experiment branch (code/, result.json, …). */
export function experimentDir(artDir: string, instrument: string, expId: string): string {
  return join(experimentsDir(artDir, instrument), expId);
}
