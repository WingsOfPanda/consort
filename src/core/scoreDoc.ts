// src/core/scoreDoc.ts
export const SECTIONS_SINGLE = ["problem", "goal", "architecture", "components", "testing", "success-criteria"] as const;
export const SECTIONS_MULTI = ["problem", "goal", "architecture", "components", "execution-dag", "cross-repo-notes", "testing", "success-criteria"] as const;

const TITLES: Record<string, string> = {
  problem: "Problem", goal: "Goal", architecture: "Architecture", components: "Components",
  "execution-dag": "Execution DAG", "cross-repo-notes": "Cross-Repo Notes",
  testing: "Testing", "success-criteria": "Success Criteria",
};
export function sectionTitle(key: string): string { return TITLES[key] ?? key; }

export type DocMode = "single" | "single-sub" | "multi";
export interface AssembleInput { title: string; mode: DocMode; date: string; targets: string[]; drafts: Map<string, string>; }

/** Port of bin/consult-walk-assemble.sh's concat. v0.17 header = H1 + (multi/single-sub) Date + Target. */
export function assembleDoc(input: AssembleInput): string {
  const sections = input.mode === "multi" ? SECTIONS_MULTI : SECTIONS_SINGLE;
  let out = `# ${input.title}\n\n`;
  if (input.mode === "multi") {
    out += `**Date:** ${input.date}\n`;
    out += `**Target Sub-Project(s):** ${input.targets.join(", ")}\n\n`;
  } else if (input.mode === "single-sub") {
    out += `**Date:** ${input.date}\n`;
    out += `**Target Sub-Project:** ${input.targets[0] ?? ""}\n\n`;
  }
  for (const key of sections) {
    const draft = input.drafts.get(key);
    if (draft != null) out += `${draft}\n`;
    else out += `## ${sectionTitle(key)}\n\n_(missing draft)_\n\n`;
  }
  return out;
}
