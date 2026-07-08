import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Scrapers POST here after a run to refresh the cached listings page.
 * Authorized with a shared secret in the `x-revalidate-secret` header.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-revalidate-secret");
  const expected = process.env.REVALIDATE_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json(
      { ok: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  // Expire immediately: the scraper is an external caller that wants the
  // next visit to serve fresh data (Next 16 two-argument form).
  revalidateTag("listings", { expire: 0 });
  return NextResponse.json({ ok: true, revalidated: true, now: Date.now() });
}
