/**
 * Listings Project NYC sublets scraper.
 *
 * listingsproject.com is a server-rendered Rails site with no bot
 * protection; the browse pages contain complete listing cards (photo,
 * price, date range, neighborhood, property type, title, URL), so this
 * scrapes the HTML directly with one request per page (~12 cards each).
 *
 * The site only shows currently active listings, so rows are pruned when
 * they stop appearing (like StreetEasy). The listing date is the sublet's
 * start date, which can be in the future ("Coming soon" on the site).
 *
 * Run with: npm run scrape:listingsproject
 * Dry run (no database writes): npm run scrape:listingsproject -- --dry-run
 */
import {
  BROWSER_HEADERS,
  getServiceClient,
  MIN_MONTHLY_PRICE,
  pruneUnseen,
  revalidateListings,
  sleep,
  upsertRows,
  type ListingRow,
} from "./lib";

const BASE_URL = "https://www.listingsproject.com/real-estate/new-york-city/sublets";
const MAX_PRICE = 3000; // align with the other scrapers' caps
const MAX_PAGES = 40; // safety stop; ~21 pages as of 2026
const PAGE_DELAY_MS = 1500;
const DRY_RUN = process.argv.includes("--dry-run");

interface Card {
  id: string;
  title: string;
  url: string;
  photo: string | null;
  priceText: string;
  dateRange: string | null;
  locationLine: string | null; // "Williamsburg, Brooklyn | Apartments for Sublet"
}

/**
 * Each card is one "flex flex-col md:flex-row" block containing the photo
 * link, price/date spans, the location|type line, and the title anchor.
 */
function parseCards(html: string): Card[] {
  const cards: Card[] = [];
  const chunks = html.split(/<div class="flex flex-col md:flex-row mb-8">/).slice(1);
  for (const chunk of chunks) {
    // Title anchor carries the canonical listing URL and (via gtag) the id.
    const titleMatch = chunk.match(
      /<a[^>]+href="(\/listings\/[^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h4>/,
    );
    if (!titleMatch) continue;
    const url = titleMatch[1];
    const title = decodeEntities(titleMatch[2].trim());

    // Prefer the numeric gtag item_id; fall back to the UUID in the slug.
    const id =
      chunk.match(/item_id:&#39;(\d+)&#39;/)?.[1] ??
      url.match(/([0-9a-f]{8}-[0-9a-f-]{27,})$/)?.[1] ??
      url;

    const priceMatch = chunk.match(/>\s*(\$[\d,]+(?:\/\w+)?)\s*<\/span>/);
    if (!priceMatch) continue;

    cards.push({
      id,
      title,
      url: `https://www.listingsproject.com${url}`,
      photo: chunk.match(/<img[^>]+src="([^"]+listing_photos[^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? null,
      priceText: priceMatch[1],
      dateRange:
        chunk.match(/>\s*(\w+ \d{1,2}, \d{4})\s*(?:-|–)\s*\w+ \d{1,2}, \d{4}\s*</)?.[1] ?? null,
      locationLine:
        chunk
          .match(/class="text-grey-dark mb-2 text-smish"[^>]*>\s*([^<]+?)\s*<\/div>/)?.[1]
          ?.trim() ?? null,
    });
  }
  return cards;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Monthly price, or null for daily/weekly rates and totals we can't compare. */
function monthlyPrice(priceText: string): number | null {
  if (/\/(day|week|night)/i.test(priceText)) return null;
  const value = Number(priceText.replace(/[^0-9]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function toRow(card: Card, scrapedAt: string): ListingRow | null {
  const price = monthlyPrice(card.priceText);
  if (price == null || price < MIN_MONTHLY_PRICE || price > MAX_PRICE) return null;

  const [location, propertyType] = (card.locationLine ?? "").split("|").map((s) => s.trim());
  const isRoom = /room/i.test(propertyType ?? "");

  return {
    source: "listingsproject",
    ext_id: card.id,
    title: card.title,
    address: location || null,
    price,
    category: isRoom ? "Room" : null,
    listing_type: isRoom ? "room" : "sublet",
    beds: null,
    bath: null,
    size_sqft: null,
    pictures: card.photo ? [card.photo] : [],
    agent_name: null,
    posted_by: null,
    // The sublet's start date; can be in the future ("Coming soon").
    write_dt: card.dateRange ? new Date(card.dateRange).toISOString() : null,
    url: card.url,
    scraped_at: scrapedAt,
  };
}

async function fetchPage(page: number): Promise<string> {
  const url = page === 1 ? BASE_URL : `${BASE_URL}?page=${page}`;
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching page ${page}`);
  return res.text();
}

async function main() {
  const scrapedAt = new Date().toISOString();
  console.log("Scraping Listings Project NYC sublets (max $3,000/mo)");
  if (DRY_RUN) console.log("DRY RUN: no database writes will be made.\n");

  const rowsById = new Map<string, ListingRow>();
  const seenIds = new Set<string>();
  let seen = 0;
  let skipped = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const cards = parseCards(await fetchPage(page));
    // Pages past the end still render the featured cards; stop as soon as a
    // page contributes nothing new.
    const newCards = cards.filter((c) => !seenIds.has(c.id));
    if (newCards.length === 0) break;
    seen += newCards.length;

    for (const card of newCards) {
      seenIds.add(card.id);
      const row = toRow(card, scrapedAt);
      if (!row) {
        skipped++;
        continue;
      }
      rowsById.set(row.ext_id, row);
    }
    console.log(`Page ${page}: ${newCards.length} new cards (${rowsById.size} kept so far)`);
    await sleep(PAGE_DELAY_MS);
  }

  const rows = [...rowsById.values()];
  console.log(
    `\n${seen} cards seen, ${rows.length} kept (${skipped} skipped: over $${MAX_PRICE.toLocaleString()}, daily/weekly rates).`,
  );

  if (DRY_RUN) {
    console.log("Sample row:", JSON.stringify(rows[0], null, 2));
    return;
  }

  const db = getServiceClient();
  const upserted = await upsertRows(db, rows);
  // The site only shows active listings, so unseen rows are gone/expired.
  const pruned = await pruneUnseen(db, "listingsproject", scrapedAt);
  console.log(`Upserted ${upserted} rows, pruned ${pruned} unseen rows. Done.`);
  await revalidateListings();
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
