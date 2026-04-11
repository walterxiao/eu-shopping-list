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
   * Tourist refund rate (approximate) — derived from the country code
   * (EU only). Undefined for non-EU URLs and for pan-EU URLs without
   * a country. This is NOT the VAT rate; see EUROZONE_REFUND_RATE
   * below.
   */
  euRefundRate?: number;
  /**
   * Japanese tourist tax-free rate, defaulting to 10% (the full
   * consumption tax) on every JP URL. Defined only for sourceRegion
   * === "JP". Like euRefundRate this can be overridden by the user
   * per-item via the API.
   */
  jpTaxFreeRate?: number;
}

export class ProductUrlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductUrlParseError";
  }
}

/**
 * Approximate net tourist-VAT-refund rate per Eurozone country, as
 * a fraction of the purchase price. When a non-EU visitor claims a
 * tax-free refund at the airport (via Global Blue / Planet / etc.),
 * they don't get the full VAT back — the operator deducts processing
 * fees, so the tourist nets something like 50–70% of the theoretical
 * maximum VAT. For a €1,000 purchase in Italy (22% VAT, €180 gross
 * VAT content), the visitor actually pockets about €120 — a 12% net
 * refund rate.
 *
 * These numbers are rough averages for a ~€1000+ purchase via Global
 * Blue with card refund. Real refunds depend on:
 *   - the refund operator (Global Blue vs Planet vs Premier)
 *   - the purchase amount (tiered fees, smaller → worse)
 *   - cash-at-airport vs card (card is better)
 *   - whether the store has a tax-free partnership at all
 * Treat them as directional estimates, not exact values.
 *
 * For reference the underlying VAT rates are:
 *   AT 20 · BE 21 · CY 19 · DE 19 · EE 22 · ES 21 · FI 24 · FR 20
 *   GR 24 · HR 25 · IE 23 · IT 22 · LT 21 · LU 17 · LV 21 · MT 18
 *   NL 21 · PT 23 · SI 22 · SK 20
 */
export const EUROZONE_REFUND_RATE: Record<string, number> = {
  at: 0.13,
  be: 0.13,
  cy: 0.11,
  de: 0.11,
  ee: 0.14,
  es: 0.13,
  fi: 0.16,
  fr: 0.12,
  gr: 0.15,
  hr: 0.17,
  ie: 0.14,
  it: 0.12,
  lt: 0.13,
  lu: 0.10,
  lv: 0.13,
  mt: 0.11,
  nl: 0.10,
  pt: 0.14,
  si: 0.13,
  sk: 0.12,
};

/**
 * Default Japanese consumption-tax exemption applied to every JP URL.
 * Tourists who present a passport at checkout get the full 10% off
 * (免税 / "menzei"), unlike the EU refund operators which keep some as
 * a fee. The user can still override per item.
 */
export const DEFAULT_JP_TAX_FREE_RATE = 0.10;

/**
 * 2-letter codes for regions we explicitly don't support because their
 * currency isn't EUR / USD / HKD / JPY. Mapping values are used in
 * error messages.
 */
const NON_EUR_USD_REJECT: Record<string, string> = {
  uk: "UK (GBP) is not supported — only Eurozone, US, HK, and JP sites are.",
  gb: "UK (GBP) is not supported — only Eurozone, US, HK, and JP sites are.",
  ch: "Switzerland (CHF) is not supported — only Eurozone, US, HK, and JP sites are.",
  kr: "Korea (KRW) is not supported — only Eurozone, US, HK, and JP sites are.",
  cn: "China (CNY) is not supported — only Eurozone, US, HK, and JP sites are.",
  sg: "Singapore (SGD) is not supported — only Eurozone, US, HK, and JP sites are.",
  ca: "Canada (CAD) is not supported — only Eurozone, US, HK, and JP sites are.",
  au: "Australia (AUD) is not supported — only Eurozone, US, HK, and JP sites are.",
  ae: "UAE (AED) is not supported — only Eurozone, US, HK, and JP sites are.",
  sa: "Saudi Arabia (SAR) is not supported — only Eurozone, US, HK, and JP sites are.",
};

/**
 * Try to recognize a single path segment as a region hint.
 *
 * Handles:
 *   - `eu`              → EU (pan-EU, no country)
 *   - `us`, `us-en`, `en-us` → US
 *   - `jp`, `jp-ja`, `ja-jp`, `en-jp` → JP (with default 10% tax-free)
 *   - `hk`, `hk-en`, `en-hk`, `zh-hk`, `hk-zh` → HK (no tax adjustment)
 *   - `it`, `de`, `fr`, … → EU with the country's refund rate
 *   - `it-it`, `en-it`, `de-de`, `en-de`, … → EU with the country's rate
 *   - `uk`, `gb`, `en-gb`, `ch`, `kr`, … → reject (returns error string)
 *   - anything else → null (no match)
 */
interface RegionMatch {
  region: Region;
  country?: string;
  refundRate?: number;
  jpTaxFreeRate?: number;
}
type SegmentResult = RegionMatch | { reject: string } | null;

