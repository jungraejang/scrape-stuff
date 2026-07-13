/**
 * Detects washer/dryer availability from listing text. Null means "not
 * mentioned", NOT "no laundry" — most listings simply don't say. Sources
 * with a structured signal (Craigslist's laundry search filter) set the
 * value explicitly and skip this heuristic.
 */
export type Laundry = "in_unit" | "building";

/** "washer", "washer/dryer", "washer & dryer", "w/d", "wd", "laundry" */
const MACHINE = String.raw`(?:washer(?:\s*(?:\/|&|\+|and)\s*dryer)?|w\/?d|laundry)`;

const IN_UNIT_RE = new RegExp(
  [
    // "washer/dryer in (the) unit/apartment/home", "laundry in unit"
    String.raw`\b${MACHINE}\s+in(?:side)?\s+(?:the\s+)?(?:unit|apt|apartment|home|house)\b`,
    // "in-unit washer/dryer", "in unit laundry"
    String.raw`\bin[- ]unit\s+${MACHINE}`,
    // "private washer", "own washer/dryer"
    String.raw`\b(?:private|own)\s+washer`,
    // "washer/dryer hookups" means the plumbing is in the unit
    String.raw`\bwasher(?:\s*(?:\/|&|\+|and)\s*dryer)?\s+hook-?ups?\b`,
  ].join("|"),
  "i",
);

const BUILDING_RE = new RegExp(
  [
    // "laundry in (the) building/basement", "washer/dryer in building"
    String.raw`\b${MACHINE}\s+in\s+(?:the\s+)?(?:bldg|building|basement)\b`,
    String.raw`\b${MACHINE}\s+on[- ]site\b`,
    String.raw`\bon[- ]site\s+${MACHINE}`,
    String.raw`\blaundry\s+room\b`,
  ].join("|"),
  "i",
);

/**
 * "washer/dryer" or "w/d" mentioned with no location qualifier — posts that
 * bother listing the machines almost always mean in-unit ("W/D, dishwasher,
 * elevator"). Bare "laundry" is NOT enough: "laundromat nearby" etc.
 */
const BARE_WD_RE = /\bwasher\s*(?:\/|&|\+|and)\s*dryer\b|\bw\/d\b/i;

export function detectLaundry(listing: {
  title?: string | null;
  /** Optional body text for sources that have it (e.g. Reddit selftext). */
  text?: string | null;
}): Laundry | null {
  const haystack = [listing.title, listing.text].filter(Boolean).join(" ");
  if (!haystack) return null;
  if (IN_UNIT_RE.test(haystack)) return "in_unit";
  if (BUILDING_RE.test(haystack)) return "building";
  if (BARE_WD_RE.test(haystack)) return "in_unit";
  return null;
}
