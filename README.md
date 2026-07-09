# NYC Rental Scraper + Viewer

Scrapes housing rental listings from [HeyKorean](https://rent.heykorean.com), [Zillow](https://www.zillow.com), [StreetEasy](https://streeteasy.com), and [Craigslist](https://www.craigslist.org), stores them in a single Supabase table, and displays them in a Next.js web app with source and category filters.

- **HeyKorean**: NY area, max $3,000/mo (categories: room share, 1BR, etc.), last 2 months
- **Zillow**: Queens / Brooklyn / Bronx regions, 2+ beds, max $3,000/mo, last 2 months
- **StreetEasy**: Manhattan / Brooklyn / Queens / Bronx, max $3,000/mo, all currently active listings
- **Craigslist**: New York area, apartments/housing, max $3,000/mo, all currently active posts
- **Facebook Marketplace**: NYC property rentals, max $3,000/mo (requires a one-time Facebook login; see below)

## How it works

1. `npm run scrape` pulls HeyKorean listings from their JSON API.
2. `npm run scrape:zillow` pulls Zillow listings by reading the `__NEXT_DATA__` JSON embedded in the search result pages (Zillow's real API is bot-protected, but the pages themselves are not). It searches region by region because Zillow caps any single search at 20 pages.
3. `npm run scrape:streeteasy` pulls StreetEasy listings from their GraphQL API (api-v6.streeteasy.com), which accepts cookie-less requests. StreetEasy only returns currently active listings, so instead of an age cutoff, listings are removed when they go off market. The date shown is the listing's availability date.
4. `npm run scrape:craigslist` pulls Craigslist posts from their search API (sapi.craigslist.org), which also accepts cookie-less requests but returns a compact encoded format that the scraper decodes. A single search returns at most 360 results, so it searches one price band at a time and merges. Posts expire after ~30-45 days, so removed/expired posts are pruned when they stop appearing.
5. `npm run scrape:facebook` drives a real Chromium browser with Playwright (Facebook blocks plain HTTP clients entirely), loads the Marketplace rentals search, scrolls to load results, and extracts the listing cards from the page. Requires running `npm run fb:login` once first.
6. All five upsert into the shared `listings` table keyed on `(source, ext_id)` — re-running refreshes data without duplicates — and prune their own stale rows.
7. The Next.js frontend reads from Supabase and shows a card grid with source filters, category filters, a $2,000 price-cap toggle, and price/date sorting. Each card links to the original listing.

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com), sign in, and create a new (free) project.
2. In the dashboard, open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates the `listings` table with row-level security (public read, service-role-only writes). Re-running it later drops and recreates the table (fine — the scrapers regenerate all data).

### 2. Configure environment variables

Copy the example env file and fill in your values:

```powershell
Copy-Item .env.local.example .env.local
```

Find the values in the Supabase dashboard under **Project Settings -> API Keys**:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` / `public` key (used by the frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key (used only by the scrapers — keep secret) |

### 3. Install dependencies

```powershell
npm install
```

## Usage

### Scrape listings

```powershell
npm run scrape              # HeyKorean
npm run scrape:zillow       # Zillow
npm run scrape:streeteasy   # StreetEasy
npm run scrape:craigslist   # Craigslist
npm run scrape:facebook     # Facebook Marketplace (needs fb:login first)
```

### Facebook Marketplace setup (one time)

Facebook requires a logged-in session. Run:

```powershell
npx playwright install chromium   # if Playwright says the browser is missing
npm run fb:login
```

A browser window opens — log in to Facebook there (2FA included). The session is saved to `fb-session.json` (gitignored; contains your login cookies, keep it private). Then `npm run scrape:facebook` works headlessly. Re-run `fb:login` if the session expires.

**Warning:** scraping Marketplace violates Facebook's ToS and can get the account flagged or banned. Keep `SCRAPE_FB_SCROLLS` modest (default 12), don't run it in a tight loop, and prefer a non-primary account. Use `npm run scrape:facebook -- --headed` to watch the browser when debugging.

To test a scraper without writing to the database, add `-- --dry-run`:

```powershell
npm run scrape:zillow -- --dry-run
```

Optional tuning via `.env.local`:

- `SCRAPE_CUTOFF_MONTHS` — ignore listings older than this (default 3, HeyKorean/Zillow/Craigslist)
- `SCRAPE_MAX_PAGES` — hard cap on pages fetched per run (default 100, HeyKorean only)
- `SCRAPE_FB_SCROLLS` — scroll rounds on Facebook Marketplace (default 12; more scrolls = more listings)

### Run the site

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The page revalidates every 5 minutes, so re-run the scrapers any time to refresh data.

## Notes

- **HeyKorean TLS quirk**: heykorean.com serves an incomplete certificate chain, so the scrape scripts run Node with the `--use-system-ca` flag (already baked into the npm scripts).
- **Zillow bot protection**: Zillow's JSON API is guarded by PerimeterX and will 403 outside a browser. The scraper instead reads the search page HTML, which works without cookies at gentle request rates (~1.5s delay between pages). If Zillow ever starts blocking, the scraper fails loudly with a clear error rather than storing bad data. Scraping Zillow is against their terms of service — keep this for personal use.
- **Filters** are constants at the top of [`scripts/scrape.ts`](scripts/scrape.ts) (HeyKorean: category ids, price, area code), [`scripts/scrape-zillow.ts`](scripts/scrape-zillow.ts) (Zillow: region ids, `FILTER_STATE`), [`scripts/scrape-streeteasy.ts`](scripts/scrape-streeteasy.ts) (StreetEasy: area ids, max price), and [`scripts/scrape-craigslist.ts`](scripts/scrape-craigslist.ts) (Craigslist: category, price bands) — edit them there to change what gets scraped.
- **Zillow "Building" cards** are multi-unit apartment buildings. They have no listing date, so they're always kept while present in search results and removed when they disappear.
- Listing photos are served from `data.heykorean.com`, `photos.zillowstatic.com`, `maps.googleapis.com` (Zillow's photo placeholder), `photos.streeteasy.com`, `images.craigslist.org`, and `*.fbcdn.net` (allowed in `next.config.ts` for `next/image`). Facebook photo URLs are signed and expire after a few days — re-running the scrape refreshes them.
- Facebook listings have no posting date (search cards don't expose one), so they sort at the end under "Newest" and are kept while they remain in search results.
