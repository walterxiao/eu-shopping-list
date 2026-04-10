import type { Region } from "./scrapers/types";

export interface ParsedRimowaUrl {
  /** 6–8 digit product code extracted from the URL path. */
  productCode: string;
  /** Region inferred from the first path segment. */
  sourceRegion: Region;
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

const EU_SEGMENT = /^eu$/i;
const US_SEGMENT = /^(us-en|us)$/i;
// Rimowa product codes observed in the wild are 6–8 digit numeric strings
// appearing as the last path token before `.html` (or as a bare segment).
const PRODUCT_CODE = /\b(\d{6,8})\b/;

/**
 * Parse any rimowa.com product URL and extract `(productCode, sourceRegion)`.
 *
 * Accepted shapes:
 *   https://www.rimowa.com/eu/en/...original-cabin-black/92552634.html
 *   https://www.rimowa.com/us-en/...original-cabin-black/92552634.html
 *   https://www.rimowa.com/eu/fr/...92552634.html
 *
 * Throws {@link RimowaUrlParseError} with a user-facing reason when the
 * input is not a Rimowa URL or is missing a recognizable product code.
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

  const first = segments[0];
  let sourceRegion: Region;
  if (EU_SEGMENT.test(first)) {
    sourceRegion = "EU";
  } else if (US_SEGMENT.test(first)) {
    sourceRegion = "US";
  } else {
    throw new RimowaUrlParseError(
      `Unrecognized region segment "${first}" — expected /eu/... or /us-en/...`,
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

  return { productCode, sourceRegion };
}
