import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { detectBorough, type Borough } from "./borough";

config({ path: ".env.local" });

/** Row shape of the unified public.listings table. */
export interface ListingRow {
  source:
    | "heykorean"
    | "zillow"
    | "streeteasy"
    | "craigslist"
    | "facebook"
    | "reddit";
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
 * Pings the site's revalidate endpoint so the cached listings page rebuilds
 * with fresh data right after a scrape. No-ops (with a warning) when SITE_URL
 * or REVALIDATE_SECRET are absent, so scraping keeps working without it.
 */
export async function revalidateListings(): Promise<void> {
  const siteUrl = process.env.SITE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!siteUrl || !secret) {
    console.warn(
      "Skipping revalidation: set SITE_URL and REVALIDATE_SECRET in .env.local to auto-refresh the site after scraping.",
    );
    return;
  }
  try {
    const res = await fetch(new URL("/api/revalidate", siteUrl), {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
    });
    if (!res.ok) {
      console.warn(
        `Revalidation request failed: ${res.status} ${res.statusText}`,
      );
      return;
    }
    console.log("Triggered site revalidation.");
  } catch (err) {
    console.warn(`Revalidation request errored: ${(err as Error).message}`);
  }
}

export async function upsertRows(
  db: SupabaseClient,
  rows: ListingRow[],
): Promise<number> {
  for (const row of rows) {
    row.borough ??= detectBorough(row);
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
