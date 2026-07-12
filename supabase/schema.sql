-- Unified rental listings table (HeyKorean + Zillow)
-- Paste this whole file into the Supabase SQL editor and run it.
--
-- NOTE: this drops and recreates the table. That is safe because all data
-- is re-created by running the scrapers again.

drop table if exists public.listings;

create table public.listings (
  source text not null,           -- 'heykorean' | 'zillow'
  ext_id text not null,           -- listing id on the source site
  title text,
  address text,
  borough text,                   -- manhattan/brooklyn/queens/bronx/staten island, null = outside NYC or unknown
  price int,
  category text,                  -- Studio / 1BR / 2BR / ... (unit size)
  listing_type text,              -- apartment | room | sublet
  beds numeric,
  bath numeric,
  size_sqft int,
  pictures jsonb,                 -- array of image URLs
  agent_name text,
  posted_by text,
  write_dt timestamptz,           -- listing date (null for Zillow buildings)
  url text,                       -- link back to the original listing
  scraped_at timestamptz default now(),
  primary key (source, ext_id)
);

create index listings_write_dt_idx on public.listings (write_dt desc nulls last);
create index listings_source_idx on public.listings (source);
create index listings_borough_idx on public.listings (borough);

-- Migration for existing databases created before listing_type existed
-- (idempotent; harmless right after the create table above):
alter table public.listings add column if not exists listing_type text;

-- Row Level Security: anyone can read (frontend uses the anon key),
-- but only the service role key (used by the scrapers) can write.
alter table public.listings enable row level security;

create policy "Public read access"
  on public.listings
  for select
  to anon, authenticated
  using (true);

-- Small key/value table for site-wide metadata. Scrapers stamp
-- key='last_updated' after every successful run; the frontend reads it to
-- show the "Last updated" timestamp. Idempotent: safe to re-run without
-- touching existing data.
create table if not exists public.site_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.site_meta enable row level security;

drop policy if exists "Public read access" on public.site_meta;
create policy "Public read access"
  on public.site_meta
  for select
  to anon, authenticated
  using (true);
