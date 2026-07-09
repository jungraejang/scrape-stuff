/**
 * Zillow rental listings scraper.
 *
 * Zillow's JSON API (async-create-search-page-state) is blocked by
 * PerimeterX for non-browser clients, but the search results are embedded
 * in the page HTML as a __NEXT_DATA__ JSON blob, which plain GETs can read
 * without cookies. This script fetches search pages region by region
 * (Zillow caps any single search at 20 pages, so searching per region keeps
 * each search under the cap), extracts the embedded results, keeps listings
 * newer than the cutoff (default 2 months), and upserts them into Supabase.
 *
 * Run with: npm run scrape:zillow
 * Dry run (no database writes): npm run scrape:zillow -- --dry-run
 */
import {
  BROWSER_HEADERS,
  getCutoff,
  getServiceClient,
  pruneStale,
  revalidateListings,
  sleep,
  upsertRows,
  type ListingRow,
} from "./lib";

// Region ids from the user's Zillow search (regionType 17 = city).
// 270915 = Queens, 37607 = Brooklyn, 17182 = Bronx, 27252 = Staten Island.
const REGION_IDS = [270915, 37607, 17182, 27252];

// Matches the filters in the captured search URL: for rent, 2+ beds,
// max $3,000/mo.
const FILTER_STATE = {
  fr: { value: true },
  fsba: { value: false },
  fsbo: { value: false },
  nc: { value: false },
  lsact: { value: false },
  cmsn: { value: false },
  lscmsn: { value: false },
  lszp: { value: false },
  auc: { value: false },
  fore: { value: false },
  price: { min: 0, max: 300000 },
  mp: { max: 3000 },
  beds: { min: 2 },
};

const BASE_URL = "https://www.zillow.com/new-york-ny/rentals/";
// Randomized 4-8s between pages: fast enough for a nightly run (~40 pages
// take ~4 min), slow and irregular enough to stay under Zillow's rate limit.
const PAGE_DELAY_MIN_MS = 4000;
const PAGE_DELAY_MAX_MS = 8000;
const REGION_DELAY_MS = 15_000;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = 60_000; // 1 min, doubled each retry
const MAX_PAGES_PER_REGION = 20; // Zillow's hard cap per search
const DRY_RUN = process.argv.includes("--dry-run");

function pageDelay(): number {
  return PAGE_DELAY_MIN_MS + Math.random() * (PAGE_DELAY_MAX_MS - PAGE_DELAY_MIN_MS);
}

interface ZillowUnit {
  price?: string;
  beds?: string;
}

interface ZillowResult {
  zpid?: string | number;
  lotId?: string | number;
  providerListingId?: string | null;
  isBuilding?: boolean;
  statusText?: string;
  address?: string;
  detailUrl?: string;
  imgSrc?: string;
  carouselPhotosComposable?: unknown;
  unformattedPrice?: number;
  units?: ZillowUnit[];
  beds?: number;
  baths?: number;
  area?: number;
  brokerName?: string;
  buildingName?: string;
  hdpData?: {
    homeInfo?: {
      daysOnZillow?: number;
      timeOnZillow?: number;
      homeType?: string;
    };
  };
}

interface SearchPageState {
  cat1?: {
    searchResults?: { listResults?: ZillowResult[] };
    searchList?: { totalResultCount?: number; totalPages?: number };
  };
}

function absoluteUrl(detailUrl: string | undefined): string {
  if (!detailUrl) return "https://www.zillow.com";
  return detailUrl.startsWith("http") ? detailUrl : `https://www.zillow.com${detailUrl}`;
}

function parsePrice(text: string | undefined): number | null {
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, "");
  return digits ? Number(digits) : null;
}

function extractPictures(result: ZillowResult): string[] {
  const carousel = result.carouselPhotosComposable;
  if (Array.isArray(carousel)) {
    const urls = carousel
      .map((p) => (typeof p === "string" ? p : (p as { image?: string; url?: string })?.image ?? (p as { url?: string })?.url))
      .filter((u): u is string => typeof u === "string" && u.startsWith("http"));
    if (urls.length) return urls;
  }
  return result.imgSrc ? [result.imgSrc] : [];
}

/** Listing date derived from Zillow's "time on Zillow" counters. */
function deriveWriteDt(result: ZillowResult, now: Date): string | null {
  const info = result.hdpData?.homeInfo;
  if (!info) return null;
  if (typeof info.timeOnZillow === "number") {
    return new Date(now.getTime() - info.timeOnZillow).toISOString();
  }
  if (typeof info.daysOnZillow === "number") {
    return new Date(now.getTime() - info.daysOnZillow * 86_400_000).toISOString();
  }
  return null;
}

