/**
 * Facebook Marketplace rental listings scraper (Playwright).
 *
 * Facebook has no public API and blocks plain HTTP clients outright, so
 * this scraper drives a real Chromium browser. It loads the Marketplace
 * property-rentals search for NYC, scrolls to load more results, and
 * extracts the listing cards from the DOM.
 *
 * Requires a logged-in session: run `npm run fb:login` once first.
 * WARNING: scraping Marketplace violates Facebook's ToS and can get the
 * account flagged. Use at your own risk, keep scroll counts modest, and
 * prefer a non-primary account.
 *
 * Run with: npm run scrape:facebook
 * Dry run (no database writes): npm run scrape:facebook -- --dry-run
 * Debug visually: npm run scrape:facebook -- --headed
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import {
  dedupeByTitlePrice,
  getServiceClient,
  MIN_MONTHLY_PRICE,
  pruneUnseen,
  revalidateListings,
  upsertRows,
  type ListingRow,
} from "./lib";

const SESSION_FILE = "fb-session.json";
const SEARCH_URL = "https://www.facebook.com/marketplace/nyc/propertyrentals?maxPrice=3000&exact=false";
const MAX_PRICE = 3000;
const SCROLL_ROUNDS = Number(process.env.SCRAPE_FB_SCROLLS ?? 12);
const SCROLL_DELAY_MS = 2500;
const DRY_RUN = process.argv.includes("--dry-run");
const HEADED = process.argv.includes("--headed");

interface RawCard {
  href: string | null;
  img: string | null;
  texts: string[];
}

function parseCard(card: RawCard, scrapedAt: string): ListingRow | null {
  const idMatch = card.href?.match(/\/marketplace\/item\/(\d+)/);
  if (!idMatch) return null;
  const id = idMatch[1];

  // Card text spans are typically [price, title, location, ...].
  const priceText = card.texts.find((t) => /^\$[\d,]+/.test(t));
  const price = priceText ? Number(priceText.replace(/[^0-9]/g, "")) : null;
  const nonPrice = card.texts.filter((t) => t !== priceText);
  // Location looks like "Brooklyn, NY"; the title is the longest other text.
  const location = nonPrice.find((t) => /,\s*[A-Z]{2}$/.test(t)) ?? null;
  const title =
    nonPrice
      .filter((t) => t !== location)
      .sort((a, b) => b.length - a.length)[0] ?? null;

  return {
    source: "facebook",
    ext_id: id,
    title,
    address: location,
    price,
    category: null,
    beds: null,
    bath: null,
    size_sqft: null,
    pictures: card.img ? [card.img] : [],
    agent_name: null,
    posted_by: null,
    write_dt: null, // search cards don't expose a posting date
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    scraped_at: scrapedAt,
  };
}

async function main() {
  const scrapedAt = new Date().toISOString();
  console.log("Scraping Facebook Marketplace NYC rentals (max $3,000/mo)");
  if (DRY_RUN) console.log("DRY RUN: no database writes will be made.");

  const hasSession = existsSync(SESSION_FILE);
  if (!hasSession) {
    console.warn(
      `\nNo ${SESSION_FILE} found - run "npm run fb:login" first.\n` +
        "Trying without a login; Facebook usually shows few or no results logged out.\n"
    );
  }

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    storageState: hasSession ? SESSION_FILE : undefined,
    viewport: { width: 1440, height: 960 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(4000);

    if (page.url().includes("/login")) {
      throw new Error("Facebook redirected to the login page. Run: npm run fb:login");
    }

    // Dismiss the logged-out login popup if it covers the page.
    const closeButton = page.locator('[aria-label="Close"]').first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click().catch(() => {});
    }

    const cardsById = new Map<string, RawCard>();
    for (let round = 0; round <= SCROLL_ROUNDS; round++) {
      const cards: RawCard[] = await page.$$eval('a[href*="/marketplace/item/"]', (links) =>
        links.map((a) => ({
          href: a.getAttribute("href"),
          img: a.querySelector("img")?.getAttribute("src") ?? null,
          texts: [...a.querySelectorAll("span")]
            .map((s) => s.textContent?.trim() ?? "")
            .filter((t) => t.length > 0 && t.length < 200),
        }))
      );
      for (const card of cards) {
        const id = card.href?.match(/\/marketplace\/item\/(\d+)/)?.[1];
        if (id && !cardsById.has(id)) cardsById.set(id, card);
      }
      console.log(`Scroll ${round}/${SCROLL_ROUNDS}: ${cardsById.size} unique cards so far`);
      if (round < SCROLL_ROUNDS) {
        await page.mouse.wheel(0, 2400);
        await page.waitForTimeout(SCROLL_DELAY_MS);
      }
    }

    if (cardsById.size === 0) {
      throw new Error(
        "No listing cards found. Facebook may have shown a login wall or a captcha - " +
          "try again with --headed to see what the browser sees, or re-run npm run fb:login."
      );
    }

    let rows = [...cardsById.values()]
      .map((c) => parseCard(c, scrapedAt))
      .filter((r): r is ListingRow => r != null)
      .filter((r) => r.price == null || (r.price >= MIN_MONTHLY_PRICE && r.price <= MAX_PRICE));
    rows = dedupeByTitlePrice(rows);
    console.log(`\n${rows.length} listings extracted.`);

    if (DRY_RUN) {
      console.log("Sample row:", JSON.stringify(rows[0], null, 2));
      return;
    }

    const db = getServiceClient();
    const upserted = await upsertRows(db, rows);
    // Cards not seen in this run are delisted (or fell outside the scroll depth).
    const pruned = await pruneUnseen(db, "facebook", scrapedAt);
    console.log(`Upserted ${upserted} rows, pruned ${pruned} unseen rows. Done.`);
    await revalidateListings();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
