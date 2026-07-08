/**
 * One-time backfill: derives `borough` for every existing row from the
 * address/title/url already stored in the table. Safe to re-run; it only
 * touches rows where the derived value differs from what's stored.
 *
 * Run: node --use-system-ca --import tsx scripts/backfill-borough.ts
 */
import { getServiceClient } from "./lib";
import { detectBorough, type Borough } from "./borough";

const MIGRATION_SQL = `alter table public.listings add column if not exists borough text;
create index if not exists listings_borough_idx on public.listings (borough);`;

async function main() {
  const db = getServiceClient();

  // Fail fast with instructions if the column hasn't been added yet.
  const probe = await db.from("listings").select("borough").limit(1);
  if (probe.error) {
    console.error(
      "The borough column doesn't exist yet. Run this in the Supabase SQL editor, then re-run this script:\n\n" +
        MIGRATION_SQL + "\n"
    );
    process.exit(1);
  }

  const rows: {
    source: string;
    ext_id: string;
    title: string | null;
    address: string | null;
    url: string;
    borough: string | null;
  }[] = [];
  const BATCH = 1000;
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await db
      .from("listings")
      .select("source, ext_id, title, address, url, borough")
      .order("ext_id", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < BATCH) break;
  }
  console.log(`Fetched ${rows.length} rows.`);

  // Group pending updates as source -> borough -> ext_ids so each group
  // becomes a single UPDATE ... WHERE ext_id IN (...) request.
  const pending = new Map<string, Map<Borough, string[]>>();
  let unchanged = 0;
  let unclassified = 0;
  for (const row of rows) {
    const borough = detectBorough(row);
    if (!borough) {
      unclassified++;
      continue;
    }
    if (borough === row.borough) {
      unchanged++;
      continue;
    }
    let bySourceMap = pending.get(row.source);
    if (!bySourceMap) {
      bySourceMap = new Map();
      pending.set(row.source, bySourceMap);
    }
    const ids = bySourceMap.get(borough) ?? [];
    ids.push(row.ext_id);
    bySourceMap.set(borough, ids);
  }

  let updated = 0;
  const CHUNK = 100; // keep the IN() filter under PostgREST URL limits
  for (const [source, byBorough] of pending) {
    for (const [borough, ids] of byBorough) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { error } = await db
          .from("listings")
          .update({ borough })
          .eq("source", source)
          .in("ext_id", chunk);
        if (error) throw new Error(`Update failed (${source}/${borough}): ${error.message}`);
        updated += chunk.length;
      }
      console.log(`  ${source} -> ${borough}: ${ids.length}`);
    }
  }

  console.log(
    `\nDone. Updated ${updated}, already correct ${unchanged}, ` +
      `left null (outside NYC / undetectable) ${unclassified}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
