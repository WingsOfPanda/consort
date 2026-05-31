// src/core/scoreSkill.ts — topic→skill classification + per-prompt skill-hint append.
// Behavioral port of the consult skill-classify / skill-hint-append helpers (lib/consult.sh).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BRAINSTORMING = ["design patterns?", "how should", "best way", "what s the best way", "what is the best way", "decide between"];
const DEBUGGING = ["why", "broken", "failing", "regressions?", "edge cases?", "bugs?", "doesn t work", "does not work"];

function fence(topic: string): string {
  return " " + topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}
function matchAny(fenced: string, triggers: string[]): boolean {
  return triggers.some((t) => new RegExp(" " + t + " ").test(fenced)); // triggers are controlled literals; `?` = optional plural
}
/** brainstorming | systematic-debugging | none. brainstorming wins ties (tested first). */
export function classifyTopic(topic: string): "brainstorming" | "systematic-debugging" | "none" {
  const f = fence(topic);
  if (matchAny(f, BRAINSTORMING)) return "brainstorming";
  if (matchAny(f, DEBUGGING)) return "systematic-debugging";
  return "none";
}

function pluginRoot(): string { return process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd(); }
/** Append config/skill-hints/<skill>.md to basePrompt. Base unchanged when none/missing/override. */
export function skillHintAppend(skillTxtPath: string, basePrompt: string): string {
  let skill = "none";
  if (existsSync(skillTxtPath)) skill = readFileSync(skillTxtPath, "utf8").replace(/\s/g, "");
  if (process.env.CONSORT_SCORE_SKILL_OVERRIDE === "none") skill = "none";
  if (skill !== "brainstorming" && skill !== "systematic-debugging") return basePrompt;
  const hintFile = join(pluginRoot(), "config", "skill-hints", `${skill}.md`);
  if (!existsSync(hintFile)) return basePrompt;
  return `${basePrompt}\n\n---\n\n${readFileSync(hintFile, "utf8")}`;
}
