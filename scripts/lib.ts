import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { extractAvailableUntil } from "./availability";
import { detectBorough, type Borough } from "./borough";
import { detectLaundry, type Laundry } from "./laundry";
import { detectListingType, type ListingType } from "./listing-type";

config({ path: ".env.local" });

/** Row shape of the unified public.listings table. */
export interface ListingRow {
  source:
    | "heykorean"
    | "zillow"
    | "streeteasy"
    | "craigslist"
    | "facebook"
    | "reddit"
    | "listingsproject";
  ext_id: string;
  title: string | null;
  address: string | null;
  price: number | null;
  category: string | null;
  beds: number | null;
  bath: number | null;
  size_sqft: number | null;
  pictures: string[];
  agent_name: string | null;
  posted_by: string | null;
  write_dt: string | null;
  url: string;
  scraped_at: string;
  /** Derived by upsertRows; null = outside NYC or undetectable. */
  borough?: Borough | null;
  /**
   * apartment | room | sublet. Scrapers that know it from the source section
   * set it explicitly; otherwise upsertRows derives it from the text.
   */
  listing_type?: ListingType | null;
  /**
   * in_unit | building | null (unknown). Scrapers with a structured signal
   * (Craigslist laundry filter) set it explicitly; otherwise upsertRows
   * derives it from the title. Null means "not confirmed", not "no laundry".
   */
  laundry?: Laundry | null;
  /**
   * ISO date the rental period ends (sublets). Sources with explicit ranges
   * (Listings Project) set it; otherwise upsertRows derives it from the
   * title for sublet rows. Null = open-ended or unknown.
   */
  available_until?: string | null;
}

export const BROWSER_HEADERS = {
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * No legitimate NYC monthly rent is below this. Cheaper "prices" are
 * placeholders ($1 = "contact me"), nightly/weekly rates, or scam posts.
 */
export const MIN_MONTHLY_PRICE = 500;

/**
 * Recovers an obfuscated price from a listing title. Scam posts write the
 * real price with the letter "o" instead of zeros (e.g. "$1,85o") and put
 * $1 in the actual price field to dodge price filters.
 */
export function recoverPriceFromTitle(title: string | null): number | null {
  const match = title?.match(/\$\s*(\d[\d.,oO]*)/);
  if (!match) return null;
  const value = Number(match[1].replace(/[oO]/g, "0").replace(/[.,]/g, ""));
  return Number.isFinite(value) && value >= MIN_MONTHLY_PRICE && value <= 20000
    ? value
    : null;
}

/**
 * Collapses repost spam: rows with the same title and price are considered
 * the same listing, keeping the most recently posted one.
 */
export function dedupeByTitlePrice(rows: ListingRow[]): ListingRow[] {
  const byKey = new Map<string, ListingRow>();
  for (const row of rows) {
    const key = `${(row.title ?? "").trim().toLowerCase()}|${row.price}`;
    const existing = byKey.get(key);
    if (!existing || (row.write_dt ?? "") > (existing.write_dt ?? "")) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

export function getCutoff(): Date {
  const months = Number(process.env.SCRAPE_CUTOFF_MONTHS ?? 2);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

export function getServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.\n" +
        "Copy .env.local.example to .env.local and fill in your Supabase credentials,\n" +
        "or run with --dry-run to test scraping without a database.",
    );
    process.exit(1);
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

/**
 * Stamps site_meta.last_updated with the current time so the frontend can
 * show when data last changed, independent of any per-row scraped_at values.
 * Non-fatal: a missing table (migration not run yet) only logs a warning.
 */
async function markSiteUpdated(): Promise<void> {
  try {
    const db = getServiceClient();
    const { error } = await db.from("site_meta").upsert({
      key: "last_updated",
      value: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.warn(
        `Could not stamp last_updated: ${error.message}. ` +
          "If the site_meta table is missing, run the site_meta section of supabase/schema.sql in the SQL editor.",
      );
      return;
    }
    console.log("Stamped site_meta.last_updated.");
  } catch (err) {
    console.warn(`Could not stamp last_updated: ${(err as Error).message}`);
  }
}

/**
 * Records the run in site_meta, then pings each site's revalidate endpoint so
 * the cached listings page rebuilds with fresh data right after a scrape.
 * SITE_URL may be a comma-separated list (e.g. local dev server and the
 * production deployment). No-ops (with a warning) when SITE_URL or
 * REVALIDATE_SECRET are absent, so scraping keeps working without it.
 */
export async function revalidateListings(): Promise<void> {
  await markSiteUpdated();
  const siteUrls = (process.env.SITE_URL ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const secret = process.env.REVALIDATE_SECRET;
  if (siteUrls.length === 0 || !secret) {
    console.warn(
      "Skipping revalidation: set SITE_URL and REVALIDATE_SECRET in .env.local to auto-refresh the site after scraping.",
    );
    return;
  }
  for (const siteUrl of siteUrls) {
    try {
      const res = await fetch(new URL("/api/revalidate", siteUrl), {
        method: "POST",
        headers: { "x-revalidate-secret": secret },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn(
          `Revalidation failed for ${siteUrl}: ${res.status} ${res.statusText}`,
        );
        continue;
      }
      console.log(`Triggered revalidation for ${siteUrl}.`);
    } catch (err) {
      console.warn(
        `Revalidation errored for ${siteUrl}: ${(err as Error).message}`,
      );
    }
  }
}

export async function upsertRows(
  db: SupabaseClient,
  rows: ListingRow[],
): Promise<number> {
  for (const row of rows) {
    row.borough ??= detectBorough(row);
    row.listing_type ??= detectListingType(row);
    row.laundry ??= detectLaundry(row);
    // Only sublets have an end date; free text like "until renovated" on
    // regular rentals must not produce one.
    if (row.listing_type === "sublet") {
      row.available_until ??= extractAvailableUntil(
        row.title ?? "",
        row.write_dt ? new Date(row.write_dt) : new Date(),
      );
    } else {
      row.available_until ??= null;
    }
  }
  const BATCH_SIZE = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await db
      .from("listings")
      .upsert(batch, { onConflict: "source,ext_id" });
    if (error) {
      throw new Error(`Upsert failed: ${error.message}`);
    }
    upserted += batch.length;
  }
  return upserted;
}

/** Deletes rows for a source whose write_dt is older than the cutoff. */
export async function pruneStale(
  db: SupabaseClient,
  source: ListingRow["source"],
  cutoff: Date,
): Promise<number> {
  const { count, error } = await db
    .from("listings")
    .delete({ count: "exact" })
    .eq("source", source)
    .lt("write_dt", cutoff.toISOString());
  if (error) {
    throw new Error(`Prune failed: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Deletes rows for a source that were not refreshed by the current run
 * (delisted on the source site, or newly filtered out by the scraper).
 */
export async function pruneUnseen(
  db: SupabaseClient,
  source: ListingRow["source"],
  runStartedAt: string,
): Promise<number> {
  const { count, error } = await db
    .from("listings")
    .delete({ count: "exact" })
    .eq("source", source)
    .lt("scraped_at", runStartedAt);
  if (error) {
    throw new Error(`Prune failed: ${error.message}`);
  }
  return count ?? 0;
}
