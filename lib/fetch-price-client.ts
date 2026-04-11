/**
 * Browser-side wrapper around POST /api/extract-price. Returns the
 * parsed price + currency on success, throws on any failure (the
 * Error message is user-facing and safe to display verbatim).
 */
export interface FetchedPrice {
  priceRaw: number;
  currency: "EUR" | "USD";
}

export async function fetchPriceFromUrl(url: string): Promise<FetchedPrice> {
  const res = await fetch("/api/extract-price", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  let body: { priceRaw?: number; currency?: string; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* ignore — handled below */
  }
  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  if (
    typeof body.priceRaw !== "number" ||
    (body.currency !== "EUR" && body.currency !== "USD")
  ) {
    throw new Error("Server returned an unexpected response");
  }
  return { priceRaw: body.priceRaw, currency: body.currency };
}
