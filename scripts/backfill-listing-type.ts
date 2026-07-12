/**
 * One-time backfill: derives `listing_type` for every existing row from the
 * title/category already stored in the table. Zillow and StreetEasy list
 * whole units only, so their rows are set to "apartment" directly. Safe to
 * re-run; it only touches rows where the derived value differs.
 *
 * Run: node --use-system-ca --import tsx scripts/backfill-listing-type.ts
 */
import { getServiceClient } from "./lib";
import { detectListingType, type ListingType } from "./listing-type";

const MIGRATION_SQL = `alter table public.listings add column if not exists listing_type text;`;

/** Sources that only carry whole-unit rentals. */
const APARTMENT_ONLY = new Set(["zillow", "streeteasy"]);

async function main() {
  const db = getServiceClient();

  // Fail fast with instructions if the column hasn't been added yet.
  const probe = await db.from("listings").select("listing_type").limit(1);
  if (probe.error) {
    console.error(
      "The listing_type column doesn't exist yet. Run this in the Supabase SQL editor, then re-run this script:\n\n" +
        MIGRATION_SQL + "\n"
    );
    process.exit(1);
  }

  const rows: {
    source: string;
    ext_id: string;
    title: string | null;
    category: string | null;
    listing_type: string | null;
  }[] = [];
  const BATCH = 1000;
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await db
      .from("listings")
      .select("source, ext_id, title, category, listing_type")
      .order("ext_id", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < BATCH) break;
  }
  console.log(`Fetched ${rows.length} rows.`);

  // Group pending updates as source -> listing_type -> ext_ids so each group
  // becomes a single UPDATE ... WHERE ext_id IN (...) request.
  const pending = new Map<string, Map<ListingType, string[]>>();
  let unchanged = 0;
  for (const row of rows) {
    const type = APARTMENT_ONLY.has(row.source)
      ? "apartment"
      : detectListingType(row);
    if (type === row.listing_type) {
      unchanged++;
      continue;
    }
    let byType = pending.get(row.source);
    if (!byType) {
      byType = new Map();
      pending.set(row.source, byType);
    }
    const ids = byType.get(type) ?? [];
    ids.push(row.ext_id);
    byType.set(type, ids);
  }

  let updated = 0;
  const CHUNK = 100; // keep the IN() filter under PostgREST URL limits
  for (const [source, byType] of pending) {
    for (const [type, ids] of byType) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { error } = await db
          .from("listings")
          .update({ listing_type: type })
          .eq("source", source)
          .in("ext_id", chunk);
        if (error) throw new Error(`Update failed (${source}/${type}): ${error.message}`);
        updated += chunk.length;
      }
      console.log(`  ${source} -> ${type}: ${ids.length}`);
    }
  }

  console.log(`\nDone. Updated ${updated}, already correct ${unchanged}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
