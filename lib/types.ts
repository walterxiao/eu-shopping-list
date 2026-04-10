import type { Region, RimowaProduct } from "./scrapers/types";

/** POST /api/compare request body. */
export interface CompareRequest {
  urls: string[];
}

/** Computed analysis for a single product (only set when both regions hit). */
export interface ItemAnalysis {
  /** USD→EUR rate used for the conversion. */
  usdToEurRate: number;
  /**
   * The VAT rate used to strip tax from the EU raw price. Normally
   * derived from the URL's country code (e.g. 0.22 for `/it/it/...`),
   * falling back to 0.19 (DE) for pan-EU `/eu/...` URLs.
   */
  euVatRateApplied: number;
  /** EU raw price, already in EUR. */
  euRawEur: number;
  /** US raw price converted to EUR. */
  usRawEur: number;
  /** EU price with VAT removed, in EUR. */
  euNetEur: number;
  /** US price (already net) in EUR. */
  usNetEur: number;
  /** Which region is cheaper when comparing raw (what-you-actually-pay) prices. */
  cheaperRaw: Region;
  /** Absolute savings in EUR when buying from `cheaperRaw`. */
  savingsRawEur: number;
  /** Percent savings relative to the more expensive raw price. */
  savingsRawPercent: number;
  /** Which region is cheaper after VAT/tax normalization. */
  cheaperNormalized: Region;
  savingsNormalizedEur: number;
  savingsNormalizedPercent: number;
}

/** Per-URL result in the comparison response. */
export interface ComparisonItem {
  /** The URL the user pasted. */
  input: string;
  productCode?: string;
  productName?: string;
  eu?: RimowaProduct;
  us?: RimowaProduct;
  /**
   * - `ok`: both regions returned a product, analysis is populated
   * - `partial`: exactly one region returned a product
   * - `not_found`: neither region returned a product
   * - `error`: the URL could not be parsed or a scraper threw
   */
  status: "ok" | "partial" | "not_found" | "error";
  reason?: string;
  analysis?: ItemAnalysis;
}

/** POST /api/compare response body. */
export interface CompareResponse {
  items: ComparisonItem[];
  /** Rate used for every item's analysis (undefined if FX fetch failed). */
  usdToEurRate?: number;
  generatedAt: string;
  /** Top-level notes surfaced in the UI (FX fallback, scraper failures). */
  warnings: string[];
}
