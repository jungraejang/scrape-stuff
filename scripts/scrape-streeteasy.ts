/**
 * StreetEasy rental listings scraper.
 *
 * StreetEasy's GraphQL API (api-v6.streeteasy.com) accepts requests without
 * cookies, so this is a straight API scrape. The filters mirror the user's
 * search: NYC areas 100/200/300/400 (Manhattan, Brooklyn, Queens, Bronx),
 * max $3,000/mo. All returned listings are ACTIVE (currently listed), so
 * instead of a listing-age cutoff, rows disappear from the table when they
 * go off market (pruned when not seen in the latest run).
 *
 * Run with: npm run scrape:streeteasy
 * Dry run (no database writes): npm run scrape:streeteasy -- --dry-run
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BROWSER_HEADERS,
  getServiceClient,
  pruneUnseen,
  revalidateListings,
  sleep,
  upsertRows,
  type ListingRow,
} from "./lib";
import {
  ensurePhotoBucket,
  listStoredPhotos,
  pruneOrphanPhotos,
  publicPhotoUrl,
  uploadPhoto,
} from "./photo-store";

const API_URL = "https://api-v6.streeteasy.com/";
const AREAS = [100, 200, 300, 400];
const PRICE_MAX = 3000;
// The API caps any search at 1000 results, so search per price band.
const PRICE_BANDS: Array<[number | null, number]> = [
  [null, 2000],
  [2001, 2500],
  [2501, 2800],
  [2801, PRICE_MAX],
];
const PER_PAGE = 500;
const PAGE_DELAY_MS = 1000;
const PHOTO_DELAY_MS = 300;
const DRY_RUN = process.argv.includes("--dry-run");

const QUERY = `
  query GetListingRental($input: SearchRentalsInput!) {
    searchRentals(input: $input) {
      totalCount
      edges {
        ... on OrganicRentalEdge {
          node {
            ...RentalFields
          }
        }
        ... on FeaturedRentalEdge {
          node {
            ...RentalFields
          }
        }
      }
    }
  }
  fragment RentalFields on SearchRentalListing {
    id
    areaName
    availableAt
    bedroomCount
    buildingType
    fullBathroomCount
    halfBathroomCount
    leadMedia { photo { key } }
    price
    sourceGroupLabel
    status
    street
    unit
    urlPath
  }
`;

interface SeNode {
  id: string;
  areaName: string | null;
  availableAt: string | null;
  bedroomCount: number | null;
  buildingType: string | null;
  fullBathroomCount: number | null;
  halfBathroomCount: number | null;
  leadMedia: { photo?: { key?: string | null } | null } | null;
  price: number | null;
  sourceGroupLabel: string | null;
  status: string;
  street: string | null;
  unit: string | null;
  urlPath: string | null;
}

interface SeResponse {
  errors?: { message: string }[];
  data?: {
    searchRentals: {
      totalCount: number;
      edges: { node?: SeNode }[];
    };
  };
}

function toRow(node: SeNode, scrapedAt: string): { row: ListingRow; photoKey: string | null } {
  const streetUnit = [node.street, node.unit ? `#${node.unit}` : null].filter(Boolean).join(" ");
  const address = [streetUnit, node.areaName].filter(Boolean).join(", ") || null;
  const bath =
    node.fullBathroomCount != null || node.halfBathroomCount != null
      ? (node.fullBathroomCount ?? 0) + 0.5 * (node.halfBathroomCount ?? 0)
      : null;
  const photoKey = node.leadMedia?.photo?.key ?? null;
  const row: ListingRow = {
    source: "streeteasy",
    ext_id: node.id,
    title: address ?? `Listing ${node.id}`,
    address,
    price: node.price,
    category: node.bedroomCount == null ? null : node.bedroomCount === 0 ? "Studio" : `${node.bedroomCount}BR`,
    beds: node.bedroomCount,
    bath,
    size_sqft: null,
    pictures: [],
    agent_name: node.sourceGroupLabel,
    posted_by: null,
    write_dt: node.availableAt ? new Date(`${node.availableAt}T00:00:00`).toISOString() : null,
    url: `https://streeteasy.com${node.urlPath ?? ""}`,
    scraped_at: scrapedAt,
  };
  return { row, photoKey };
}

/**
 * photos.streeteasy.com is behind PerimeterX, so visitors' browsers can't
 * hotlink it. The same photo keys are served openly by Zillow's CDN
 * (StreetEasy is Zillow-owned), so we download from there once and re-host
 * in the public Supabase Storage bucket.
 */
function sourcePhotoUrl(photoKey: string): string {
  return `https://photos.zillowstatic.com/fp/${photoKey}-se_large_800_400.jpg`;
}

