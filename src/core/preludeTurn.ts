// src/core/preludeTurn.ts — research + adversary prompt builders for /consort:prelude
// (port of config/prompt-templates/meditate/{research,adversary}.md, rebranded). These bodies do
// NOT carry their own done-event line or END_OF_INSTRUCTION: prelude sends them via `send` →
// `inboxWrite`, which appends exactly one done instruction + one END_OF_INSTRUCTION (same contract
// as score's composeResearchPrompt/composeVerifyPrompt). Embedding a second here produced a
// duplicate END_OF_INSTRUCTION in the inbox, which desynced codex parts' terminal `done` event.

/** The {{LIT_GUIDANCE}} block for the research prompt, keyed on the lit-track classification. */
export function litGuidance(track: "ON" | "OFF"): string {
  return track === "ON"
    ? "The topic is academic / SOTA-shaped. Prioritize peer-reviewed papers (arXiv, conference " +
      "proceedings) over blog posts or vendor docs. List 3+ recent papers, projects, or benchmarks " +
      "with citations including authors, year, venue, URL/DOI where available."
    : "The topic is not academic-shaped. Brief SOTA-evidence section is fine — list 1-2 anchor " +
      "sources or write 'Not applicable' with a one-line reason.";
}

/** Research-phase prompt (port of meditate/research.md). Expose the landscape; do NOT recommend. */
export function composePreludeResearchPrompt(topic: string, writeTo: string, lit: string): string {
  const t = topic.trim();
  return [
    "Investigate the following topic from multiple angles. Your job is not to",
    "recommend; your job is to expose the landscape — approaches, tradeoffs,",
    "SOTA evidence, and open questions.",
    "",
    `Topic: ${t}`,
    "",
    `Output requirements — write to ${writeTo} with this EXACT structure:`,
    "",
    `  # Findings: ${t}`,
    "",
    "  ## Summary",
    "  <2-3 sentence overview, free-form prose>",
    "",
    "  ## Approaches",
    "  1. [<citation>] <approach name> — <one-line description>",
    "  2. [<citation>] <approach name> — <one-line description>",
    "  ...",
    "",
    "  ## SOTA evidence",
    `  ${lit}`,
    "",
    "  ## Tradeoffs",
    "  - <approach A> wins on <criterion> because <reason with citation>",
    "  - <approach A> loses on <criterion> because <reason with citation>",
    "  ...",
    "",
    "  ## Independent Discovery",
    "  Files / URLs / papers you opened during research that go beyond what the",
    "  Maestro's identity prompt suggested. Cite at least 3 sources you found on",
    "  your own — this is an anti-correlated-blind-spots guard.",
    "",
    "  ## Open questions",
    "  - <question 1 that the research could not resolve>",
    "  - <question 2>",
    "",
    "  ## Notes",
    "  <any free-form additions; not parsed by the Maestro>",
    "",
    "Citation format options:",
    "  - <file path>:<line>          e.g. src/auth/store.py:42",
    "  - <file path>:<line-range>    e.g. src/auth/refresh.py:15-30",
    "  - <URL>                       e.g. https://arxiv.org/abs/2401.04088",
    "  - paper:<id>                  e.g. paper:arxiv:2401.04088",
    "  - runtime: <command>          e.g. runtime: pytest tests/test_x.py",
    "",
    "Every Approach AND every Tradeoff bullet MUST have a citation in [brackets].",
    "Bullets without citations will be silently dropped by the Maestro's synthesis —",
    "and if NO approach has a citation, your findings will be flagged as malformed.",
    "",
    "Research methods: use any tool available in your environment. When local",
    "evidence is insufficient or the topic references external knowledge (papers,",
    "RFCs, library docs, vendor APIs, benchmarks), you SHOULD use WebSearch /",
    "WebFetch (or the equivalent in your TUI) to find authoritative sources. Prefer",
    "primary sources over blog posts. If a tool is not available, fall back to",
    "local-only investigation and note the gap as an [unverified] claim.",
    "",
    "Important: this is NOT a recommendation phase. Do not pick a \"best\" approach.",
    "Surface the landscape; the Maestro will synthesize the tradeoff matrix and a",
    "separate adversary round will challenge the synthesis before the final landscape",
    "doc is written.",
  ].join("\n");
}

/** Adversary-phase prompt (port of meditate/adversary.md). Inlines the draft to challenge. */
export function composeAdversaryPrompt(landscapeDraft: string, instrument: string, outPath: string): string {
  return [
    "You are now playing adversary against a synthesized landscape doc that",
    "was built from your earlier research findings (and the findings of your",
    "fellow parts). Your job is to break confidence in the synthesis — not",
    "to validate it.",
    "",
    "Default to skepticism. Assume the synthesis can fail in subtle, high-cost,",
    "or hard-to-detect ways until evidence says otherwise. Do not give credit",
    "for good intent or partial coverage.",
    "",
    "The synthesis to challenge:",
    "",
    landscapeDraft,
    "",
    "Attack surface — prioritize these failure modes:",
    "- Approaches that were missed or wrongly excluded from the landscape",
    "- Tradeoff matrix rows where the \"Best fit\" assignment is wrong or weakly justified",
    "- Citations that don't actually support the claim attached to them",
    "  (open the cited file/URL and verify the claim is grounded)",
    "- Convergent findings across parts that may share a correlated blind spot",
    "  (e.g., all read the same paper, all missed the same recent development)",
    "- Frames the synthesis adopted that exclude valid alternative frames",
    "  (e.g., assumed online inference when batch is also valid)",
    "- Open questions that should have been answered but were filed instead",
    "- SOTA claims that are stale (paper from 3+ years ago marked \"current SOTA\")",
    "",
    `Output requirements — write to ${outPath}:`,
    "",
    `  # Adversary critique: ${instrument}'s pass`,
    "",
    "  ## Verdict",
    "  <one line: needs-attention | minor-revisions | accept>",
    "",
    "  ## Material findings",
    "  Each finding answers:",
    "  1. What is the weakness in the synthesis?",
    "  2. Why is that synthesis claim vulnerable?",
    "  3. What concrete change to the landscape doc would reduce the risk?",
    "",
    "  ### Finding 1: <one-line summary>",
    "  - **Targets:** <which section/row/citation in the draft>",
    "  - **Why vulnerable:** <evidence the claim is shaky, with new citation>",
    "  - **Concrete fix:** <what to change in the landscape doc>",
    "",
    "  ### Finding 2: ...",
    "",
    "  ## Notes",
    "  <optional free-form additions>",
    "",
    "Calibration rules:",
    "- Prefer one strong finding over several weak ones",
    "- Do not dilute serious issues with stylistic nits",
    "- If the synthesis looks defensible, say so directly and return zero findings",
    "  (verdict: accept). Padding with weak adversarial reaches is worse than admitting",
    "  the draft is sound.",
    "- Be aggressive but stay grounded — every finding must be defensible from the",
    "  cited evidence, not speculative",
  ].join("\n");
}
