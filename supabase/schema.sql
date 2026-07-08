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
  price int,
  category text,                  -- Studio / 1BR / 2BR / ...
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

-- Row Level Security: anyone can read (frontend uses the anon key),
-- but only the service role key (used by the scrapers) can write.
alter table public.listings enable row level security;

create policy "Public read access"
  on public.listings
  for select
  to anon, authenticated
  using (true);
