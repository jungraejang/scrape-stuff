/**
 * Reddit r/NYCapartments scraper (Playwright, no API key).
 *
 * Reddit blocks plain HTTP clients by TLS fingerprint (Node fetch gets
 * 403/429 even with a browser user-agent), so this scraper drives a real
 * Chromium browser and calls Reddit's undocumented JSON endpoint
 * (/r/<sub>/new.json) from inside the page context, where requests carry a
 * genuine browser fingerprint and session cookies. The JSON API also returns
 * more than the RSS feed did: post flair (used to classify listings),
 * preview images, and pagination beyond 100 posts.
 *
 * Posts are unstructured text: actual listings are mixed with advice and
 * roommate-search threads. Flair decides when it is clear; otherwise only
 * posts with an extractable dollar price are kept (the signature of a real
 * listing). Since the feed only shows recent posts, rows are pruned by age
 * (prune-stale.ts), not by absence.
 *
 * Run with: npm run scrape:reddit
 * Dry run (no database writes): npm run scrape:reddit -- --dry-run
 * Debug visually: npm run scrape:reddit -- --headed
 */
import { chromium, type Page } from "playwright";
import { extractAvailableUntil } from "./availability";
import { detectBorough } from "./borough";
import { detectLaundry } from "./laundry";
import { detectListingType, type ListingType } from "./listing-type";
import {
  getCutoff,
  getServiceClient,
  MIN_MONTHLY_PRICE,
  pruneStale,
  revalidateListings,
  sleep,
  upsertRows,
  type ListingRow,
} from "./lib";

const SUBREDDIT = "NYCapartments";
const BASE_URL = `https://www.reddit.com/r/${SUBREDDIT}/new/`;
const MAX_PRICE = 3000; // align with the other scrapers' search caps
const MAX_PAGES = Number(process.env.SCRAPE_REDDIT_PAGES ?? 4); // 100 posts/page
const PAGE_DELAY_MS = 2500;
const FETCH_RETRIES = 3;
const DRY_RUN = process.argv.includes("--dry-run");
const HEADED = process.argv.includes("--headed");

