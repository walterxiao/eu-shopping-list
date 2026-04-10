/**
 * Shared domain types for the manual price-tracker app.
 *
 * The user manually enters prices by visiting each retailer's website in
 * a new tab and typing what they see. The backend stores those records;
 * the frontend groups them by (host, productCode) and computes an
 * N-way comparison of the tourist's effective net price across every
 * stored region as a pure client-side step.
 */

export type Region = "EU" | "US";
export type Currency = "EUR" | "USD";

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
   * claiming the refund at the airport. EU only; undefined for US.
   */
  euRefundRate?: number;
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

/**
 * One priced row inside a ComparisonItem. Carries the stored
 * {@link TrackedItem} plus its derived EUR representation (raw sticker
 * and net-after-refund) so the UI doesn't have to duplicate the math.
 */
export interface ItemPrice {
  /** The underlying stored record. */
  item: TrackedItem;
  /**
   * Sticker price normalized to EUR. For USD items this is
   * `priceRaw * fxRate`; for EUR items it's just `priceRaw`. NaN if
   * the FX rate is unavailable for a USD item.
   */
  rawEur: number;
  /**
   * Net price (in EUR) that a non-EU tourist actually pays. For EU
   * items this is `rawEur * (1 - euRefundRate)`; for US items it's
   * the same as `rawEur` because there's no tourist refund. NaN if
   * `rawEur` is NaN.
   */
  netEur: number;
  /**
   * Original USD sticker for US items — kept so the UI can show
   * both the dollar number and its EUR conversion side-by-side.
   * Undefined for EU items.
   */
  rawUsd?: number;
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
  rate: number;
  source: "cache" | "live" | "stale" | "fallback";
  fetchedAt: string;
}