function toRow(result: ZillowResult, now: Date, scrapedAt: string): ListingRow | null {
  if (result.isBuilding) {
    const unitPrices = (result.units ?? []).map((u) => parsePrice(u.price)).filter((p): p is number => p != null);
    const unitBeds = (result.units ?? []).map((u) => Number(u.beds)).filter((b) => !Number.isNaN(b));
    const extId = `b-${result.lotId ?? result.providerListingId ?? result.zpid ?? result.detailUrl}`;
    return {
      source: "zillow",
      ext_id: extId,
      title: result.buildingName || result.address || "Apartment building",
      address: result.address ?? null,
      price: unitPrices.length ? Math.min(...unitPrices) : null,
      category: "Building",
      beds: unitBeds.length ? Math.min(...unitBeds) : null,
      bath: null,
      size_sqft: null,
      pictures: extractPictures(result),
      agent_name: null,
      posted_by: null,
      write_dt: null,
      url: absoluteUrl(result.detailUrl),
      scraped_at: scrapedAt,
    };
  }

  if (result.zpid == null) return null;
  return {
    source: "zillow",
    ext_id: String(result.zpid),
    title: result.statusText ? `${result.statusText} - ${result.address ?? ""}`.trim() : result.address ?? null,
    address: result.address ?? null,
    price: result.unformattedPrice ?? null,
    category: result.beds != null ? `${result.beds}BR` : null,
    beds: result.beds ?? null,
    bath: result.baths ?? null,
    size_sqft: result.area ?? null,
    pictures: extractPictures(result),
    agent_name: result.brokerName ?? null,
    posted_by: null,
    write_dt: deriveWriteDt(result, now),
    url: absoluteUrl(result.detailUrl),
    scraped_at: scrapedAt,
  };
}

async function fetchSearchPage(regionId: number, page: number): Promise<SearchPageState["cat1"]> {
  const state: Record<string, unknown> = {
    isMapVisible: false,
    isListVisible: true,
    filterState: FILTER_STATE,
    regionSelection: [{ regionId, regionType: 17 }],
  };
  if (page > 1) state.pagination = { currentPage: page };

  const pagePart = page > 1 ? `${page}_p/` : "";
  const url = `${BASE_URL}${pagePart}?searchQueryState=${encodeURIComponent(JSON.stringify(state))}`;
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, accept: "text/html" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status !== 429) break;
    if (attempt >= RATE_LIMIT_RETRIES) {
      throw new Error(`HTTP 429 fetching region ${regionId} page ${page} (still rate-limited after ${RATE_LIMIT_RETRIES} backoffs)`);
    }
    const waitMs = RATE_LIMIT_BACKOFF_MS * 2 ** attempt;
    console.warn(`  Rate limited (429) on region ${regionId} page ${page}; waiting ${waitMs / 1000}s before retry ${attempt + 1}/${RATE_LIMIT_RETRIES}...`);
    await sleep(waitMs);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching region ${regionId} page ${page} (blocked by Zillow?)`);
  }
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error(`No __NEXT_DATA__ found for region ${regionId} page ${page} (likely a PerimeterX block page)`);
  }
  const data = JSON.parse(match[1]);
  const cat1: SearchPageState["cat1"] =
    data?.props?.pageProps?.searchPageState?.cat1 ??
    data?.props?.pageProps?.componentProps?.searchPageState?.cat1;
  if (!cat1?.searchResults?.listResults) {
    throw new Error(`Unexpected page structure for region ${regionId} page ${page}`);
  }
  return cat1;
}

async function main() {
  const cutoff = getCutoff();
  const now = new Date();
  const scrapedAt = now.toISOString();

  console.log(`Scraping Zillow listings newer than ${cutoff.toISOString()}`);
  if (DRY_RUN) console.log("DRY RUN: no database writes will be made.\n");

  const rowsById = new Map<string, ListingRow>();
  let skippedStale = 0;

  for (const regionId of REGION_IDS) {
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES_PER_REGION); page++) {
      const cat1 = await fetchSearchPage(regionId, page);
      totalPages = cat1?.searchList?.totalPages ?? 1;
      const results = cat1?.searchResults?.listResults ?? [];

      let kept = 0;
      for (const result of results) {
        const row = toRow(result, now, scrapedAt);
        if (!row) continue;
        // Buildings have no listing date, so they are always kept.
        if (row.write_dt && new Date(row.write_dt) < cutoff) {
          skippedStale++;
          continue;
        }
        rowsById.set(row.ext_id, row);
        kept++;
      }

      console.log(
        `Region ${regionId} page ${page}/${totalPages}: ${results.length} results, ${kept} kept (total: ${rowsById.size})`
      );
      await sleep(pageDelay());
    }
    // Extra breather between regions: each region change starts a new search.
    if (regionId !== REGION_IDS[REGION_IDS.length - 1]) await sleep(REGION_DELAY_MS);
  }

  const rows = [...rowsById.values()];
  console.log(`\n${rows.length} unique listings within cutoff (${skippedStale} skipped as older than cutoff).`);

  if (DRY_RUN) {
    console.log("Sample row:", JSON.stringify(rows[0], null, 2));
    const building = rows.find((r) => r.ext_id.startsWith("b-"));
    if (building) console.log("Sample building row:", JSON.stringify(building, null, 2));
    return;
  }

  const db = getServiceClient();
  const upserted = await upsertRows(db, rows);
  const pruned = await pruneStale(db, "zillow", cutoff);

  // Buildings have no write_dt, so prune the ones not seen in this run.
  const { count: prunedBuildings, error } = await db
    .from("listings")
    .delete({ count: "exact" })
    .eq("source", "zillow")
    .is("write_dt", null)
    .lt("scraped_at", scrapedAt);
  if (error) {
    throw new Error(`Building prune failed: ${error.message}`);
  }

  console.log(
    `Upserted ${upserted} rows, pruned ${pruned} stale rows and ${prunedBuildings ?? 0} unseen buildings. Done.`
  );
  await revalidateListings();
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
