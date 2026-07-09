import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Only the columns the frontend renders. Keeping this lean matters: the full
 * listing set is cached as one unstable_cache entry with a 2MB limit.
 */
export interface Listing {
  source: "heykorean" | "zillow" | "streeteasy" | "craigslist" | "facebook" | "reddit";
  ext_id: string;
  title: string | null;
  address: string | null;
  borough: string | null;
  price: number | null;
  category: string | null;
  beds: number | null;
  bath: number | null;
  size_sqft: number | null;
  /** Trimmed to the first photo; the UI never shows more. */
  pictures: string[] | null;
  write_dt: string | null;
  url: string;
}

export const LISTING_COLUMNS =
  "source,ext_id,title,address,borough,price,category,beds,bath,size_sqft,pictures,write_dt,url";

/** Returns null when Supabase env vars are not configured yet. */
export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, { auth: { persistSession: false } });
}
