/**
 * One-time backfill: re-hosts existing StreetEasy lead photos in Supabase
 * Storage. Extracts each photo key from the photos.streeteasy.com URL that
 * is already stored on the row, downloads the image from Zillow's open CDN
 * (photos.zillowstatic.com serves the same keys without bot protection),
 * uploads to the public bucket, and points the row at the re-hosted copy.
 *
 * Safe to re-run: rows already pointing at Supabase Storage are skipped,
 * and stored objects are reused without re-downloading.
 *
 * Run: node --use-system-ca --import tsx scripts/backfill-se-photos.ts
 */
import { BROWSER_HEADERS, getServiceClient, sleep } from "./lib";
import {
  ensurePhotoBucket,
  listStoredPhotos,
  publicPhotoUrl,
  uploadPhoto,
} from "./photo-store";

const PHOTO_DELAY_MS = 300;

async function main() {
  const db = getServiceClient();
  await ensurePhotoBucket(db);
  const stored = await listStoredPhotos(db, "streeteasy");

  const { data: rows, error } = await db
    .from("listings")
    .select("ext_id, pictures")
    .eq("source", "streeteasy");
  if (error) throw new Error(error.message);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    const first: string | undefined = (row.pictures as string[] | null)?.[0];
    const key = first?.match(/photos\.streeteasy\.com\/([0-9a-f]+)_1\.jpg/)?.[1];
    if (!key) {
      skipped++; // no photo, or already re-hosted
      continue;
    }

    const name = `${key}.jpg`;
    const path = `streeteasy/${name}`;
    if (!stored.has(name)) {
      try {
        const res = await fetch(
          `https://photos.zillowstatic.com/fp/${key}-se_large_800_400.jpg`,
          { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(20_000) }
        );
        if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) {
          throw new Error(`HTTP ${res.status}`);
        }
        await uploadPhoto(db, path, Buffer.from(await res.arrayBuffer()), "image/jpeg");
        stored.add(name);
      } catch (err) {
        failed++;
        console.warn(`  ${row.ext_id} (${key}): ${(err as Error).message}`);
        continue;
      } finally {
        await sleep(PHOTO_DELAY_MS);
      }
    }

    const { error: updateError } = await db
      .from("listings")
      .update({ pictures: [publicPhotoUrl(db, path)] })
      .eq("source", "streeteasy")
      .eq("ext_id", row.ext_id);
    if (updateError) throw new Error(updateError.message);
    updated++;
    if (updated % 25 === 0) console.log(`  ${updated} done...`);
  }

  console.log(`\nDone. Re-hosted ${updated}, skipped ${skipped}, failed ${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
