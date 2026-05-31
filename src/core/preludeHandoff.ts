// src/core/preludeHandoff.ts — handoff-data.kv extraction for /consort:prelude (port of the
// extract-handoff-data helper in meditate.sh). RECONCILED reads: confidence_signals from
// adversary-skip.txt, adversary_findings_paths from adversary-*.md (the bash read filenames the
// directive never wrote). Key set + order is FROZEN.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./atomic.js";
import { isoUtc } from "./archive.js";
import { topApproach as firstApproach } from "./preludeConfidence.js"; // reuse the same first-approach scan
import { readIfExistsOrNull as readIf } from "./fsread.js";

export interface HandoffInput {
  topic: string;
  landscapeDoc?: string;
  topApproach: string;
  findingsPaths: string[];
  confidenceSignals: string;
  adversaryFindingsPaths: string[];
  tradeoffMatrixPresent: boolean;
  generatedTs: string;
}

/** handoff-data.kv body. Key ORDER is load-bearing. Conditional lines omitted when empty. */
export function buildHandoffKv(i: HandoffInput): string {
  const L: string[] = [];
  L.push(`mode=${i.topApproach ? "prelude" : "prelude-no-convergence"}`);
  L.push(`topic=${i.topic}`);
  if (i.landscapeDoc) L.push(`landscape_doc=${i.landscapeDoc}`);
  if (i.topApproach) L.push(`top_approach=${i.topApproach}`);
  if (i.findingsPaths.length) L.push(`findings_paths=${i.findingsPaths.join(",")}`);
  if (i.confidenceSignals) L.push(`confidence_signals=${i.confidenceSignals}`);
  if (i.adversaryFindingsPaths.length) L.push(`adversary_findings_paths=${i.adversaryFindingsPaths.join(",")}`);
  L.push(`tradeoff_matrix_present=${i.tradeoffMatrixPresent}`);
  L.push("session_path=.");
  L.push("topic_txt_path=topic.txt");
  L.push(`generated_ts=${i.generatedTs}`);
  return L.join("\n") + "\n";
}

/** Walk an art dir → write handoff-data.kv. Returns the path, or null if art-dir/topic.txt missing. */
export function extractHandoffData(artDir: string, now?: Date): string | null {
  if (!existsSync(artDir) || !statSync(artDir).isDirectory()) return null;
  const topicTxt = readIf(join(artDir, "topic.txt"));
  if (topicTxt === null) return null;
  const topic = topicTxt.replace(/\n/g, " ").replace(/ +$/, "");

  const names = readdirSync(artDir);
  // landscape: prefer the non-draft (final) match, else landscape-draft.md. Sorted so .find picks
  // the lexically-first non-draft deterministically (matches the bash `for f in landscape-*.md`).
  const landscapes = names.filter((n) => /^landscape-.*\.md$/.test(n)).sort();
  const landscapeDoc = landscapes.find((n) => n !== "landscape-draft.md")
    ?? (landscapes.includes("landscape-draft.md") ? "landscape-draft.md" : undefined);

  const findingsPaths = names.filter((n) => /^findings-.*\.md$/.test(n)).sort();
  const adversaryFindingsPaths = names.filter((n) => /^adversary-.*\.md$/.test(n)).sort();

  let top = "", tradeoff = false;
  if (landscapeDoc) {
    const doc = readFileSync(join(artDir, landscapeDoc), "utf8");
    top = firstApproach(doc);
    tradeoff = /^## Tradeoff matrix/m.test(doc);
  }

  // RECONCILED: confidence_signals from adversary-skip.txt's signals_passed line → CSV.
  let confidenceSignals = "";
  const skip = readIf(join(artDir, "adversary-skip.txt"));
  if (skip) {
    const m = skip.split("\n").find((l) => l.startsWith("signals_passed:"));
    if (m) confidenceSignals = m.replace(/^signals_passed:\s*/, "").trim().replace(/\s+/g, ",");
  }

  const body = buildHandoffKv({
    topic, landscapeDoc, topApproach: top, findingsPaths, confidenceSignals,
    adversaryFindingsPaths, tradeoffMatrixPresent: tradeoff, generatedTs: isoUtc(now),
  });
  const dest = join(artDir, "handoff-data.kv");
  atomicWrite(dest, body);
  return dest;
}
