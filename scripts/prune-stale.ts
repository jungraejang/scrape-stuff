/**
 * Removes listings older than the cutoff (SCRAPE_CUTOFF_MONTHS, default 2
 * months) from the database. Intended to run before the scrapers in a cron
 * job so the site never shows outdated rows even if a scraper fails.
 *
 * Only sources where write_dt is a posting date are age-pruned:
 *   - heykorean, zillow, craigslist, reddit
 * Skipped on purpose:
 *   - streeteasy: write_dt is an availability date on still-active listings;
 *     off-market rows are pruned by its scraper (pruneUnseen).
 *   - facebook: write_dt is always null (cards expose no posting date);
 *     delisted rows are pruned by its scraper (pruneUnseen).
 *   - listingsproject: write_dt is the sublet's start date (often in the
 *     future); expired rows are pruned by its scraper (pruneUnseen).
 *
 * Run: npm run prune
 */
import { getCutoff, getServiceClient, pruneStale, revalidateListings } from "./lib";

const AGE_PRUNED_SOURCES = ["heykorean", "zillow", "craigslist", "reddit"] as const;

async function main() {
  const cutoff = getCutoff();
  console.log(`Pruning listings older than ${cutoff.toISOString().slice(0, 10)}`);

  const db = getServiceClient();
  let total = 0;
  for (const source of AGE_PRUNED_SOURCES) {
    const pruned = await pruneStale(db, source, cutoff);
    total += pruned;
    console.log(`  ${source}: ${pruned} removed`);
  }

  console.log(`Done. ${total} outdated rows removed.`);
  if (total > 0) await revalidateListings();
}

main().catch((err) => {
  console.error("Prune failed:", err);
  process.exit(1);
});
