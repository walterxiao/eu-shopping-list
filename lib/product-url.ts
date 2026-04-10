import type { Region } from "./types";

export interface ParsedProductUrl {
  /** Hostname from the URL, lowercased (e.g. "www.rimowa.com"). */
  host: string;
  /**
   * Extracted product identifier — stable (ideally) across regions for
   * the same brand. For Rimowa this is a 6–8 digit number; for Moncler
   * it's an alphanumeric string like "L10911A001605968E742"; for Amazon
   * it's an ASIN like "B0CHX1W1TX".
   */
  productCode: string;
  /** Internal bucket: "EU" or "US". */
  sourceRegion: Region;
  /** 2-letter ISO country code if the URL encoded one (e.g. "it"). */
  sourceCountry?: string;
  /**
   * VAT rate derived from the country code (EU only); undefined for
   * US URLs and for pan-EU URLs without a country.
   */
  euVatRate?: number;
}

export class ProductUrlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductUrlParseError";
  }
}

/**
 * Standard VAT rates (2024) for every Eurozone country. Used by the
 * analysis step to strip VAT from the raw EU sticker price.
 */
export const EUROZONE_VAT: Record<string, number> = {
  at: 0.20,
  be: 0.21,
  cy: 0.19,
  de: 0.19,
  ee: 0.22,
  es: 0.21,
  fi: 0.24,
  fr: 0.20,
  gr: 0.24,
  hr: 0.25,
  ie: 0.23,
  it: 0.22,
  lt: 0.21,
  lu: 0.17,
  lv: 0.21,
  mt: 0.18,
  nl: 0.21,
  pt: 0.23,
  si: 0.22,
  sk: 0.20,
};

/**
 * 2-letter codes for regions we explicitly don't support because their
 * currency isn't EUR or USD. Mapping values are used in error messages.
 */
const NON_EUR_USD_REJECT: Record<string, string> = {
  uk: "UK (GBP) is not supported — only Eurozone and US sites are.",
  gb: "UK (GBP) is not supported — only Eurozone and US sites are.",
  ch: "Switzerland (CHF) is not supported — only Eurozone and US sites are.",
  jp: "Japan (JPY) is not supported — only Eurozone and US sites are.",
  kr: "Korea (KRW) is not supported — only Eurozone and US sites are.",
  cn: "China (CNY) is not supported — only Eurozone and US sites are.",
  sg: "Singapore (SGD) is not supported — only Eurozone and US sites are.",
  hk: "Hong Kong (HKD) is not supported — only Eurozone and US sites are.",
  ca: "Canada (CAD) is not supported — only Eurozone and US sites are.",
  au: "Australia (AUD) is not supported — only Eurozone and US sites are.",
  ae: "UAE (AED) is not supported — only Eurozone and US sites are.",
  sa: "Saudi Arabia (SAR) is not supported — only Eurozone and US sites are.",
};

/**
 * Try to recognize a single path segment as a region hint.
 *
 * Handles:
 *   - `eu`              → EU (pan-EU, no country)
 *   - `us`, `us-en`, `en-us` → US
 *   - `it`, `de`, `fr`, … → EU with the country's VAT rate
 *   - `it-it`, `en-it`, `de-de`, `en-de`, … → EU with the country's VAT
 *   - `uk`, `gb`, `en-gb`, `ch`, `jp`, … → reject (returns error string)
 *   - anything else → null (no match)
 */
interface RegionMatch {
  region: Region;
  country?: string;
  vatRate?: number;
}
type SegmentResult = RegionMatch | { reject: string } | null;

function detectRegion(rawSegment: string): SegmentResult {
  const s = rawSegment.toLowerCase();

  // Bare single-token codes
  if (s === "eu") return { region: "EU" };
  if (s === "us" || s === "us-en" || s === "en-us") return { region: "US" };
  if (EUROZONE_VAT[s] !== undefined) {
    return { region: "EU", country: s, vatRate: EUROZONE_VAT[s] };
  }
  if (NON_EUR_USD_REJECT[s] !== undefined) {
    return { reject: NON_EUR_USD_REJECT[s] };
  }

  // Hyphenated locale like "it-it", "en-it", "de-de", "en-gb".
  if (/^[a-z]{2}-[a-z]{2}$/.test(s)) {
    const parts = s.split("-");
    // Rejects take priority — "en-gb" should fail with a GBP reason
    // rather than silently dropping the `gb`.
    for (const part of parts) {
      if (NON_EUR_USD_REJECT[part] !== undefined) {
        return { reject: NON_EUR_USD_REJECT[part] };
      }
    }
    for (const part of parts) {
      if (part === "us") return { region: "US" };
      if (part === "eu") return { region: "EU" };
      if (EUROZONE_VAT[part] !== undefined) {
        return {
          region: "EU",
          country: part,
          vatRate: EUROZONE_VAT[part],
        };
      }
    }
  }

  return null;
}