interface RedditPost {
  id: string; // fullname, e.g. "t3_1ur2238" (matches the old RSS ext_id)
  title: string;
  permalink: string;
  createdUtc: number;
  author: string | null;
  flair: string | null;
  text: string;
  picture: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** First usable image URL from a post's JSON (preview or direct link). */
function extractPicture(d: any): string | null {
  // preview.images[].source.url is HTML-escaped (&amp;).
  const preview = d?.preview?.images?.[0]?.source?.url;
  if (typeof preview === "string") return preview.replace(/&amp;/g, "&");
  // Gallery posts expose media_metadata keyed by image id.
  const meta = d?.media_metadata;
  if (meta && typeof meta === "object") {
    for (const item of Object.values<any>(meta)) {
      const mime: string | undefined = item?.m;
      if (item?.id && typeof mime === "string" && mime.startsWith("image/")) {
        return `https://i.redd.it/${item.id}.${mime.split("/")[1]}`;
      }
    }
  }
  // Direct image links (i.redd.it, imgur, ...).
  const dest = d?.url_overridden_by_dest;
  if (typeof dest === "string" && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(dest)) {
    return dest;
  }
  return null;
}

function toPost(d: any): RedditPost | null {
  if (!d?.name || !d?.title || !d?.permalink || !d?.created_utc) return null;
  return {
    id: d.name,
    title: String(d.title),
    permalink: String(d.permalink),
    createdUtc: Number(d.created_utc),
    author: d.author ? String(d.author) : null,
    flair: d.link_flair_text ? String(d.link_flair_text) : null,
    text: String(d.selftext ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    picture: extractPicture(d),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Monthly rent from text. Requires an explicit $ amount; bare numbers are
 * too ambiguous (street numbers, square feet, dates).
 */
function priceFrom(text: string): number | null {
  for (const m of text.matchAll(/\$\s*([\d][\d.,]*)(\s*k)?/gi)) {
    let value = Number(m[1].replace(/,/g, ""));
    if (m[2]) value *= 1000;
    value = Math.round(value);
    if (value >= MIN_MONTHLY_PRICE && value <= MAX_PRICE) return value;
  }
  return null;
}

/**
 * Classifies a post as a listing (returning its price) or not (null).
 * A price in the title is the signature of a real listing. A price only in
 * the body is weaker (scam discussions and advice threads quote rents too),
 * so it additionally needs listing context: a unit type or a location.
 */
function extractPrice(post: RedditPost, flairIsListing: boolean): number | null {
  const titlePrice = priceFrom(post.title);
  if (titlePrice != null) return titlePrice;

  const bodyPrice = priceFrom(post.text);
  if (bodyPrice == null) return null;
  const hasContext =
    flairIsListing ||
    extractCategory(post) != null ||
    detectBorough({ title: post.title, address: post.text }) != null;
  return hasContext ? bodyPrice : null;
}

function extractCategory(post: RedditPost): string | null {
  const text = `${post.title} ${post.text}`;
  if (/\bstudio\b/i.test(text)) return "Studio";
  // (?<![\d.]) keeps "1.5 bedroom" from reading as "5BR".
  const beds = text.match(/(?<![\d.])(\d)\s*(?:br|bd|bed(?:room)?s?)\b/i);
  if (beds) return `${beds[1]}BR`;
  if (/\broom(?:mate)?s?\b/i.test(text)) return "Room";
  return null;
}

/** Posts by people searching for housing rather than offering it. */
function isSeekerPost(post: RedditPost): boolean {
  return /\b(?:looking for|looking to|searching|in search of|iso|apartment hunt(?:ing)?|any takers|seeking|wanted|need a|recommendations?)\b/i.test(
    post.title,
  );
}

/**
 * Flair supplements the text heuristics: a non-listing flair rejects the
 * post outright, and a listing-type flair counts as listing context for
 * posts whose price only appears in the body. It never overrides the
 * seeker-post check ("ISO ..." posts get listing flairs too).
 */
function flairVerdict(flair: string | null): "listing" | "reject" | "unknown" {
  if (!flair) return "unknown";
  const f = flair.toLowerCase();
  if (/advice|question|discussion|rant|vent|meme|news|scam|looking|request|wanted|iso/.test(f)) {
    return "reject";
  }
  if (/listing|for rent|sublet|lease|no fee|apartment/.test(f)) return "listing";
  return "unknown";
}

/**
 * Flair labels the type directly when it names one; otherwise the shared
 * text classifier decides from title + body.
 */
function extractListingType(post: RedditPost): ListingType {
  const flair = post.flair?.toLowerCase() ?? "";
  if (/room|share/.test(flair)) return "room";
  if (/sublet|sublease|short.?term|temporary/.test(flair)) return "sublet";
  if (/apartment|listing|for rent|lease|no fee/.test(flair)) return "apartment";
  return detectListingType({
    title: post.title,
    text: post.text,
    category: extractCategory(post),
  });
}

function toRow(post: RedditPost, price: number, scrapedAt: string): ListingRow {
  const category = extractCategory(post);
  const listingType = extractListingType(post);
  const createdAt = new Date(post.createdUtc * 1000);
  return {
    source: "reddit",
    ext_id: post.id,
    title: post.title,
    address: null,
    price,
    category,
    listing_type: listingType,
    // Post bodies often mention laundry and sublet dates; the shared
    // fallbacks in upsertRows only see the title.
    laundry: detectLaundry({ title: post.title, text: post.text }),
    available_until:
      listingType === "sublet"
        ? extractAvailableUntil(`${post.title}\n${post.text}`, createdAt)
        : null,
    beds: category?.endsWith("BR") ? Number(category[0]) : null,
    bath: null,
    size_sqft: null,
    pictures: post.picture ? [post.picture] : [],
    agent_name: null,
    posted_by: post.author,
    write_dt: createdAt.toISOString(),
    url: `https://www.reddit.com${post.permalink}`,
    scraped_at: scrapedAt,
  };
}

/**
 * Fetches one page of /new.json from inside the browser (same-origin, real
 * fingerprint). Retries transient 403/429 blocks with growing waits.
 */
async function fetchListingPage(
  page: Page,
  after: string | null,
): Promise<{ posts: RedditPost[]; after: string | null }> {
  const url =
    `https://www.reddit.com/r/${SUBREDDIT}/new.json?limit=100&raw_json=1` +
    (after ? `&after=${after}` : "");

  for (let attempt = 0; ; attempt++) {
    const result = await page.evaluate(async (u: string) => {
      const res = await fetch(u, { headers: { accept: "application/json" } });
      return {
        status: res.status,
        body: res.ok ? await res.json() : null,
      };
    }, url);

    if (result.status === 200 && result.body) {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const children: any[] = result.body?.data?.children ?? [];
      const posts = children
        .filter((c) => c?.kind === "t3")
        .map((c) => toPost(c.data))
        .filter((p): p is RedditPost => p != null);
      return { posts, after: result.body?.data?.after ?? null };
    }

    if (attempt >= FETCH_RETRIES) {
      throw new Error(
        `HTTP ${result.status} fetching ${url} (still blocked after ${FETCH_RETRIES} retries)`,
      );
    }
    const waitMs = 15_000 * 2 ** attempt;
    console.warn(
      `  Blocked (${result.status}); waiting ${waitMs / 1000}s before retry ${attempt + 1}/${FETCH_RETRIES}...`,
    );
    await sleep(waitMs);
  }
}

async function main() {
  const cutoff = getCutoff();
  const scrapedAt = new Date().toISOString();
  console.log(`Scraping r/${SUBREDDIT} via Playwright (JSON endpoint)`);
  if (DRY_RUN) console.log("DRY RUN: no database writes will be made.\n");

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const rowsById = new Map<string, ListingRow>();
  let seen = 0;
  let skippedNotListing = 0;

  try {
    // Land on the subreddit first so Reddit sets its cookies and any
    // bot-check runs against a real page load, then reuse that session for
    // the JSON calls.
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);

    let after: string | null = null;
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const batch = await fetchListingPage(page, after);
      seen += batch.posts.length;
      let reachedCutoff = false;

      for (const post of batch.posts) {
        if (new Date(post.createdUtc * 1000) < cutoff) {
          reachedCutoff = true;
          continue;
        }
        const verdict = flairVerdict(post.flair);
        if (verdict === "reject" || isSeekerPost(post)) {
          skippedNotListing++;
          continue;
        }
        const price = extractPrice(post, verdict === "listing");
        if (price == null) {
          skippedNotListing++;
          continue; // advice threads, no-price posts
        }
        rowsById.set(post.id, toRow(post, price, scrapedAt));
      }

      console.log(
        `Page ${pageNum}: ${batch.posts.length} posts (${rowsById.size} listings kept so far)`,
      );
      after = batch.after;
      // /new is chronological, so the first post past the cutoff means all
      // later pages are older still.
      if (!after || reachedCutoff || batch.posts.length === 0) break;
      await sleep(PAGE_DELAY_MS);
    }
  } finally {
    await browser.close();
  }

  const rows = [...rowsById.values()];
  console.log(
    `${seen} posts fetched, ${rows.length} kept as listings (${skippedNotListing} skipped: seekers, advice, no price).`,
  );

  if (DRY_RUN) {
    console.log("Sample row:", JSON.stringify(rows[0], null, 2));
    return;
  }

  const db = getServiceClient();
  const upserted = await upsertRows(db, rows);
  // The feed only shows recent posts, so absence doesn't mean delisted;
  // old rows age out by write_dt instead.
  const pruned = await pruneStale(db, "reddit", cutoff);
  console.log(`Upserted ${upserted} rows, pruned ${pruned} stale rows. Done.`);
  await revalidateListings();
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