function detectRegion(rawSegment: string): SegmentResult {
  const s = rawSegment.toLowerCase();

  // Bare single-token codes
  if (s === "eu") return { region: "EU" };
  if (s === "us" || s === "us-en" || s === "en-us") return { region: "US" };
  if (s === "jp") {
    return { region: "JP", country: "jp", jpTaxFreeRate: DEFAULT_JP_TAX_FREE_RATE };
  }
  if (s === "hk") return { region: "HK", country: "hk" };
  if (EUROZONE_REFUND_RATE[s] !== undefined) {
    return {
      region: "EU",
      country: s,
      refundRate: EUROZONE_REFUND_RATE[s],
    };
  }
  if (NON_EUR_USD_REJECT[s] !== undefined) {
    return { reject: NON_EUR_USD_REJECT[s] };
  }

  // Hyphenated locale like "it-it", "en-it", "de-de", "en-gb",
  // "jp-ja", "ja-jp", "hk-en", "zh-hk".
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
      if (part === "jp") {
        return {
          region: "JP",
          country: "jp",
          jpTaxFreeRate: DEFAULT_JP_TAX_FREE_RATE,
        };
      }
      if (part === "hk") return { region: "HK", country: "hk" };
      if (EUROZONE_REFUND_RATE[part] !== undefined) {
        return {
          region: "EU",
          country: part,
          refundRate: EUROZONE_REFUND_RATE[part],
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
 *   - Trailing 6+ digit numbers (Rimowa: "…/92552634.html")
 *   - Dash-prefixed alphanumerics (Moncler:
 *     "…-L10911A001605968E742.html")
 *   - Leading alphanumerics before a separator (Van Cleef:
 *     "vcarf48700---vintage-alhambra-pendant", Graff:
 *     "RGR1086ALL_RGR1086ALL")
 *   - Bare alphanumeric tokens (Amazon ASIN: "…/dp/B0CHX1W1TX";
 *     Chanel: "…/p/AS6233B24008U8393/…")
 *
 * All alphanumeric patterns require mixed letters AND digits in the
 * captured token so plain words like "-hooded" or "-pendant" don't
 * get misidentified as product codes.
 */
function extractProductCode(segments: string[]): string | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const cleaned = segments[i].replace(/\.(html?|php)$/i, "");

    // 1) Trailing 6+ digit number (Rimowa).
    const numMatch = cleaned.match(/(\d{6,})$/);
    if (numMatch) return numMatch[1];

    // 2) Trailing alphanumeric after a dash (Moncler / Nike).
    const dashMatch = cleaned.match(/-([A-Z0-9]{5,})$/i);
    if (dashMatch && /\d/.test(dashMatch[1]) && /[A-Z]/i.test(dashMatch[1])) {
      return dashMatch[1];
    }

    // 3) Leading alphanumeric followed by `_` or a multi-hyphen `--`
    //    separator (Van Cleef & Arpels uses `CODE---descriptive-slug`;
    //    Graff uses `CODE_CODE`). Requires mixed letters + digits.
    const leadSepMatch = cleaned.match(/^([A-Z0-9]{5,})(?:-{2,}|_)/i);
    if (
      leadSepMatch &&
      /\d/.test(leadSepMatch[1]) &&
      /[A-Z]/i.test(leadSepMatch[1])
    ) {
      return leadSepMatch[1];
    }

    // 4) Whole segment is an alphanumeric token (Amazon, Chanel).
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
 * Path segments that strongly suggest a homepage or landing page
 * rather than a specific product. When URL parsing fails to find a
 * product code and the last segment is one of these, we throw a
 * clearer error instead of the generic "no product code found".
 */
const HOMEPAGE_SEGMENTS = new Set([
  "home",
  "index",
  "shop",
  "store",
  "welcome",
  "category",
  "search",
]);

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
 *   https://www.rimowa.com/jp/ja/luggage-collection-.../83280631.html
 *   https://www.rimowa.com/hk/en/luggage/.../83280631.html
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
    // When code extraction fails, check if the URL looks like a
    // homepage / landing page (either very short path, or the last
    // segment is a generic landing word like "home"). Those cases
    // get a friendlier error pointing the user at a product page.
    const lastCleaned = segments[segments.length - 1]
      .replace(/\.(html?|php)$/i, "")
      .toLowerCase();
    const looksLikeHomepage =
      segments.length <= 2 || HOMEPAGE_SEGMENTS.has(lastCleaned);
    if (looksLikeHomepage) {
      throw new ProductUrlParseError(
        `This looks like a homepage or category page, not a specific product. Browse to an individual item on ${host} and paste that URL instead.`,
      );
    }
    throw new ProductUrlParseError(
      "No product code found in URL. Expected a trailing numeric code " +
        "(e.g. 92552634), an alphanumeric SKU (e.g. L10911A001605968E742), " +
        "or a leading code like 'vcarf48700---…' or 'RGR1086ALL_…'.",
    );
  }

  return {
    host,
    productCode,
    sourceRegion: matched.region,
    sourceCountry: matched.country,
    euRefundRate: matched.refundRate,
    jpTaxFreeRate: matched.jpTaxFreeRate,
  };
}
