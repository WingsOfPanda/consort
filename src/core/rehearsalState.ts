// Per-part state.txt + halt.flag parsing for /consort:rehearsal. Faithful to
// deep-research.sh (state read/write/reconcile, halt_flag_read). Pure;
// disk reads/writes happen in the CLI (Phases C/D). JSON.parse, not shell.

/** Parse state.txt KV (first '=' splits; literal \n unescaped back to newlines). */
export function parseState(text: string): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    kv[line.slice(0, eq)] = line.slice(eq + 1).replace(/\\n/g, "\n");
  }
  return kv;
}

/** Render KV to state.txt text (newlines escaped to literal \n; one record per line). */
export function renderState(kv: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(kv)) {
    if (!k) continue;
    lines.push(`${k}=${v.replace(/\n/g, "\\n")}`);
  }
  return lines.join("\n") + "\n";
}

/** Merge updates over existing state (or fresh when null), overwriting touched keys. */
export function mergeState(existing: string | null, updates: Record<string, string>): string {
  const kv = existing ? parseState(existing) : {};
  for (const [k, v] of Object.entries(updates)) if (k) kv[k] = v;
  return renderState(kv);
}

/** Replay an outbox tail to a terminal phase: error wins -> "failed"; a done with the
 *  result.json present -> "idle"; otherwise null (no write). */
export function reconcileFromOutbox(outboxTail: string, doneResultExists: boolean): "failed" | "idle" | null {
  let sawDone = false, sawError = false;
  for (const line of outboxTail.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as { event?: string };
      if (o.event === "done") sawDone = true;
      else if (o.event === "error") sawError = true;
    } catch { /* skip non-JSON */ }
  }
  if (sawError) return "failed";
  if (sawDone) return doneResultExists ? "idle" : null;
  return null;
}

export interface HaltFlag {
  format: "structured" | "prose" | "missing";
  fields?: Record<string, string>;
  reason?: string;
}

/** Parse halt.flag: structured (first non-blank line halted_by=), prose, or missing. */
export function readHaltFlag(body: string | null): HaltFlag {
  if (body === null || body.trim() === "") return { format: "missing" };
  const firstLine = body.split("\n").find((l) => l.trim() !== "") ?? "";
  if (firstLine.startsWith("halted_by=")) {
    const fields: Record<string, string> = {};
    for (const line of body.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) fields[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return { format: "structured", fields };
  }
  return { format: "prose", reason: body.split("\n").join(" ").replace(/\s+$/, "") };
}
