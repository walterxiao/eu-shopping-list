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

/** Helper: compute the VAT-stripped ("net") price for a given region. */
export function toNetPrice(priceRaw: number, region: Region): number {
  const { vatRate } = REGIONS[region];
  if (vatRate === 0) return priceRaw;
  return Math.round((priceRaw / (1 + vatRate)) * 100) / 100;
}
