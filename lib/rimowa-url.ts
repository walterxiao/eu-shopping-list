import type { Region } from "./scrapers/types";

export interface ParsedRimowaUrl {
  /** 6–8 digit product code extracted from the URL path. */
  productCode: string;
  /** Internal region bucket ("EU" or "US"). */
  sourceRegion: Region;
  /** 2-letter ISO country code from the URL, if the URL was country-scoped. */
  sourceCountry?: string;
  /**
   * VAT rate looked up from the URL's country code. Undefined for the
   * pan-EU `/eu/...` path and for US URLs; callers should fall back to
   * the EU region's default rate in that case.
   */
  euVatRate?: number;
}

/**
 * Error thrown when a URL can't be parsed as a Rimowa product URL. The
 * orchestrator converts these to `{status: "error", reason}` entries so the
 * user sees a clear per-item explanation.
 */
export class RimowaUrlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RimowaUrlParseError";
  }
}

/**
 * Standard VAT rates (2024) for every Eurozone country. Values are used
 * by the orchestrator's analysis step to strip VAT from the raw EU
 * sticker price. Small drift over time is acceptable for this use case.
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
 * Explicit rejects with clear messages naming the currency, so the UI
 * can show "UK (GBP) not supported" instead of a generic "unknown
 * region" for sites that are intentionally out of scope.
 */
const REJECT_WITH_REASON: Record<string, string> = {
  uk: "UK (GBP) is not supported — only Eurozone and US sites are.",
  gb: "UK (GBP) is not supported — only Eurozone and US sites are.",
  ch: "Switzerland (CHF) is not supported — only Eurozone and US sites are.",
  jp: "Japan (JPY) is not supported — only Eurozone and US sites are.",
  kr: "Korea (KRW) is not supported — only Eurozone and US sites are.",
  cn: "China (CNY) is not supported — only Eurozone and US sites are.",
  sg: "Singapore (SGD) is not supported — only Eurozone and US sites are.",
  hk: "Hong Kong (HKD) is not supported — only Eurozone and US sites are.",
  ca: "Canada (CAD) is not supported — only Eurozone and US sites are.",
  "ca-en": "Canada (CAD) is not supported — only Eurozone and US sites are.",
  "ca-fr": "Canada (CAD) is not supported — only Eurozone and US sites are.",
  au: "Australia (AUD) is not supported — only Eurozone and US sites are.",
  "au-en": "Australia (AUD) is not supported — only Eurozone and US sites are.",
  ae: "UAE (AED) is not supported — only Eurozone and US sites are.",
  sa: "Saudi Arabia (SAR) is not supported — only Eurozone and US sites are.",
};

const US_SEGMENT = /^(us-en|us)$/i;
// Rimowa product codes observed in the wild are 6–8 digit numeric strings
// appearing as the last path token before `.html` (or as a bare segment).
const PRODUCT_CODE = /\b(\d{6,8})\b/;

/**
 * Parse any rimowa.com product URL and extract the product code, internal
 * region, and (when present) the source country and its VAT rate.
 *
 * Accepted first-segment shapes:
 *   /eu/...            → EU, no country override (uses DE default)
 *   /us-en/... /us/... → US
 *   /it/it/...         → EU, country "it", VAT 0.22
 *   /de/de/...         → EU, country "de", VAT 0.19
 *   /fr/fr/...         → EU, country "fr", VAT 0.20
 *   (any Eurozone country code from EUROZONE_VAT)
 *
 * Throws {@link RimowaUrlParseError} with a user-facing reason otherwise.
 */
export function parseRimowaUrl(input: string): ParsedRimowaUrl {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new RimowaUrlParseError("URL is empty");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RimowaUrlParseError("Not a valid URL");
  }

  const host = url.hostname.toLowerCase();
  if (host !== "www.rimowa.com" && host !== "rimowa.com") {
    throw new RimowaUrlParseError(
      `Expected a rimowa.com URL, got ${url.hostname}`,
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new RimowaUrlParseError("URL has no path");
  }

  const first = segments[0].toLowerCase();

  let sourceRegion: Region;
  let sourceCountry: string | undefined;
  let euVatRate: number | undefined;

  if (first === "eu") {
    sourceRegion = "EU";
  } else if (US_SEGMENT.test(first)) {
    sourceRegion = "US";
  } else if (first in EUROZONE_VAT) {
    sourceRegion = "EU";
    sourceCountry = first;
    euVatRate = EUROZONE_VAT[first];
  } else if (first in REJECT_WITH_REASON) {
    throw new RimowaUrlParseError(REJECT_WITH_REASON[first]);
  } else {
    throw new RimowaUrlParseError(
      `Unrecognized region segment "${segments[0]}" — expected /eu/, /us-en/, or an Eurozone country code like /it/, /de/, /fr/`,
    );
  }

  // Scan segments right-to-left for the first 6–8 digit numeric token.
  let productCode: string | undefined;
  for (let i = segments.length - 1; i >= 0; i--) {
    const match = segments[i].match(PRODUCT_CODE);
    if (match) {
      productCode = match[1];
      break;
    }
  }

  if (!productCode) {
    throw new RimowaUrlParseError(
      "No product code found in URL (expected a 6–8 digit number)",
    );
  }

  return { productCode, sourceRegion, sourceCountry, euVatRate };
}
