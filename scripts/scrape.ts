/**
 * HeyKorean rental listings scraper.
 *
 * Fetches listings from the HeyKorean JSON API page by page, keeps only
 * listings newer than the cutoff (default 3 months), upserts them into
 * Supabase, and prunes stale rows from the table.
 *
 * Run with: npm run scrape
 * Dry run (no database writes): npm run scrape -- --dry-run
 *
 * Note: heykorean.com serves an incomplete TLS certificate chain, so this
 * script must run with `node --use-system-ca` (the npm script does this).
 */
import {
  BROWSER_HEADERS,
  dedupeByTitlePrice,
  getCutoff,
  getServiceClient,
  MIN_MONTHLY_PRICE,
  pruneUnseen,
  revalidateListings,
  sleep,
  upsertRows,
  type ListingRow,
} from "./lib";

const LIST_API = "https://rent.heykorean.com/api/housing/list";
const QUERY_PARAMS = {
  category_id: "100,101,102,103,104",
  price_max: "2000",
  area_code: "4480",
  tz_offset: "-240",
  item_type: "r",
};
const DETAIL_URL_PREFIX = "https://rent.heykorean.com/rent/view/";
const REQUEST_HEADERS = { ...BROWSER_HEADERS, "x-requested-with": "XMLHttpRequest" };

const MAX_PAGES = Number(process.env.SCRAPE_MAX_PAGES ?? 100);
const PAGE_DELAY_MS = 1000;
const DRY_RUN = process.argv.includes("--dry-run");

interface ApiListing {
  id: number;
  title: string;
  write_dt: string;
  category_id: number;
  category_name_en: string | null;
  bath: number | null;
  size_of_main_area: number | null;
  price: number | null;
  main_picture: string | null;
  member_mask_userid: string | null;
  agent: { first_name?: string | null; last_name?: string | null } | null;
}

interface ApiResponse {
  status: string;
  data: {
    data: ApiListing[];
    current_page: number;
    total: number;
    last_page: number;
  };
}

function parsePictures(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function toRow(listing: ApiListing, scrapedAt: string): ListingRow {
  const agentName = listing.agent
    ? [listing.agent.first_name, listing.agent.last_name].filter(Boolean).join(" ") || null
    : null;
  return {
    source: "heykorean",
    ext_id: String(listing.id),
    title: listing.title,
    address: null,
    price: listing.price,
    category: listing.category_name_en ?? `Category ${listing.category_id}`,
    beds: null,
    bath: listing.bath,
    size_sqft: listing.size_of_main_area,
    pictures: parsePictures(listing.main_picture),
    agent_name: agentName,
    posted_by: listing.member_mask_userid,
    write_dt: new Date(listing.write_dt).toISOString(),
    url: `${DETAIL_URL_PREFIX}${listing.id}`,
    scraped_at: scrapedAt,
  };
}

async function fetchPage(page: number): Promise<ApiResponse["data"]> {
  const params = new URLSearchParams({ ...QUERY_PARAMS, page: String(page) });
  const res = await fetch(`${LIST_API}?${params}`, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching page ${page}`);
  }
  const body = (await res.json()) as ApiResponse;
  if (body.status !== "success" || !Array.isArray(body.data?.data)) {
    throw new Error(`Unexpected API response shape on page ${page}`);
  }
  return body.data;
}

async function main() {
  const cutoff = getCutoff();
  const scrapedAt = new Date().toISOString();

  console.log(`Scraping HeyKorean listings newer than ${cutoff.toISOString()}`);
  if (DRY_RUN) console.log("DRY RUN: no database writes will be made.\n");

  const rowsById = new Map<string, ListingRow>();
  let pagesFetched = 0;
  let lastPage = Infinity;

  for (let page = 1; page <= Math.min(MAX_PAGES, lastPage); page++) {
    const data = await fetchPage(page);
    lastPage = data.last_page;
    pagesFetched++;

    const fresh = data.data.filter((l) => new Date(l.write_dt) >= cutoff);
    for (const listing of fresh) {
      const row = toRow(listing, scrapedAt);
      // Sub-$500 "prices" are placeholders ($1 = contact me), nightly rates
      // on short-term sublets, or non-housing rentals (storage, salon chairs).
      if (row.price != null && row.price < MIN_MONTHLY_PRICE) continue;
      rowsById.set(row.ext_id, row);
    }

    console.log(
      `Page ${page}/${data.last_page}: ${data.data.length} listings, ${fresh.length} within cutoff (total kept: ${rowsById.size})`
    );

    // Promoted posts can appear out of order, so only stop once an entire
    // page is older than the cutoff.
    if (data.data.length > 0 && fresh.length === 0) {
      console.log("Entire page is older than the cutoff; stopping pagination.");
      break;
    }
    if (data.data.length === 0) break;
    if (page < Math.min(MAX_PAGES, lastPage)) await sleep(PAGE_DELAY_MS);
  }

  const rows = dedupeByTitlePrice([...rowsById.values()]);
  console.log(
    `\nFetched ${pagesFetched} pages, ${rows.length} unique listings after repost dedup (${rowsById.size} before).`
  );

  if (DRY_RUN) {
    console.log("Sample row:", JSON.stringify(rows[0], null, 2));
    return;
  }

  const db = getServiceClient();
  const upserted = await upsertRows(db, rows);
  // Every active listing within the cutoff is seen on every run, so rows not
  // refreshed by this run are delisted, older than the cutoff, or junk.
  const pruned = await pruneUnseen(db, "heykorean", scrapedAt);
  console.log(`Upserted ${upserted} rows, pruned ${pruned} stale rows. Done.`);
  await revalidateListings();
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
