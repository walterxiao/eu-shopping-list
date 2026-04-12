/**
 * Shared domain types for the manual price-tracker app.
 *
 * The user manually enters prices by visiting each retailer's website in
 * a new tab and typing what they see. The backend stores those records;
 * the frontend groups them by (host, productCode) and computes an
 * N-way comparison of the tourist's effective net price across every
 * stored region as a pure client-side step.
 */

export type Region = "EU" | "US" | "HK" | "JP" | "SA";
export type Currency = "EUR" | "USD" | "HKD" | "JPY" | "SAR";

/** A single stored item — one URL + one manually entered price. */
export interface TrackedItem {
  /** Server-generated UUID. */
  id: string;
  /** The original URL the user pasted (kept clickable in the UI). */
  url: string;
  /** Hostname extracted from the URL (e.g. "www.rimowa.com"). */
  host: string;
  /**
   * Product code extracted from the URL. Used together with `host` to
   * pair items across regions for the same product.
   */
  productCode: string;
  /** Internal bucket (`"EU"` or `"US"`). */
  region: Region;
  /** Country code from URLs like `/it/it/` or `/en-us/`; optional. */
  sourceCountry?: string;
  /**
   * Approximate tourist VAT-refund rate for this item's country, used
   * to compute the net price a non-EU traveler actually pays after
   * claiming the refund at the airport. EU only; undefined for US/HK/JP.
   */
  euRefundRate?: number;
  /**
   * US sales tax rate ADDED on top of the sticker price at checkout.
   * Stored as a fraction (e.g. 0.0725 for 7.25% California). US only;
   * undefined for EU/HK/JP/SA items. Defaults to 0 if the user didn't
   * specify.
   */
  salesTaxRate?: number;
  /**
   * Japanese consumption-tax exemption rate SUBTRACTED from the sticker
   * for non-resident tourists who claim tax-free shopping (免税) at
   * checkout. Defaults to 0.10 (the full 10% consumption tax) for JP
   * items; undefined for everything else. Unlike the EU refund this
   * is applied at point of sale with no operator fees, so the full
   * rate goes back.
   */
  jpTaxFreeRate?: number;
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
  /**
   * Sales tax rate as a fraction (US only; ignored for non-US URLs).
   * Defaults to DEFAULT_US_SALES_TAX_RATE if omitted.
   */
  salesTaxRate?: number;
  /**
   * Tourist VAT refund rate as a fraction (EU only; ignored for non-EU
   * URLs). Overrides the country default derived from the URL.
   */
  euRefundRate?: number;
  /**
   * Japanese tourist tax-free rate as a fraction (JP only; ignored
   * elsewhere). Defaults to DEFAULT_JP_TAX_FREE_RATE (0.10) if omitted.
   */
  jpTaxFreeRate?: number;
}

/** Request body for PATCH /api/items/:id — every field optional. */
export interface UpdateItemInput {
  productName?: string;
  priceRaw?: number;
  salesTaxRate?: number;
  euRefundRate?: number;
  jpTaxFreeRate?: number;
}

/**
 * One priced row inside a ComparisonItem. Carries the stored
 * {@link TrackedItem} plus its derived EUR representation (raw sticker
 * and net-after-refund / net-after-tax) so the UI doesn't have to
 * duplicate the math.
 */
export interface ItemPrice {
  /** The underlying stored record. */
  item: TrackedItem;
  /**
   * Sticker price normalized to EUR. For non-EUR items this is
   * `priceRaw * fxRate(currency→EUR)`; for EUR items it's just
   * `priceRaw`. NaN if the FX rate for the item's currency is
   * unavailable.
   */
  rawEur: number;
  /**
   * Net price (in EUR) that a non-EU/non-resident tourist actually
   * pays, all-in.
   *   - EU: rawEur * (1 - euRefundRate)
   *   - US: rawEur * (1 + salesTaxRate)
   *   - JP: rawEur * (1 - jpTaxFreeRate)
   *   - HK: rawEur (no VAT, no sales tax — sticker IS the net)
   *   - SA: rawEur (VAT included, no tourist refund modeled)
   * NaN if `rawEur` is NaN.
   */
  netEur: number;
  /**
   * Original USD sticker for US items — kept so the UI can show
   * both the dollar number and its EUR conversion side-by-side.
   * Undefined for non-USD items.
   */
  rawUsd?: number;
  /**
   * Original JPY sticker for JP items. Undefined for non-JPY items.
   */
  rawJpy?: number;
  /**
   * Original HKD sticker for HK items. Undefined for non-HKD items.
   */
  rawHkd?: number;
  /**
   * Original SAR sticker for SA items. Undefined for non-SAR items.
   */
  rawSar?: number;
  /**
   * Signed difference between this row's `netEur` and the cheapest
   * US row's `netEur` in the same card, in EUR. Negative = this row
   * is cheaper than US after all adjustments. Undefined for US rows
   * (they are the baseline) and for every row if the card has no
   * finite-netEur US row.
   */
  diffVsUsEur?: number;
  /**
   * The same difference expressed as a percent of the US baseline.
   * Undefined under the same conditions as `diffVsUsEur`.
   */
  diffVsUsPercent?: number;
}

/**
 * One row in the comparison view: all stored prices for a single
 * product, across any number of regions. Produced by `lib/compute.ts`
 * from the full `TrackedItem[]` list and the current FX rate.
 */
export interface ComparisonItem {
  host: string;
  productCode: string;
  productName: string;
  /**
   * Every stored price for this (host, productCode), newest first.
   * Can have 1..N entries — 1 for a single-region product, 2+ for
   * multi-region comparisons.
   */
  prices: ItemPrice[];
  /** The FX rate that was used to convert USD → EUR for this card. */
  fxRate: number | null;
  /** id of the ItemPrice with the lowest `rawEur` (ties: first wins). */
  cheapestRawItemId?: string;
  /** id of the ItemPrice with the lowest `netEur` (ties: first wins). */
  cheapestNetItemId?: string;
}

/** Response body for GET /api/items. */
export interface ListItemsResponse {
  items: TrackedItem[];
}

/** Response body for GET /api/fx. */
export interface FxResponse {
  /** USD → EUR conversion rate. */
  rate: number;
  /** HKD → EUR conversion rate. */
  hkdRate: number;
  /** JPY → EUR conversion rate. */
  jpyRate: number;
  /** SAR → EUR conversion rate. */
  sarRate: number;
  source: "cache" | "live" | "stale" | "fallback";
  fetchedAt: string;
}
