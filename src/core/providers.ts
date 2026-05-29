import { existsSync, readFileSync } from "node:fs";

/** Parse a providers-*.txt body: one provider per line; skip blank and #-comment lines; trim. */
export function parseProviderList(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Read + parse a provider-list file. Missing or unreadable → []. */
export function readProviderList(path: string): string[] {
  if (!existsSync(path)) return [];
  try { return parseProviderList(readFileSync(path, "utf8")); } catch { return []; }
}

export type RosterDecision = "skip" | "auto" | "prompt";

export interface RosterPlan {
  detected: string[];   // validated, detected (menu is built from this)
  prior: string[];      // prior selection reconciled against `detected`
  dropped: string[];    // human-readable notes for prior entries no longer present
  decision: RosterDecision;
  auto?: string;        // present only when decision === "auto"
}

/** Pure: reconcile the prior selection against the validated-detected set; compute the prompt decision. */
export function planRoster(input: { detectedValidated: string[]; prior: string[] }): RosterPlan {
  const detected = [...input.detectedValidated];
  const prior = input.prior.filter((p) => detected.includes(p));
  const dropped = input.prior.filter((p) => !detected.includes(p)).map((p) => `${p} (no longer detected)`);
  if (detected.length === 0) return { detected, prior, dropped, decision: "skip" };
  if (detected.length === 1) return { detected, prior, dropped, decision: "auto", auto: detected[0] };
  return { detected, prior, dropped, decision: "prompt" };
}

/** Render a providers-*.txt body: two header lines (timestamp + subtitle), then one provider per line. */
export function formatProviderFile(providers: string[], isoStamp: string, subtitle: string): string {
  return `# generated ${isoStamp} by /consort:soundcheck\n# ${subtitle}\n${providers.join("\n")}${providers.length ? "\n" : ""}`;
}

/** The providers-active.txt body. */
export function formatActiveFile(providers: string[], isoStamp: string): string {
  return formatProviderFile(providers, isoStamp, "active providers selected by user");
}
