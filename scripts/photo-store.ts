/**
 * Supabase Storage helpers for re-hosting listing photos that can't be
 * hotlinked from their source CDN (StreetEasy's photos.streeteasy.com is
 * behind PerimeterX and blocks visitors' browsers).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = "listing-photos";

/** Creates the public photo bucket if it doesn't exist yet. */
export async function ensurePhotoBucket(db: SupabaseClient): Promise<void> {
  const { data } = await db.storage.getBucket(PHOTO_BUCKET);
  if (data) return;
  const { error } = await db.storage.createBucket(PHOTO_BUCKET, { public: true });
  // Another concurrent run may have created it between the two calls.
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Creating bucket ${PHOTO_BUCKET} failed: ${error.message}`);
  }
}

/** Returns the names of all objects stored under a prefix (e.g. "streeteasy"). */
export async function listStoredPhotos(db: SupabaseClient, prefix: string): Promise<Set<string>> {
  const names = new Set<string>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage
      .from(PHOTO_BUCKET)
      .list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`Listing ${prefix} photos failed: ${error.message}`);
    for (const obj of data ?? []) names.add(obj.name);
    if (!data || data.length < PAGE) break;
  }
  return names;
}

export async function uploadPhoto(
  db: SupabaseClient,
  path: string,
  bytes: Buffer,
  contentType: string
): Promise<void> {
  const { error } = await db.storage
    .from(PHOTO_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Uploading ${path} failed: ${error.message}`);
}

export function publicPhotoUrl(db: SupabaseClient, path: string): string {
  return db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Removes stored objects under a prefix that are no longer referenced. */
export async function pruneOrphanPhotos(
  db: SupabaseClient,
  prefix: string,
  keepNames: Set<string>
): Promise<number> {
  const stored = await listStoredPhotos(db, prefix);
  const orphans = [...stored].filter((name) => !keepNames.has(name));
  const CHUNK = 100;
  for (let i = 0; i < orphans.length; i += CHUNK) {
    const paths = orphans.slice(i, i + CHUNK).map((name) => `${prefix}/${name}`);
    const { error } = await db.storage.from(PHOTO_BUCKET).remove(paths);
    if (error) throw new Error(`Removing orphan photos failed: ${error.message}`);
  }
  return orphans.length;
}
