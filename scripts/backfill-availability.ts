/**
 * One-time backfill: derives `available_until` for existing SUBLET rows from
 * the stored title text ("July-Oct sublet", "until September", ...). Only
 * sublets are touched; most stay null (no end date stated), which means
 * open-ended/unknown. Listings Project rows get their exact end dates
 * overwritten by the next scraper run, which reads the structured date range.
 * Safe to re-run; it only touches rows where the derived value differs.
 *
 * Run: node --use-system-ca --import tsx scripts/backfill-availability.ts
 */
import { extractAvailableUntil } from "./availability";
import { getServiceClient } from "./lib";

const MIGRATION_SQL = `alter table public.listings add column if not exists available_until timestamptz;`;

async function main() {
  const db = getServiceClient();

  // Fail fast with instructions if the column hasn't been added yet.
  const probe = await db.from("listings").select("available_until").limit(1);
  if (probe.error) {
    console.error(
      "The available_until column doesn't exist yet. Run this in the Supabase SQL editor, then re-run this script:\n\n" +
        MIGRATION_SQL + "\n"
    );
    process.exit(1);
  }

  const rows: {
    source: string;
    ext_id: string;
    title: string | null;
    write_dt: string | null;
    available_until: string | null;
  }[] = [];
  const BATCH = 1000;
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await db
      .from("listings")
      .select("source, ext_id, title, write_dt, available_until")
      .eq("listing_type", "sublet")
      .order("ext_id", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < BATCH) break;
  }
  console.log(`Fetched ${rows.length} sublet rows.`);

  let updated = 0;
  let unchanged = 0;
  let unknown = 0;
  for (const row of rows) {
    const until = extractAvailableUntil(
      row.title ?? "",
      row.write_dt ? new Date(row.write_dt) : new Date(),
    );
    if (!until) {
      unknown++;
      continue;
    }
    if (
      row.available_until &&
      new Date(row.available_until).getTime() === new Date(until).getTime()
    ) {
      unchanged++;
      continue;
    }
    const { error } = await db
      .from("listings")
      .update({ available_until: until })
      .eq("source", row.source)
      .eq("ext_id", row.ext_id);
    if (error) {
      throw new Error(`Update failed (${row.source}/${row.ext_id}): ${error.message}`);
    }
    console.log(`  ${row.source}/${row.ext_id}: until ${until.slice(0, 10)}  "${row.title?.slice(0, 60)}"`);
    updated++;
  }

  console.log(
    `\nDone. Updated ${updated}, already correct ${unchanged}, no end date found ${unknown}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
