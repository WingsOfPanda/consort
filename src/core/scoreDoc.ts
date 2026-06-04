// src/core/scoreDoc.ts
export const SECTIONS_SINGLE = ["problem", "goal", "architecture", "components", "testing", "success-criteria"] as const;

const TITLES: Record<string, string> = {
  problem: "Problem", goal: "Goal", architecture: "Architecture", components: "Components",
  testing: "Testing", "success-criteria": "Success Criteria",
};
export function sectionTitle(key: string): string { return TITLES[key] ?? key; }

export interface AssembleInput { title: string; drafts: Map<string, string>; }

/** Port of bin/consult-walk-assemble.sh's concat, single-repo only: header-less H1 + 6 sections
 *  (perform infers a lone target from cwd). */
export function assembleDoc(input: AssembleInput): string {
  let out = `# ${input.title}\n\n`;
  for (const key of SECTIONS_SINGLE) {
    const draft = input.drafts.get(key);
    if (draft != null) out += `${draft}\n`;
    else out += `## ${sectionTitle(key)}\n\n_(missing draft)_\n\n`;
  }
  return out;
}

const SEED_SPECS: { section: string; heading: string; comment: string; match: (l: string) => boolean }[] = [
  { section: "problem", heading: "## Problem", comment: "<!-- seed: cross-verified facts about the current state -->",
    match: (l) => /^- \[/.test(l) },
  { section: "goal", heading: "## Goal", comment: "<!-- seed: claims tagged [Goal] -->",
    match: (l) => /^- \[Goal/i.test(l) },
  { section: "architecture", heading: "## Architecture", comment: "<!-- seed: claims tagged [Architecture] -->",
    match: (l) => /^- \[Architecture/i.test(l) },
  { section: "components", heading: "## Components", comment: "<!-- seed: claims tagged [Components] -->",
    match: (l) => /^- \[Components/i.test(l) },
  { section: "testing", heading: "## Testing", comment: "<!-- seed: claims tagged [Testing] or containing \"test\" -->",
    match: (l) => /^- \[Testing/i.test(l) || /^- .*\btest/i.test(l) },
  { section: "success-criteria", heading: "## Success Criteria", comment: "<!-- seed: claims tagged [Success Criteria] -->",
    match: (l) => /^- \[Success/i.test(l) },
];
const SEED_PLACEHOLDER = "_(no seed content matched; Maestro drafts from scratch in the design walk)_";

/** Port of bin/consult-synthesize.sh — 6 single-repo seed drafts from adjudicated.md content.
 *  Each: heading + blank + seed comment + matched claim lines (placeholder if none matched). */
export function synthesizeSeeds(adjText: string): { section: string; body: string }[] {
  const lines = adjText.split("\n");
  return SEED_SPECS.map((spec) => {
    const matched = lines.filter(spec.match);
    const body = `${spec.heading}\n\n${spec.comment}\n` +
      (matched.length ? matched.join("\n") + "\n" : SEED_PLACEHOLDER + "\n");
    return { section: spec.section, body };
  });
}
