/**
 * Extracts the END of a rental period from listing text, for sublets whose
 * source has no structured date range (Craigslist titles, Reddit posts).
 * Returns an ISO timestamp or null when no end date is stated
 * (open-ended/month-to-month/unknown).
 */

const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MONTH_RE_SRC =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

// A day of month must not run into more digits ("December 2026" is not day 20).
const DAY_RE_SRC = "(?:(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?)?";

// "July–Oct", "Jul 15 - Oct 1", "July through October 2026"
const RANGE_RE = new RegExp(
  `\\b${MONTH_RE_SRC}\\.?\\s*${DAY_RE_SRC},?\\s*(?:\\d{4})?\\s*(?:-|–|—|to|through|thru|until|till?)\\s*${MONTH_RE_SRC}\\.?\\s*${DAY_RE_SRC},?\\s*(\\d{4})?`,
  "i",
);

// "until October", "through Oct 15", "til end of September 2026"
const UNTIL_RE = new RegExp(
  `\\b(?:until|through|thru|till?|ends?(?:\\s+in)?|up\\s+to)\\s+(?:the\\s+)?(?:end\\s+of\\s+)?${MONTH_RE_SRC}\\.?\\s*${DAY_RE_SRC},?\\s*(\\d{4})?`,
  "i",
);

function monthIndex(name: string): number {
  return MONTH_NAMES[name.slice(0, 3).toLowerCase()];
}

/**
 * Builds the end date. Without an explicit year, picks the next occurrence
 * of that month on or after the reference date (a "July–Oct" post written in
 * July 2026 ends October 2026; "until Feb" written in July ends February
 * 2027). Without an explicit day, uses the end of the month.
 */
function buildEnd(
  month: number,
  day: number | null,
  year: number | null,
  reference: Date,
): string | null {
  let y = year ?? reference.getFullYear();
  if (year == null && month < reference.getMonth()) y += 1;
  // Sanity: reject typo'd or scraped-junk years far from the reference.
  if (Math.abs(y - reference.getFullYear()) > 2) return null;

  const date =
    day != null
      ? new Date(Date.UTC(y, month, day))
      : new Date(Date.UTC(y, month + 1, 0)); // last day of `month`
  if (day != null && (day < 1 || day > 31)) return null;
  return date.toISOString();
}

export function extractAvailableUntil(
  text: string,
  reference: Date,
): string | null {
  if (!text) return null;

  const range = text.match(RANGE_RE);
  if (range) {
    const [, startMonth, , endMonth, endDay, endYear] = range;
    const sm = monthIndex(startMonth);
    const em = monthIndex(endMonth);
    let year = endYear ? Number(endYear) : null;
    if (year == null) {
      // Anchor the start month to its occurrence closest to the reference
      // date: "June to January" posted in July already started this June,
      // while "Jan - March" posted in July starts next January. The end then
      // runs forward from the start, crossing a year boundary if needed
      // ("December–August" ends August of the following year).
      const refMonth = reference.getMonth();
      const monthsUntilStart = (sm - refMonth + 12) % 12;
      let startYear = reference.getFullYear();
      if (monthsUntilStart <= 6) {
        if (sm < refMonth) startYear += 1;
      } else if (sm > refMonth) {
        startYear -= 1;
      }
      year = em < sm ? startYear + 1 : startYear;
    }
    return buildEnd(em, endDay ? Number(endDay) : null, year, reference);
  }

  const until = text.match(UNTIL_RE);
  if (until) {
    const [, month, day, year] = until;
    return buildEnd(
      monthIndex(month),
      day ? Number(day) : null,
      year ? Number(year) : null,
      reference,
    );
  }

  return null;
}
