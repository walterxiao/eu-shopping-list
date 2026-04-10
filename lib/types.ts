/**
 * Shared domain types for the manual price-tracker app.
 *
 * The user manually enters prices by visiting rimowa.com in a new tab
 * and typing what they see. The backend stores those records; the
 * frontend groups them by product code and computes the EU-vs-US
 * comparison analysis (FX + VAT) as a pure client-side step.
 */

export type Region = "EU" | "US";
export type Currency = "EUR" | "USD";

/** A single stored item — one URL + one manually entered price. */
export interface TrackedItem {
  /** Server-generated UUID. */
  id: string;
  /** The original URL the user pasted (kept clickable in the UI). */
  url: string;
  /** 6–8 digit Rimowa product code, parsed from the URL. */
  productCode: string;
  /** Internal bucket (`"EU"` or `"US"`). */
  region: Region;
  /** Country code from URLs like `/it/it/`; undefined for `/eu/...`. */
  sourceCountry?: string;
  /** VAT rate from the country code (EU only); undefined for US. */
  euVatRate?: number;
  /** User-entered display name. */
  productName: string;
  /** User-entered price in the region's native currency. */
  priceRaw: number;
  currency: Currency;
  /** ISO timestamp of the most recent manual update. */
  updatedAt: string;
}

/** Request body for POST /api/items. */
export interface NewItemInput {
  url: string;
  productName: string;
  priceRaw: number;
}

/** Request body for PATCH /api/items/:id — both fields optional. */
export interface UpdateItemInput {
  productName?: string;
  priceRaw?: number;
}

/** Computed analysis for a paired (EU + US) product. */
export interface ItemAnalysis {
  /** USD→EUR rate used for the conversion. */
  usdToEurRate: number;
  /**
   * The VAT rate used to strip tax from the EU raw price. Normally
   * derived from the EU item's `euVatRate` (e.g. 0.22 for `/it/it/...`),
   * falling back to 0.19 (DE) for pan-EU `/eu/...` items.
   */
  euVatRateApplied: number;
  /** EU raw price, already in EUR. */
  euRawEur: number;
  /** US raw price converted to EUR. */
  usRawEur: number;
  /** EU price with VAT removed, in EUR. */
  euNetEur: number;
  /** US price (already pre-sales-tax) in EUR. */
  usNetEur: number;
  /** Which region is cheaper on raw (what-you-actually-pay) prices. */
  cheaperRaw: Region;
  savingsRawEur: number;
  savingsRawPercent: number;
  /** Which region is cheaper after VAT/tax normalization. */
  cheaperNormalized: Region;
  savingsNormalizedEur: number;
  savingsNormalizedPercent: number;
}

/**
 * One row in the comparison grid. Produced by `lib/compute.ts` from
 * the full list of `TrackedItem[]` and the current FX rate.
 *
 * - `ok` → both regions populated, analysis set
 * - `single_eu` → only the EU side exists
 * - `single_us` → only the US side exists
 */
export interface ComparisonItem {
  productCode: string;
  productName: string;
  eu?: TrackedItem;
  us?: TrackedItem;
  analysis?: ItemAnalysis;
  status: "ok" | "single_eu" | "single_us";
}

/** Response body for GET /api/items. */
export interface ListItemsResponse {
  items: TrackedItem[];
}

/** Response body for GET /api/fx. */
export interface FxResponse {
  rate: number;
  source: "cache" | "live" | "stale" | "fallback";
  fetchedAt: string;
}
