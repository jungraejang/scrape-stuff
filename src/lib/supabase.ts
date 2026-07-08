import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
  pictures: string[] | null;
  agent_name: string | null;
  posted_by: string | null;
  write_dt: string | null;
  url: string;
  scraped_at: string;
}

/** Returns null when Supabase env vars are not configured yet. */
export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, { auth: { persistSession: false } });
}
