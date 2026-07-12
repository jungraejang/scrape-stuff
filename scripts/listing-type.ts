/**
 * Classifies a listing as a whole-unit rental, a room in a shared home, or a
 * sublet, from its text. Used by upsertRows for sources that mix all three
 * together (HeyKorean, Facebook, Reddit, Craigslist's apartments section);
 * scrapers that read a dedicated rooms/sublets section set the type
 * explicitly instead.
 */
export type ListingType = "apartment" | "room" | "sublet";

const ROOM_RE =
  /\broom(?:mate)?s?\b|\bprivate room\b|\bshared (?:apt|apartment|house|home)\b|\broom in\b|\bbedroom (?:available|for rent)\b/i;

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun[e]?|jul[y]?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const SUBLET_RE = new RegExp(
  [
    /\bsub-?le(?:t|ase)\b/.source,
    /\blease\s*(?:takeover|transfer|break|assignment)\b/.source,
    /\btake\s*over\s*(?:my|the|a)?\s*lease\b/.source,
    /\bshort[- ]?term\b/.source,
    /\btemporary\b/.source,
    /\bmonth[- ]to[- ]month\b/.source,
    // Explicit month ranges ("July–Oct", "Jul to September").
    `\\b(?:${MONTHS})\\s*(?:-|–|—|to|through|thru|until)\\s*(?:${MONTHS})\\b`,
  ].join("|"),
  "i",
);

export function detectListingType(listing: {
  title?: string | null;
  address?: string | null;
  category?: string | null;
  /** Optional body text for sources that have it (e.g. Reddit selftext). */
  text?: string | null;
}): ListingType {
  const haystack = [listing.title, listing.text]
    .filter(Boolean)
    .join(" ");
  // Room outranks sublet: a room offered for a few months is still browsed
  // as a room-share, not a whole-unit sublet.
  if (listing.category === "Room" || ROOM_RE.test(haystack)) return "room";
  if (SUBLET_RE.test(haystack)) return "sublet";
  return "apartment";
}
