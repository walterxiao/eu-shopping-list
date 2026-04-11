import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchAndExtractPrice, PriceExtractError } from "@/lib/price-extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  url: z.string().trim().min(1).max(2048),
});

/**
 * POST /api/extract-price
 *   body:    { url: string }
 *   200:     { priceRaw: number, currency: "EUR" | "USD" }
 *   400:     bad body
 *   422:     extraction failed (bot block, no price found, …) — the
 *            error message is user-facing and should be displayed
 *            verbatim. The client should fall back to manual entry.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await fetchAndExtractPrice(parsed.data.url);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PriceExtractError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
