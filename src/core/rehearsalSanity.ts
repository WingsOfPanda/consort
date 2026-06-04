// Mechanical, task-agnostic sanity checks for /consort:rehearsal (research-validity A3).
// Flags a VALID result as suspect; orthogonal to A1's verify verdict. Pure: FS injected; the score
// pass applies the rows. A clean result returns no flags.

export interface SanityFlag { flag: string; detail: string; }

export interface SanityRow { expId: string; instrument: string; flag: string; detail: string; ts: string; }
export const SANITY_TSV_HEADER = "exp_id\tinstrument\tflag\tdetail\tts\n";
export function sanityRow(r: SanityRow): string {
  return `${r.expId}\t${r.instrument}\t${r.flag}\t${r.detail}\t${r.ts}\n`;
}

const INTEGRITY_KEYS = ["split_before_fit", "no_train_test_overlap", "target_not_in_features", "trained_steps", "seed"] as const;
const LOG_MARKERS = ["Traceback (most recent call last)", "Segmentation fault", "CUDA out of memory"] as const;

export interface SanityInput {
  result: Record<string, unknown>;
  direction?: "maximize" | "minimize";
  ceiling?: number;
  minRuntimeS: number;
  readLog: (rel: string) => string | null;
  hardConstraints: { key: string; value: string }[];
  audit: Record<string, unknown> | null;
}

/** All sanity flags for one VALID result. Empty when clean. */
export function sanityFlags(inp: SanityInput): SanityFlag[] {
  const flags: SanityFlag[] = [];
  const r = inp.result;
  const status = String(r.status ?? "");
  const isOk = status === "ok";

  // ceiling (direction-aware; ok + numeric only)
  const mv = typeof r.metric_value === "number" ? r.metric_value : null;
  if (isOk && mv !== null && inp.ceiling !== undefined) {
    const over = inp.direction === "minimize" ? mv < inp.ceiling : mv > inp.ceiling;
    if (over) flags.push({ flag: "ceiling-exceeded", detail: `metric=${mv} ceiling=${inp.ceiling}` });
  }
  // under-run
  if (isOk) {
    const rt = typeof r.runtime_s === "number" ? r.runtime_s : 0;
    if (rt < inp.minRuntimeS) flags.push({ flag: "under-run", detail: `runtime=${rt} floor=${inp.minRuntimeS}` });
  }
  // log-error corroboration
  if (isOk) {
    const logs = Array.isArray(r.log_paths) ? r.log_paths.filter((x): x is string => typeof x === "string") : [];
    let found = false;
    for (const lp of logs) {
      if (found) break;
      const txt = inp.readLog(lp);
      if (txt === null) continue;
      for (const marker of LOG_MARKERS) {
        if (txt.includes(marker)) { flags.push({ flag: "log-contradiction", detail: `marker=${marker} file=${lp}` }); found = true; break; }
      }
    }
  }
  // integrity attestation completeness (runs for all statuses)
  const integrity = (r.integrity && typeof r.integrity === "object" && !Array.isArray(r.integrity)) ? r.integrity as Record<string, unknown> : null;
  const missing = INTEGRITY_KEYS.filter((k) => integrity === null || integrity[k] === undefined || integrity[k] === null);
  if (missing.length) flags.push({ flag: "integrity-attestation-incomplete", detail: `missing=${missing.join(",")}` });
  // audit knob drift (numeric-tolerant compare; skip keys absent from audit.json)
  for (const hc of inp.hardConstraints) {
    const actual = inp.audit ? inp.audit[hc.key] : undefined;
    if (actual === undefined || actual === null) continue;
    const a = parseFloat(String(actual)), v = parseFloat(hc.value);
    const drift = (!Number.isNaN(a) && !Number.isNaN(v)) ? a !== v : String(actual) !== hc.value;
    if (drift) flags.push({ flag: "audit-knob-drift", detail: `${hc.key}=${String(actual)} vs mandated ${hc.value}` });
  }
  return flags;
}
