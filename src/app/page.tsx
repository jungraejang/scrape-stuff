import { unstable_cache } from "next/cache";
import { getSupabaseClient, type Listing } from "@/lib/supabase";
import ListingsGrid from "@/components/ListingsGrid";

// ISR fallback: rebuild at most hourly even if a scraper never pings the
// revalidate endpoint. Fresh scrapes invalidate the "listings" tag on demand.
export const revalidate = 3600;

const BATCH = 1000;
const FETCH_RETRIES = 3;

function isTransientFetchError(message: string): boolean {
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(message);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries Supabase reads when the network blips during cache revalidation. */
async function fetchListingsBatch(from: number): Promise<Listing[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("NOT_CONFIGURED");

  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    const { data, error } = await supabase
      .from("listings")
      .select("*")
      .order("write_dt", { ascending: false, nullsFirst: false })
      .order("ext_id", { ascending: true })
      .range(from, from + BATCH - 1);

    if (!error) return (data ?? []) as Listing[];

    const message = error.message ?? String(error);
    if (!isTransientFetchError(message) || attempt === FETCH_RETRIES - 1) {
      throw new Error(message);
    }
    await sleep(1000 * (attempt + 1));
  }
  return [];
}

/**
 * Fetches every listing, cached under the "listings" tag. Scrapers invalidate
 * this tag via /api/revalidate so the site refreshes right after a run.
 * Throws on error/misconfiguration so the caller can render a setup message
 * (thrown errors are not cached).
 */
const getCachedListings = unstable_cache(
  async (): Promise<Listing[]> => {
    const listings: Listing[] = [];
    for (let from = 0; ; from += BATCH) {
      const batch = await fetchListingsBatch(from);
      listings.push(...batch);
      if (batch.length < BATCH) break;
    }
    return listings;
  },
  ["listings"],
  { tags: ["listings"], revalidate: 3600 },
);

export default async function Home() {
  if (!getSupabaseClient()) {
    return (
      <SetupMessage
        title="Supabase is not configured"
        body="Copy .env.local.example to .env.local, fill in your Supabase project URL and anon key, then restart the dev server."
      />
    );
  }

  let listings: Listing[];
  try {
    listings = await getCachedListings();
  } catch (err) {
    return (
      <SetupMessage
        title="Could not load listings"
        body={`Supabase returned an error: ${(err as Error).message}. Make sure you ran supabase/schema.sql in the SQL editor.`}
      />
    );
  }

  if (listings.length === 0) {
    return (
      <SetupMessage
        title="No listings yet"
        body="The database is empty. Run `npm run scrape` (HeyKorean) and `npm run scrape:zillow` (Zillow) to pull fresh listings, then refresh this page."
      />
    );
  }

  return <ListingsGrid listings={listings} />;
}

function SetupMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-3 text-xl font-semibold">{title}</h1>
        <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{body}</p>
      </div>
    </main>
  );
}
