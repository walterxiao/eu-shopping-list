import type { Region, RegionMeta } from "./types";

/**
 * Single source of truth for region metadata. Both mock and live scrapers
 * import from here.
 *
 * VAT rate is set to 0.19 for EU (standard German rate, which is what
 * rimowa.com/eu uses as its base). US prices exclude sales tax entirely.
 */
export const REGIONS: Record<Region, RegionMeta> = {
  EU: {
    region: "EU",
    displayName: "Rimowa EU",
    currency: "EUR",
    vatRate: 0.19,
    baseUrl: "https://www.rimowa.com/eu/en",
  },
  US: {
    region: "US",
    displayName: "Rimowa US",
    currency: "USD",
    vatRate: 0,
    baseUrl: "https://www.rimowa.com/us-en",
  },
};

export function getRegionMeta(region: Region): RegionMeta {
  return REGIONS[region];
}

/** Default VAT rate used when a /eu/... URL has no country-code override. */
export const DEFAULT_EU_VAT_RATE = REGIONS.EU.vatRate;
