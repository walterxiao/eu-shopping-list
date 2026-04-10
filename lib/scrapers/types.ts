/**
 * Shared types for the Rimowa region-scraper layer.
 *
 * The app compares a single brand (Rimowa) across two "regions" of its own
 * website:
 *   - EU: rimowa.com/eu — EUR, prices include ~19% VAT
 *   - US: rimowa.com/us-en — USD, prices exclude sales tax
 */

export type Region = "EU" | "US";

export interface RegionMeta {
  region: Region;
  /** Human-readable label shown in the UI, e.g. `"Rimowa (EU)"`. */
  displayName: string;
  currency: "EUR" | "USD";
  /** Fraction included in display price. 0.19 for EU, 0 for US. */
  vatRate: number;
  /** Base URL for constructing region-specific product links. */
  baseUrl: string;
}

export interface RimowaProduct {
  /** 6–8 digit Rimowa product code; stable across regions. */
  productCode: string;
  productName: string;
  region: Region;
  currency: "EUR" | "USD";
  /** Price as displayed on the site (EU: incl. VAT; US: pre-sales-tax). */
  priceRaw: number;
  url: string;
  imageUrl?: string;
  scrapedAt: string;
}

export interface FetchOptions {
  /** Hard per-call timeout. Scrapers MUST resolve or throw within this. */
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface RegionScraper {
  meta: RegionMeta;
  /**
   * Fetch product details for a given product code from this region.
   *
   * Contract:
   * - MUST resolve within `options.timeoutMs` or throw.
   * - MUST return `null` when the product does not exist in this region
   *   (do NOT throw for "not found"; throwing is reserved for genuine
   *   scraper failures like network / bot-wall / parse errors).
   */
  fetchByCode(
    productCode: string,
    options: FetchOptions,
  ): Promise<RimowaProduct | null>;
}
