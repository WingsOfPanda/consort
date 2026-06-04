// Lineage advisory for /consort:rehearsal (B2 operators & ideation quality). Pure: no FS/clock.
// Records the Draft/Improve edge per experiment; the audit-knob diff vs a named parent classifies
// whether an Improve's metric delta is cleanly attributable. Flag-don't-block (A3 philosophy);
// only "improve-multi" is surfaced by the status brief.

export interface LineageRow {
  expId: string;
  instrument: string;
  parentId: string;
  knobsChanged: string;   // "" for draft / unavailable; the integer count otherwise
  verdict: string;        // draft | improve-single | improve-multi | improve-unverified
  ts: string;
}

export const LINEAGE_TSV_HEADER = "exp_id\tinstrument\tparent_id\tknobs_changed\tverdict\tts\n";

export function lineageRow(r: LineageRow): string {
  return `${r.expId}\t${r.instrument}\t${r.parentId}\t${r.knobsChanged}\t${r.verdict}\t${r.ts}\n`;
}

/** Count mandated knobs that differ (numeric-tolerant) over the union of keys — mirrors the A3
 *  audit-knob-drift compare. Returns null when either audit is missing (cannot diff). A key present
 *  on only one side counts as a difference. */
export function diffAuditKnobs(
  parentAudit: Record<string, unknown> | null,
  childAudit: Record<string, unknown> | null,
): number | null {
  if (!parentAudit || !childAudit) return null;
  const keys = new Set([...Object.keys(parentAudit), ...Object.keys(childAudit)]);
  let n = 0;
  for (const k of keys) {
    const pa = parentAudit[k], ca = childAudit[k];
    const p = parseFloat(String(pa)), c = parseFloat(String(ca));
    const differ = (!Number.isNaN(p) && !Number.isNaN(c)) ? p !== c : String(pa) !== String(ca);
    if (differ) n += 1;
  }
  return n;
}

/** Lineage verdict from the recorded parent + audit-knob diff. No parent -> draft (a deliberate new
 *  angle). 0 changed knobs OR an unavailable diff -> improve-unverified (the change was a non-mandated
 *  knob, or the parent has no audit.json — cannot confirm a single mandated change). */
export function classifyLineage(parentId: string | undefined, knobsChanged: number | null): string {
  if (!parentId) return "draft";
  if (knobsChanged === null || knobsChanged === 0) return "improve-unverified";
  if (knobsChanged === 1) return "improve-single";
  return "improve-multi";
}