/**
 * Extract a product code from the URL path. Tries multiple patterns
 * against each path segment (scanning from last to first) and returns
 * the first match. Handles:
 *   - trailing 6+ digit numbers (Rimowa: "…/92552634.html")
 *   - dash-prefixed alphanumerics (Moncler: "…-L10911A001605968E742.html")
 *   - bare alphanumeric tokens (Amazon: "…/dp/B0CHX1W1TX")
 */
function extractProductCode(segments: string[]): string | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const cleaned = segments[i].replace(/\.(html?|php)$/i, "");

    // 1) Trailing 6+ digit number
    const numMatch = cleaned.match(/(\d{6,})$/);
    if (numMatch) return numMatch[1];

    // 2) Trailing alphanumeric after a dash (5+ chars, must include at
    //    least one letter and one digit to avoid false positives on
    //    pure words like "-hooded")
    const dashMatch = cleaned.match(/-([A-Z0-9]{5,})$/i);
    if (dashMatch && /\d/.test(dashMatch[1]) && /[A-Z]/i.test(dashMatch[1])) {
      return dashMatch[1];
    }

    // 3) Whole segment is an alphanumeric token (5+ chars, mixed)
    if (
      /^[A-Z0-9]{5,}$/i.test(cleaned) &&
      /\d/.test(cleaned) &&
      /[A-Z]/i.test(cleaned)
    ) {
      return cleaned;
    }
  }
  return null;
}

/**
 * Parse any e-commerce product URL and extract what we can for
 * cross-region price comparison. Throws {@link ProductUrlParseError}
 * with a user-facing reason when the URL can't be understood or
 * targets an unsupported currency region.
 *
 * Examples that parse successfully:
 *   https://www.rimowa.com/eu/en/luggage/cabin/.../92552634.html
 *   https://www.rimowa.com/us-en/.../92552634.html
 *   https://www.rimowa.com/it/it/luggage/.../97353004.html
 *   https://www.moncler.com/en-us/men/.../…-L10911A001605968E742.html
 *   https://www.moncler.com/it-it/men/.../…-L10911A001605968E742.html
 */
export function parseProductUrl(input: string): ParsedProductUrl {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ProductUrlParseError("URL is empty");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ProductUrlParseError("Not a valid URL");
  }

  // Accept http and https; reject anything exotic (mailto, ftp, etc.).
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProductUrlParseError(
      `Only http(s) URLs are supported, got ${url.protocol}`,
    );
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new ProductUrlParseError("URL has no path");
  }

  // Scan the first few segments for a region hint. Most sites put
  // the locale in segment 0 or 1 (e.g. "/eu/en/…" or "/shop/en-us/…").
  let matched: RegionMatch | null = null;
  for (let i = 0; i < Math.min(segments.length, 3); i++) {
    const result = detectRegion(segments[i]);
    if (!result) continue;
    if ("reject" in result) {
      throw new ProductUrlParseError(result.reject);
    }
    matched = result;
    break;
  }
  if (!matched) {
    throw new ProductUrlParseError(
      "Could not detect region from URL. Expected a locale segment " +
        "like /eu/, /us-en/, /en-us/, /it-it/, /de-de/, …",
    );
  }

  const productCode = extractProductCode(segments);
  if (!productCode) {
    throw new ProductUrlParseError(
      "No product code found in URL. Expected a trailing numeric code " +
        "(e.g. 92552634) or an alphanumeric SKU (e.g. L10911A001605968E742).",
    );
  }

  return {
    host,
    productCode,
    sourceRegion: matched.region,
    sourceCountry: matched.country,
    euVatRate: matched.vatRate,
  };
}