async function mirrorPhotos(
  db: SupabaseClient,
  entries: { row: ListingRow; photoKey: string | null }[]
): Promise<void> {
  await ensurePhotoBucket(db);
  const stored = await listStoredPhotos(db, "streeteasy");

  let reused = 0;
  let downloaded = 0;
  let failed = 0;
  for (const { row, photoKey } of entries) {
    if (!photoKey) continue;
    const name = `${photoKey}.jpg`;
    const path = `streeteasy/${name}`;

    if (!stored.has(name)) {
      try {
        const res = await fetch(sourcePhotoUrl(photoKey), {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) {
          throw new Error(`HTTP ${res.status}`);
        }
        await uploadPhoto(db, path, Buffer.from(await res.arrayBuffer()), "image/jpeg");
        stored.add(name);
        downloaded++;
      } catch (err) {
        failed++;
        console.warn(`  photo ${photoKey}: ${(err as Error).message}`);
        // Leave the original CDN URL; it at least opens when clicked through.
        row.pictures = [`https://photos.streeteasy.com/${photoKey}_1.jpg`];
        continue;
      } finally {
        // Throttle only actual downloads to stay clear of CDN rate limits.
        await sleep(PHOTO_DELAY_MS);
      }
    } else {
      reused++;
    }
    row.pictures = [publicPhotoUrl(db, path)];
  }
  console.log(`Photos: ${downloaded} downloaded, ${reused} already stored, ${failed} failed.`);
}

async function fetchPage(
  page: number,
  priceLo: number | null,
  priceHi: number,
): Promise<SeResponse["data"]> {
  const body = {
    query: QUERY,
    variables: {
      input: {
        filters: {
          rentalStatus: "ACTIVE",
          areas: AREAS,
          price: { lowerBound: priceLo, upperBound: priceHi },
        },
        page,
        perPage: PER_PAGE,
        sorting: { attribute: "LISTED_AT", direction: "DESCENDING" },
        adStrategy: "NONE",
      },
    },
  };
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://streeteasy.com",
      referer: "https://streeteasy.com/",
      "apollographql-client-name": "srp-frontend-service",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching page ${page}`);
  }
  const json = (await res.json()) as SeResponse;
  if (json.errors?.length) {
    throw new Error(`GraphQL error: ${json.errors[0].message}`);
  }
  if (!json.data?.searchRentals) {
    throw new Error(`Unexpected API response shape on page ${page}`);
  }
  return json.data;
}

async function main() {
  const scrapedAt = new Date().toISOString();
  console.log("Scraping StreetEasy active rentals (max $3,000/mo, NYC)");
  if (DRY_RUN) console.log("DRY RUN: no database writes will be made.\n");

  const entriesById = new Map<string, { row: ListingRow; photoKey: string | null }>();

  // The API silently caps results at 1000 per search, so search one price
  // band at a time and merge.
  for (const [lo, hi] of PRICE_BANDS) {
    let bandSeen = 0;
    let bandTotal = Infinity;
    for (let page = 1; bandSeen < bandTotal; page++) {
      const data = await fetchPage(page, lo, hi);
      bandTotal = data!.searchRentals.totalCount;
      if (bandTotal > 1000) {
        console.warn(
          `WARNING: price band $${lo ?? 0}-$${hi} has ${bandTotal} results but the API caps at 1000. Split PRICE_BANDS further.`
        );
      }
      const nodes = data!.searchRentals.edges
        .map((e) => e.node)
        .filter((n): n is SeNode => n != null);
      if (nodes.length === 0) break;

      bandSeen += nodes.length;
      for (const node of nodes) {
        const entry = toRow(node, scrapedAt);
        entriesById.set(entry.row.ext_id, entry);
      }
      console.log(
        `Price $${lo ?? 0}-$${hi} page ${page}: ${nodes.length} listings (band: ${bandSeen}/${bandTotal}, total: ${entriesById.size})`
      );
      await sleep(PAGE_DELAY_MS);
    }
  }

  const entries = [...entriesById.values()];
  console.log(`\n${entries.length} unique active listings.`);

  if (DRY_RUN) {
    console.log("Sample row:", JSON.stringify(entries[0], null, 2));
    return;
  }

  const db = getServiceClient();
  await mirrorPhotos(db, entries);

  const upserted = await upsertRows(db, entries.map((e) => e.row));
  // Listings no longer in search results have gone off market.
  const pruned = await pruneUnseen(db, "streeteasy", scrapedAt);

  // Drop stored photos whose listing went off market.
  const keep = new Set(
    entries.filter((e) => e.photoKey).map((e) => `${e.photoKey}.jpg`)
  );
  const orphans = await pruneOrphanPhotos(db, "streeteasy", keep);

  console.log(
    `Upserted ${upserted} rows, pruned ${pruned} off-market rows, removed ${orphans} orphaned photos. Done.`
  );
  await revalidateListings();
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
