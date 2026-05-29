// Morandi 256-color palette (values verbatim from clone-wars lib/colors.sh),
// re-keyed to instruments grouped by orchestral section for harmony.
type Section = "strings" | "woodwinds" | "brass" | "percussion" | "keys" | "early" | "tutti";

interface Entry { section: Section; primary: string; secondary: string; }

const PALETTE: Record<string, Entry> = {
  // strings — cool dusty blues/slate
  violin:     { section: "strings", primary: "colour110", secondary: "colour187" },
  viola:      { section: "strings", primary: "colour109", secondary: "colour187" },
  cello:      { section: "strings", primary: "colour67",  secondary: "colour187" },
  contrabass: { section: "strings", primary: "colour60",  secondary: "colour250" },
  harp:       { section: "strings", primary: "colour103", secondary: "colour187" },
  // woodwinds — sage/olive earth tones
  flute:      { section: "woodwinds", primary: "colour108", secondary: "colour144" },
  piccolo:    { section: "woodwinds", primary: "colour144", secondary: "colour247" },
  oboe:       { section: "woodwinds", primary: "colour100", secondary: "colour137" },
  clarinet:   { section: "woodwinds", primary: "colour101", secondary: "colour241" },
  bassoon:    { section: "woodwinds", primary: "colour95",  secondary: "colour241" },
  recorder:   { section: "woodwinds", primary: "colour152", secondary: "colour187" },
  // brass — terracotta/warm
  horn:       { section: "brass", primary: "colour137", secondary: "colour187" },
  trumpet:    { section: "brass", primary: "colour173", secondary: "colour144" },
  trombone:   { section: "brass", primary: "colour180", secondary: "colour247" },
  tuba:       { section: "brass", primary: "colour131", secondary: "colour110" },
  cornet:     { section: "brass", primary: "colour223", secondary: "colour174" },
  // percussion — neutral greys
  timpani:    { section: "percussion", primary: "colour102", secondary: "colour247" },
  celesta:    { section: "percussion", primary: "colour245", secondary: "colour187" },
  vibraphone: { section: "percussion", primary: "colour243", secondary: "colour250" },
  marimba:    { section: "percussion", primary: "colour96",  secondary: "colour250" },
  xylophone:  { section: "percussion", primary: "colour250", secondary: "colour241" },
  glockenspiel: { section: "percussion", primary: "colour247", secondary: "colour250" },
  // keys — cream/beige
  piano:      { section: "keys", primary: "colour187", secondary: "colour250" },
  organ:      { section: "keys", primary: "colour181", secondary: "colour250" },
  harpsichord: { section: "keys", primary: "colour146", secondary: "colour250" },
  // early — mauve/plum
  lute:       { section: "early", primary: "colour139", secondary: "colour241" },
  theorbo:    { section: "early", primary: "colour97",  secondary: "colour187" },
  viol:       { section: "early", primary: "colour132", secondary: "colour137" },
  sackbut:    { section: "early", primary: "colour138", secondary: "colour241" },
  shawm:      { section: "early", primary: "colour174", secondary: "colour250" },
  crumhorn:   { section: "early", primary: "colour182", secondary: "colour250" },
  cittern:    { section: "early", primary: "colour218", secondary: "colour250" },
};

const FALLBACK: Entry = { section: "tutti", primary: "white", secondary: "default" };
function entry(instrument: string): Entry { return PALETTE[instrument.toLowerCase()] ?? FALLBACK; }

export function sectionFor(instrument: string): Section { return entry(instrument).section; }
export function colorFor(instrument: string): string { return entry(instrument).primary; }

export function labelFor(instrument: string, model: string, topic: string): string {
  return `${sectionFor(instrument)}-${instrument}:${model}:${topic}`;
}

export function labelFmt(instrument: string, model: string, topic: string): string {
  const e = entry(instrument);
  return `#[fg=${e.primary},bold]${e.section}-${instrument}#[default]:#[fg=${e.secondary},bold]${model}#[default]:${topic}`;
}

export function ansiFromColor(color: string): string {
  const m = /^colour([0-9]+)$/.exec(color);
  if (m) return `\x1b[38;5;${m[1]}m`;
  if (/^[0-9]+$/.test(color)) return `\x1b[38;5;${color}m`;
  return "";
}

const RULE = "━".repeat(43);
export function renderBannerHead(label: string, color: string): string {
  const c = ansiFromColor(color), r = "\x1b[0m", b = "\x1b[1m";
  return [
    "",
    `  ${c}${RULE}${r}`,
    `  ${b}${c}${label || "part"}${r}`,
    `  ${c}FINE — pane closing${r}`,
    `  ${c}${RULE}${r}`,
    "",
  ].join("\n");
}
