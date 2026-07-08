/**
 * Reports how well detectBorough classifies the rows currently in the
 * listings table, per source, with samples of what it can't classify.
 *
 * Run: node --use-system-ca --import tsx scripts/analyze-borough.ts
 */
import { getServiceClient } from "./lib";
import { detectBorough } from "./borough";

async function main() {
  const db = getServiceClient();

  const rows: {
    source: string;
    title: string | null;
    address: string | null;
    url: string;
  }[] = [];
  const BATCH = 1000;
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await db
      .from("listings")
      .select("source, title, address, url")
      .order("ext_id", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < BATCH) break;
  }
  console.log(`Total rows: ${rows.length}\n`);

  const bySource = new Map<
    string,
    { total: number; classified: number; byBorough: Record<string, number>; misses: typeof rows }
  >();
  for (const row of rows) {
    let stats = bySource.get(row.source);
    if (!stats) {
      stats = { total: 0, classified: 0, byBorough: {}, misses: [] };
      bySource.set(row.source, stats);
    }
    stats.total++;
    const borough = detectBorough(row);
    if (borough) {
      stats.classified++;
      stats.byBorough[borough] = (stats.byBorough[borough] ?? 0) + 1;
    } else if (stats.misses.length < 8) {
      stats.misses.push(row);
    }
  }

  for (const [source, s] of bySource) {
    console.log(`=== ${source} ===`);
    console.log(
      `  classifiable: ${s.classified}/${s.total} (${Math.round((s.classified / s.total) * 100)}%)`
    );
    console.log(`  breakdown:`, s.byBorough);
    if (s.misses.length) {
      console.log(`  sample unclassified rows:`);
      for (const m of s.misses) {
        console.log(`    - addr=${JSON.stringify(m.address)} title=${JSON.stringify(m.title?.slice(0, 70))}`);
      }
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
