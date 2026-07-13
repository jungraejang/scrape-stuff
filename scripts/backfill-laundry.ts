/**
 * One-time backfill: derives `laundry` for existing rows from the stored
 * title text. Only fills values where the heuristic is confident; most rows
 * legitimately stay null (laundry not mentioned). The structured signals
 * (Craigslist laundry filter, StreetEasy amenity filter, Reddit post bodies)
 * arrive with the next scraper runs, which overwrite these rows anyway.
 * Safe to re-run; it only touches rows where the derived value differs.
 *
 * Run: node --use-system-ca --import tsx scripts/backfill-laundry.ts
 */
import { getServiceClient } from "./lib";
import { detectLaundry, type Laundry } from "./laundry";

const MIGRATION_SQL = `alter table public.listings add column if not exists laundry text;`;

async function main() {
  const db = getServiceClient();

  // Fail fast with instructions if the column hasn't been added yet.
  const probe = await db.from("listings").select("laundry").limit(1);
  if (probe.error) {
    console.error(
      "The laundry column doesn't exist yet. Run this in the Supabase SQL editor, then re-run this script:\n\n" +
        MIGRATION_SQL + "\n"
    );
    process.exit(1);
  }

  const rows: {
    source: string;
    ext_id: string;
    title: string | null;
    laundry: string | null;
  }[] = [];
  const BATCH = 1000;
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await db
      .from("listings")
      .select("source, ext_id, title, laundry")
      .order("ext_id", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < BATCH) break;
  }
  console.log(`Fetched ${rows.length} rows.`);

  // Group pending updates as source -> laundry -> ext_ids so each group
  // becomes a single UPDATE ... WHERE ext_id IN (...) request.
  const pending = new Map<string, Map<Laundry, string[]>>();
  let unchanged = 0;
  let unknown = 0;
  for (const row of rows) {
    const laundry = detectLaundry(row);
    if (!laundry) {
      unknown++;
      continue;
    }
    if (laundry === row.laundry) {
      unchanged++;
      continue;
    }
    let byValue = pending.get(row.source);
    if (!byValue) {
      byValue = new Map();
      pending.set(row.source, byValue);
    }
    const ids = byValue.get(laundry) ?? [];
    ids.push(row.ext_id);
    byValue.set(laundry, ids);
  }

  let updated = 0;
  const CHUNK = 100; // keep the IN() filter under PostgREST URL limits
  for (const [source, byValue] of pending) {
    for (const [laundry, ids] of byValue) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { error } = await db
          .from("listings")
          .update({ laundry })
          .eq("source", source)
          .in("ext_id", chunk);
        if (error) throw new Error(`Update failed (${source}/${laundry}): ${error.message}`);
        updated += chunk.length;
      }
      console.log(`  ${source} -> ${laundry}: ${ids.length}`);
    }
  }

  console.log(
    `\nDone. Updated ${updated}, already correct ${unchanged}, not mentioned ${unknown}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
