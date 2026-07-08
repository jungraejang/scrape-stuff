/**
 * Reddit r/NYCapartments scraper (RSS, no API key).
 *
 * Reddit's JSON endpoints return 403 for scripts, but the Atom feeds are
 * open with a plain user-agent. The feed returns up to 100 recent posts,
 * which comfortably covers the subreddit's daily volume, so a nightly run
 * accumulates listings over time.
 *
 * Posts are unstructured text: actual listings are mixed with advice and
 * roommate-search threads. Only posts with an extractable dollar price are
 * kept (the signature of a real listing). Since the feed only shows recent
 * posts, rows are pruned by age (prune-stale.ts), not by absence.
 *
 * Run with: npm run scrape:reddit
 * Dry run (no database writes): npm run scrape:reddit -- --dry-run
 */
import { detectBorough } from "./borough";
import {
  getCutoff,
  getServiceClient,
  MIN_MONTHLY_PRICE,
  pruneStale,
  revalidateListings,
  sleep,
  upsertRows,
  type ListingRow,
} from "./lib";

const FEED_URLS = [
  "https://www.reddit.com/r/NYCapartments/new/.rss?limit=100",
];
const USER_AGENT = "nyc-rental-aggregator/1.0 (personal aggregator)";
const MAX_PRICE = 20_000;
const DRY_RUN = process.argv.includes("--dry-run");

interface FeedEntry {
  id: string;
  title: string;
  link: string;
  published: string;
  author: string | null;
  text: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#32;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripHtml(s: string): string {
  return decodeEntities(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(entry: string, name: string): string | null {
  const m = entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : null;
}

function parseFeed(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1];
    const id = tag(entry, "id");
    const title = tag(entry, "title");
    const published = tag(entry, "published");
    const link = entry.match(/<link href="([^"]+)"/)?.[1];
    if (!id || !title || !published || !link) continue;
    entries.push({
      id,
      title: decodeEntities(title),
      link,
      published,
      author: tag(entry, "name")?.replace(/^\/u\//, "") ?? null,
      // The content block is HTML-escaped HTML; flatten to plain text so
      // price/borough regexes can see through markup.
      text: stripHtml(tag(entry, "content") ?? ""),
    });
  }
  return entries;
}

/**
 * Monthly rent from text. Requires an explicit $ amount; bare numbers are
 * too ambiguous (street numbers, square feet, dates).
 */
function priceFrom(text: string): number | null {
  for (const m of text.matchAll(/\$\s*([\d][\d.,]*)(\s*k)?/gi)) {
    let value = Number(m[1].replace(/,/g, ""));
    if (m[2]) value *= 1000;
    value = Math.round(value);
    if (value >= MIN_MONTHLY_PRICE && value <= MAX_PRICE) return value;
  }
  return null;
}

/**
 * Classifies a post as a listing (returning its price) or not (null).
 * A price in the title is the signature of a real listing. A price only in
 * the body is weaker (scam discussions and advice threads quote rents too),
 * so it additionally needs listing context: a unit type or a location.
 */
function extractPrice(entry: FeedEntry): number | null {
  const titlePrice = priceFrom(entry.title);
  if (titlePrice != null) return titlePrice;

  const bodyPrice = priceFrom(entry.text);
  if (bodyPrice == null) return null;
  const hasContext =
    extractCategory(entry) != null ||
    detectBorough({ title: entry.title, address: entry.text }) != null;
  return hasContext ? bodyPrice : null;
}

function extractCategory(entry: FeedEntry): string | null {
  const text = `${entry.title} ${entry.text}`;
  if (/\bstudio\b/i.test(text)) return "Studio";
  // (?<![\d.]) keeps "1.5 bedroom" from reading as "5BR".
  const beds = text.match(/(?<![\d.])(\d)\s*(?:br|bd|bed(?:room)?s?)\b/i);
  if (beds) return `${beds[1]}BR`;
  if (/\broom(?:mate)?s?\b/i.test(text)) return "Room";
  return null;
}

/** Posts by people searching for housing rather than offering it. */
function isSeekerPost(entry: FeedEntry): boolean {
  return /\b(?:looking for|looking to|searching|in search of|iso|apartment hunt(?:ing)?|any takers|seeking|wanted|need a|recommendations?)\b/i.test(
    entry.title,
  );
}

function toRow(entry: FeedEntry, price: number, scrapedAt: string): ListingRow {
  const category = extractCategory(entry);
  return {
    source: "reddit",
    ext_id: entry.id, // e.g. "t3_1ur2238"
    title: entry.title,
    address: null,
    price,
    category,
    beds: category?.endsWith("BR") ? Number(category[0]) : null,
    bath: null,
    size_sqft: null,
    pictures: [],
    agent_name: null,
    posted_by: entry.author,
    write_dt: new Date(entry.published).toISOString(),
    url: entry.link,
    scraped_at: scrapedAt,
  };
}

async function main() {
  const cutoff = getCutoff();
  const scrapedAt = new Date().toISOString();
  console.log("Scraping r/NYCapartments via RSS");
  if (DRY_RUN) console.log("DRY RUN: no database writes will be made.\n");

  const rowsById = new Map<string, ListingRow>();
  let seen = 0;
  let skippedNotListing = 0;

  for (const url of FEED_URLS) {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status !== 429) break;
      if (attempt >= 3) throw new Error(`HTTP 429 fetching ${url} (still rate-limited after 3 backoffs)`);
      const waitMs = 30_000 * 2 ** attempt;
      console.warn(`  Rate limited (429); waiting ${waitMs / 1000}s before retry ${attempt + 1}/3...`);
      await sleep(waitMs);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching feed ${url}`);
    }
    const entries = parseFeed(await res.text());
    seen += entries.length;

    for (const entry of entries) {
      if (new Date(entry.published) < cutoff) continue;
      if (isSeekerPost(entry)) {
        skippedNotListing++;
        continue;
      }
      const price = extractPrice(entry);
      if (price == null) {
        skippedNotListing++;
        continue; // advice threads, no-price posts
      }
      rowsById.set(entry.id, toRow(entry, price, scrapedAt));
    }
  }

  const rows = [...rowsById.values()];
  console.log(
    `${seen} posts in feed, ${rows.length} kept as listings (${skippedNotListing} skipped: seekers, advice, no price).`
  );

  if (DRY_RUN) {
    console.log("Sample row:", JSON.stringify(rows[0], null, 2));
    return;
  }

  const db = getServiceClient();
  const upserted = await upsertRows(db, rows);
  // The feed only shows recent posts, so absence doesn't mean delisted;
  // old rows age out by write_dt instead.
  const pruned = await pruneStale(db, "reddit", cutoff);
  console.log(`Upserted ${upserted} rows, pruned ${pruned} stale rows. Done.`);
  await revalidateListings();
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
