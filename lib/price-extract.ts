/**
 * Server-side product price extractor.
 *
 * Fetches a retailer URL with browser-like headers and pulls the
 * sticker price out of the HTML using three strategies, in order of
 * reliability:
 *
 *   1. JSON-LD structured data — `<script type="application/ld+json">`
 *      blocks containing schema.org Product/Offer entities. Most
 *      modern retailers (Rimowa, Moncler, Chanel, Van Cleef, …) ship
 *      this for SEO. Highest signal, lowest false-positive rate.
 *
 *   2. OpenGraph meta tags — `<meta property="product:price:amount">`
 *      and `product:price:currency`. Common second-line signal.
 *
 *   3. HTML microdata — `itemprop="price"` / `itemprop="priceCurrency"`
 *      with a `content` attribute. Older sites still use this.
 *
 * If none of those find a price, the extractor returns null. We do
 * NOT fall back to scraping visible text — that's how you accidentally
 * pick up a "20% off" badge or a related-product price. The user can
 * paste the price manually, which is what they'd do today.
 *
 * Sites behind heavy bot protection (Cloudflare, Akamai, etc.) will
 * generally refuse our request and the caller should surface a
 * graceful error so the user can fall back to manual entry.
 */

export class PriceExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceExtractError";
  }
}

export interface ExtractedPrice {
  priceRaw: number;
  currency: "EUR" | "USD";
}

const FETCH_TIMEOUT_MS = 12_000;

const FETCH_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
};

/**
 * Fetch a URL and return the extracted price + currency. Throws
 * {@link PriceExtractError} on any user-actionable failure (bad URL,
 * network error, site refused, no price found, unsupported currency).
 */
