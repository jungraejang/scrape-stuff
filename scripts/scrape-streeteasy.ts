/**
 * StreetEasy rental listings scraper.
 *
 * StreetEasy's GraphQL API (api-v6.streeteasy.com) accepts requests without
 * cookies, so this is a straight API scrape. The filters mirror the user's
 * search: NYC areas 100/200/300/400 (Manhattan, Brooklyn, Queens, Bronx),
 * max $2,000/mo. All returned listings are ACTIVE (currently listed), so
 * instead of a listing-age cutoff, rows disappear from the table when they
 * go off market (pruned when not seen in the latest run).
 *
 * Run with: npm run scrape:streeteasy
 * Dry run (no database writes): npm run scrape:streeteasy -- --dry-run
 */
import {
  BROWSER_HEADERS,
  getServiceClient,
  pruneUnseen,
  revalidateListings,
  sleep,
  upsertRows,
  type ListingRow,
} from "./lib";

const API_URL = "https://api-v6.streeteasy.com/";
const AREAS = [100, 200, 300, 400];
const PRICE_MAX = 2000;
const PER_PAGE = 500;
const PAGE_DELAY_MS = 1000;
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

function toRow(node: SeNode, scrapedAt: string): ListingRow {
  const streetUnit = [node.street, node.unit ? `#${node.unit}` : null].filter(Boolean).join(" ");
  const address = [streetUnit, node.areaName].filter(Boolean).join(", ") || null;
  const bath =
    node.fullBathroomCount != null || node.halfBathroomCount != null
      ? (node.fullBathroomCount ?? 0) + 0.5 * (node.halfBathroomCount ?? 0)
      : null;
  const photoKey = node.leadMedia?.photo?.key;
  return {
    source: "streeteasy",
    ext_id: node.id,
    title: address ?? `Listing ${node.id}`,
    address,
    price: node.price,
    category: node.bedroomCount == null ? null : node.bedroomCount === 0 ? "Studio" : `${node.bedroomCount}BR`,
    beds: node.bedroomCount,
    bath,
    size_sqft: null,
    pictures: photoKey ? [`https://photos.streeteasy.com/${photoKey}_1.jpg`] : [],
    agent_name: node.sourceGroupLabel,
    posted_by: null,
    write_dt: node.availableAt ? new Date(`${node.availableAt}T00:00:00`).toISOString() : null,
    url: `https://streeteasy.com${node.urlPath ?? ""}`,
    scraped_at: scrapedAt,
  };
}

async function fetchPage(page: number): Promise<SeResponse["data"]> {
  const body = {
    query: QUERY,
    variables: {
      input: {
        filters: {
          rentalStatus: "ACTIVE",
          areas: AREAS,
          price: { lowerBound: null, upperBound: PRICE_MAX },
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
  console.log("Scraping StreetEasy active rentals (max $2,000/mo, NYC)");
  if (DRY_RUN) console.log("DRY RUN: no database writes will be made.\n");

  const rowsById = new Map<string, ListingRow>();
  let totalCount = Infinity;

  for (let page = 1; rowsById.size < totalCount; page++) {
    const data = await fetchPage(page);
    totalCount = data!.searchRentals.totalCount;
    const nodes = data!.searchRentals.edges
      .map((e) => e.node)
      .filter((n): n is SeNode => n != null);
    if (nodes.length === 0) break;

    for (const node of nodes) {
      const row = toRow(node, scrapedAt);
      rowsById.set(row.ext_id, row);
    }
    console.log(`Page ${page}: ${nodes.length} listings (total kept: ${rowsById.size}/${totalCount})`);
    if (rowsById.size < totalCount) await sleep(PAGE_DELAY_MS);
  }

  const rows = [...rowsById.values()];
  console.log(`\n${rows.length} unique active listings.`);

  if (DRY_RUN) {
    console.log("Sample row:", JSON.stringify(rows[0], null, 2));
    return;
  }

  const db = getServiceClient();
  const upserted = await upsertRows(db, rows);
  // Listings no longer in search results have gone off market.
  const pruned = await pruneUnseen(db, "streeteasy", scrapedAt);
  console.log(`Upserted ${upserted} rows, pruned ${pruned} off-market rows. Done.`);
  await revalidateListings();
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
