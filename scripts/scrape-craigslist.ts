/**
 * Craigslist rental listings scraper.
 *
 * Craigslist's search API (sapi.craigslist.org) accepts cookie-less GET
 * requests. It returns a compact encoded format: each item is a sparse
 * array where numbers at fixed positions hold offsets (posting id, posted
 * date) relative to `decode.minPostingId` / `decode.minPostedDate`, and
 * tagged sub-arrays hold images ([4, ...keys]), the URL slug ([6, slug]),
 * and the URL token ([13, token]).
 *
 * A single search returns at most 360 items, so the scrape runs one search
 * per price band and merges the results.
 *
 * Craigslist posts expire after ~30-45 days, so everything returned is
 * within the 3-month cutoff. Rows not seen in the latest run are pruned
 * (post expired or deleted).
 *
 * Run with: npm run scrape:craigslist
 * Dry run (no database writes): npm run scrape:craigslist -- --dry-run
 */
import {
  BROWSER_HEADERS,
  dedupeByTitlePrice,
  getCutoff,
  getServiceClient,
  MIN_MONTHLY_PRICE,
  pruneUnseen,
  recoverPriceFromTitle,
  revalidateListings,
  sleep,
  upsertRows,
  type ListingRow,
} from "./lib";
import type { ListingType } from "./listing-type";

const API_BASE = "https://sapi.craigslist.org/web/v8/postings/search/full";
// batch format: {areaId}-{?}-{maxResults}-{?}-{?}; area 3 = the New York area
const BATCH = "3-0-360-0-0";
const MAX_RESULTS_PER_SEARCH = 360;
const MAX_PRICE = 3000; // matches the search filter; scam posts sneak above it
const PAGE_DELAY_MS = 1000;
const DRY_RUN = process.argv.includes("--dry-run");

interface Section {
  cat: string;
  label: string;
  /** null = derive from text (apartments hide sublets among them). */
  listingType: ListingType | null;
  /**
   * One search per price band to stay under the 360-results-per-search cap.
   * Bands narrow where inventory is denser.
   */
  priceBands: Array<[number, number]>;
}

const SECTIONS: Section[] = [
  {
    cat: "apa", // apartments / housing for rent
    label: "apartments",
    listingType: null,
    priceBands: [
      [0, 1200],
      [1201, 1600],
      [1601, 1900],
      [1901, 2100],
      [2101, 2300],
      [2301, 2450],
      [2451, 2600],
      [2601, 2750],
      [2751, 2850],
      [2851, 2950],
      [2951, 2999],
      [3000, 3000],
    ],
  },
  {
    cat: "roo", // rooms & shares
    label: "rooms",
    listingType: "room",
    priceBands: [
      [0, 700],
      [701, 900],
      [901, 1050],
      [1051, 1200],
      [1201, 1500],
      [1501, 3000],
    ],
  },
  {
    cat: "sub", // sublets & temporary
    label: "sublets",
    listingType: "sublet",
    priceBands: [
      [0, 1500],
      [1501, 2200],
      [2201, 3000],
    ],
  },
];

type Item = Array<number | string | Array<number | string>>;

interface SapiData {
  items: Item[];
  totalResultCount: number;
  decode: {
    minPostingId: number;
    minPostedDate: number;
    locationDescriptions: Array<string | number>;
  };
}

function tagged(item: Item, tag: number): Array<number | string> | undefined {
  return item.find((e): e is Array<number | string> => Array.isArray(e) && e[0] === tag);
}

function decodeItem(
  item: Item,
  decode: SapiData["decode"],
  section: Section,
  scrapedAt: string,
): ListingRow | null {
  const idOffset = item[0];
  const dateOffset = item[1];
  const price = item[3];
  if (typeof idOffset !== "number" || typeof dateOffset !== "number") return null;

  const id = decode.minPostingId + idOffset;
  const postedAt = new Date((decode.minPostedDate + dateOffset) * 1000);

  // Location string looks like "1:5~40.73~-73.70" (sometimes with extra
  // colon components, e.g. "2:5:1~..."); the number after the first ":" is
  // an index into decode.locationDescriptions.
  let neighborhood: string | null = null;
  const locString = item.find(
    (e): e is string => typeof e === "string" && /^\d+(?::\d+)+~/.test(e)
  );
  if (locString) {
    const idx = Number(locString.split("~")[0].split(":")[1]);
    const desc = decode.locationDescriptions[idx];
    if (typeof desc === "string") neighborhood = desc;
  }

  // Besides the location string, items contain a short hash string and the
  // title at the top level; the title is always the longest of them.
  const title =
    item
      .filter((e): e is string => typeof e === "string" && e !== locString)
      .sort((a, b) => b.length - a.length)[0] ?? `Craigslist ${id}`;

  const imageKeys = (tagged(item, 4) ?? []).slice(1) as string[];
  const pictures = imageKeys
    .map((k) => k.replace(/^\d+:/, ""))
    .map((k) => `https://images.craigslist.org/${k}_600x450.jpg`);

  const slug = tagged(item, 6)?.[1];
  const token = tagged(item, 13)?.[1];
  const url =
    slug && token
      ? `https://www.craigslist.org/view/d/${slug}/${token}`
      : `https://www.craigslist.org/search/area/newyork?cat=${section.cat}`;

  return {
    source: "craigslist",
    ext_id: String(id),
    title,
    address: neighborhood,
    price: typeof price === "number" && price > 0 ? price : null,
    category:
      section.listingType === "room"
        ? "Room"
        : section.listingType === "sublet"
          ? "Sublet"
          : null,
    listing_type: section.listingType,
    beds: null,
    bath: null,
    size_sqft: null,
    pictures,
    agent_name: null,
    posted_by: null,
    write_dt: postedAt.toISOString(),
    url,
    scraped_at: scrapedAt,
  };
}