export async function fetchAndExtractPrice(
  url: string,
): Promise<ExtractedPrice> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PriceExtractError("Not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PriceExtractError("URL must use http or https");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(parsed.toString(), {
      headers: FETCH_HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      // Cloudflare returns 403 for blocked requests; surface that
      // verbatim so the user knows it's not a code bug.
      throw new PriceExtractError(
        `Site returned HTTP ${res.status} (likely bot protection — paste price manually)`,
      );
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("html")) {
      throw new PriceExtractError(
        `Expected HTML, got ${contentType.split(";")[0]}`,
      );
    }
    html = await res.text();
  } catch (err) {
    if (err instanceof PriceExtractError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new PriceExtractError(
        `Page took longer than ${FETCH_TIMEOUT_MS / 1000}s to respond`,
      );
    }
    throw new PriceExtractError(
      `Failed to fetch page: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const extracted = extractPriceFromHtml(html);
  if (!extracted) {
    throw new PriceExtractError(
      "Couldn't find a price on that page — paste it manually below",
    );
  }
  return extracted;
}

/**
 * Pure function: try each strategy in order against an HTML string,
 * return the first hit or null. Exposed for unit tests.
 */
export function extractPriceFromHtml(html: string): ExtractedPrice | null {
  return (
    extractFromJsonLd(html) ??
    extractFromOpenGraph(html) ??
    extractFromMicrodata(html) ??
    null
  );
}

// ------------------------------------------------------------------
// Currency + price normalization
// ------------------------------------------------------------------

const SUPPORTED_CURRENCIES = new Set<"EUR" | "USD">(["EUR", "USD"]);

function normalizeCurrency(c: unknown): "EUR" | "USD" | null {
  if (typeof c !== "string") return null;
  const upper = c.trim().toUpperCase();
  if (upper === "EUR" || upper === "USD") return upper;
  // Some sites use the symbol or "EURO"; map the obvious cases.
  if (upper === "EURO" || upper === "€") return "EUR";
  if (upper === "US$" || upper === "$") return "USD";
  return null;
}

/**
 * Parse a price value out of JSON-LD / meta tag content. Accepts
 * numbers directly, plain decimal strings ("1190.00"), and locale-
 * formatted strings ("1.190,00" or "1,190.00") in case a publisher
 * stuffed a localized display value into JSON-LD.
 */
function normalizePrice(p: unknown): number | null {
  if (typeof p === "number" && Number.isFinite(p) && p > 0) return p;
  if (typeof p !== "string") return null;
  const cleaned = p.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  let normalized: string;
  if (cleaned.includes(".") && cleaned.includes(",")) {
    // Last separator is the decimal one — same heuristic as parsePrice.
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (cleaned.includes(",")) {
    // Single-separator comma — could be decimal ("5,95") or thousands
    // ("1,190"). Check the trailing group length: 3 → thousands, else
    // decimal.
    const [whole, frac] = cleaned.split(",");
    normalized = frac && frac.length === 3 ? whole + frac : `${whole}.${frac}`;
  } else if (cleaned.includes(".")) {
    const [whole, frac] = cleaned.split(".");
    normalized = frac && frac.length === 3 ? whole + frac : `${whole}.${frac}`;
  } else {
    normalized = cleaned;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// ------------------------------------------------------------------
// Strategy 1: JSON-LD
// ------------------------------------------------------------------

function extractFromJsonLd(html: string): ExtractedPrice | null {
  // <script type="application/ld+json">…</script> — type may have
  // extra whitespace or be quoted with " or '. The body is JSON, but
  // some publishers wrap it in a CDATA section.
  const scriptRe =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    let raw = match[1].trim();
    // Strip CDATA wrappers if present.
    raw = raw
      .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\/\s*/, "")
      .replace(/\s*\/\*\s*\]\]>\s*\*\/\s*$/, "")
      .replace(/^\s*<!\[CDATA\[/, "")
      .replace(/\]\]>\s*$/, "");
    if (!raw) continue;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    const found = walkJsonLd(json);
    if (found) return found;
  }
  return null;
}

/**
 * Recursively walk a JSON-LD value looking for an object that has both
 * `price` and `priceCurrency` (i.e. an Offer). Handles arrays,
 * `@graph` wrappers, and nested `offers` keys transparently.
 */
function walkJsonLd(node: unknown): ExtractedPrice | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walkJsonLd(item);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;

  // If this object itself looks like an Offer, prefer it.
  const directPrice = normalizePrice(obj.price);
  const directCurrency = normalizeCurrency(obj.priceCurrency);
  if (directPrice !== null && directCurrency !== null) {
    return { priceRaw: directPrice, currency: directCurrency };
  }

  // Recurse into every nested object/array. Order matters loosely —
  // we want to prefer offers/itemOffered over arbitrary keys, so we
  // visit those first.
  const preferredKeys = ["offers", "itemOffered", "@graph", "mainEntity"];
  for (const key of preferredKeys) {
    if (key in obj) {
      const found = walkJsonLd(obj[key]);
      if (found) return found;
    }
  }
  for (const [key, value] of Object.entries(obj)) {
    if (preferredKeys.includes(key)) continue;
    if (typeof value === "object" && value !== null) {
      const found = walkJsonLd(value);
      if (found) return found;
    }
  }
  return null;
}

// ------------------------------------------------------------------
// Strategy 2: OpenGraph product:price meta tags
// ------------------------------------------------------------------

function extractFromOpenGraph(html: string): ExtractedPrice | null {
  const amount =
    extractMetaContent(html, "product:price:amount") ??
    extractMetaContent(html, "og:price:amount");
  const currency =
    extractMetaContent(html, "product:price:currency") ??
    extractMetaContent(html, "og:price:currency");
  if (!amount || !currency) return null;
  const p = normalizePrice(amount);
  const c = normalizeCurrency(currency);
  if (p === null || c === null) return null;
  return { priceRaw: p, currency: c };
}

/**
 * Find a `<meta>` tag's `content` value by `property` attribute,
 * tolerating any attribute order (`property="x" content="y"` and
 * `content="y" property="x"`).
 */
function extractMetaContent(html: string, property: string): string | null {
  // property=… first, content=… second
  const reA = new RegExp(
    `<meta\\b[^>]*\\bproperty\\s*=\\s*["']${escapeRe(property)}["'][^>]*\\bcontent\\s*=\\s*["']([^"']+)["']`,
    "i",
  );
  const a = reA.exec(html);
  if (a) return a[1];
  // content=… first, property=… second
  const reB = new RegExp(
    `<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*\\bproperty\\s*=\\s*["']${escapeRe(property)}["']`,
    "i",
  );
  const b = reB.exec(html);
  return b ? b[1] : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ------------------------------------------------------------------
// Strategy 3: HTML microdata
// ------------------------------------------------------------------

function extractFromMicrodata(html: string): ExtractedPrice | null {
  const price =
    extractItempropContent(html, "price") ??
    extractItempropContent(html, "lowPrice");
  const currency = extractItempropContent(html, "priceCurrency");
  if (!price || !currency) return null;
  const p = normalizePrice(price);
  const c = normalizeCurrency(currency);
  if (p === null || c === null) return null;
  return { priceRaw: p, currency: c };
}

function extractItempropContent(html: string, name: string): string | null {
  // <span itemprop="price" content="1190.00">…</span> — content first
  // or itemprop first.
  const reA = new RegExp(
    `\\bitemprop\\s*=\\s*["']${escapeRe(name)}["'][^>]*\\bcontent\\s*=\\s*["']([^"']+)["']`,
    "i",
  );
  const a = reA.exec(html);
  if (a) return a[1];
  const reB = new RegExp(
    `\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*\\bitemprop\\s*=\\s*["']${escapeRe(name)}["']`,
    "i",
  );
  const b = reB.exec(html);
  return b ? b[1] : null;
}