// Craigslist laundry attribute values (same as the website's search filter).
const LAUNDRY_PARAMS: Array<[craigslistValue: string, laundry: "in_unit" | "building"]> = [
  ["1", "in_unit"], // w/d in unit
  ["3", "building"], // laundry in bldg
];

async function fetchBand(
  cat: string,
  minPrice: number,
  maxPrice: number,
  laundry?: string,
): Promise<SapiData> {
  const params = new URLSearchParams({
    batch: BATCH,
    cat,
    cc: "US",
    lang: "en",
    searchPath: cat,
    min_price: String(minPrice),
    max_price: String(maxPrice),
    ...(laundry ? { laundry } : {}),
  });
  const res = await fetch(`${API_BASE}?${params}`, {
    headers: {
      ...BROWSER_HEADERS,
      accept: "application/json",
      referer: "https://www.craigslist.org/",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching price band ${minPrice}-${maxPrice}`);
  }
  const json = (await res.json()) as { data?: SapiData; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`API error: ${json.errors[0].message}`);
  }
  if (!json.data?.items || !json.data.decode) {
    throw new Error(`Unexpected API response shape for band ${minPrice}-${maxPrice}`);
  }
  return json.data;
}

async function main() {
  const cutoff = getCutoff();
  const scrapedAt = new Date().toISOString();
  console.log("Scraping Craigslist NY apartments, rooms & sublets (max $3,000/mo)");
  if (DRY_RUN) console.log("DRY RUN: no database writes will be made.\n");

  const rowsById = new Map<string, ListingRow>();

  for (const section of SECTIONS) {
    console.log(`\n--- Section: ${section.label} (${section.cat}) ---`);
    for (const [min, max] of section.priceBands) {
      const data = await fetchBand(section.cat, min, max);
      if (data.totalResultCount > MAX_RESULTS_PER_SEARCH) {
        console.warn(
          `WARNING: ${section.label} band ${min}-${max} has ${data.totalResultCount} results but only ${MAX_RESULTS_PER_SEARCH} can be fetched. Split its priceBands further to get them all.`
        );
      }
      let kept = 0;
      let junk = 0;
      for (const item of data.items) {
        const row = decodeItem(item, data.decode, section, scrapedAt);
        if (!row) continue;
        if (row.write_dt && new Date(row.write_dt) < cutoff) continue;

        // Scam posts hide the real price in the title ("$1,85o") and set the
        // price field to $1; recover the real price when possible.
        if (row.price != null && row.price < MIN_MONTHLY_PRICE) {
          row.price = recoverPriceFromTitle(row.title);
        }
        // Drop placeholder prices, nightly/weekly rates, and recovered prices
        // that exceed the search's own max (scam posts dodging the filter).
        if (row.price == null || row.price < MIN_MONTHLY_PRICE || row.price > MAX_PRICE) {
          junk++;
          continue;
        }

        // A post can appear in multiple sections (cross-posted); the more
        // specific room/sublet label wins over the apartments section's.
        const existing = rowsById.get(row.ext_id);
        if (existing && existing.listing_type != null && row.listing_type == null) {
          continue;
        }
        rowsById.set(row.ext_id, row);
        kept++;
      }
      console.log(
        `Price $${min}-$${max}: ${data.items.length} items, ${kept} kept, ${junk} junk dropped (total: ${rowsById.size})`
      );
      await sleep(PAGE_DELAY_MS);
    }
  }

  // Second pass: re-run each band with Craigslist's laundry filter to tag
  // rows with confirmed washer/dryer info. Only the posting ids matter here;
  // in_unit is processed last so it wins over building for cross-tagged posts.
  console.log(`\n--- Laundry tagging ---`);
  for (const [param, laundry] of [...LAUNDRY_PARAMS].reverse()) {
    let tagged = 0;
    for (const section of SECTIONS) {
      for (const [min, max] of section.priceBands) {
        let data: SapiData;
        try {
          data = await fetchBand(section.cat, min, max, param);
        } catch (err) {
          console.warn(`  ${section.label} ${min}-${max} laundry=${param}: ${(err as Error).message}`);
          continue;
        }
        for (const item of data.items) {
          const idOffset = item[0];
          if (typeof idOffset !== "number") continue;
          const row = rowsById.get(String(data.decode.minPostingId + idOffset));
          if (row && (laundry === "in_unit" || row.laundry == null)) {
            row.laundry = laundry;
            tagged++;
          }
        }
        await sleep(PAGE_DELAY_MS);
      }
    }
    console.log(`  ${laundry}: ${tagged} listings tagged`);
  }

  const rows = dedupeByTitlePrice([...rowsById.values()]);
  console.log(`\n${rows.length} unique listings after repost dedup (${rowsById.size} before).`);

  if (DRY_RUN) {
    console.log("Sample row:", JSON.stringify(rows[0], null, 2));
    return;
  }

  const db = getServiceClient();
  const upserted = await upsertRows(db, rows);
  // Rows not refreshed by this run have expired, been deleted, or are now
  // filtered out as junk.
  const pruned = await pruneUnseen(db, "craigslist", scrapedAt);
  console.log(`Upserted ${upserted} rows, pruned ${pruned} expired/junk rows. Done.`);
  await revalidateListings();
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
