import type {
  ComparisonItem,
  ItemPrice,
  TrackedItem,
} from "./types";

/**
 * Default tourist refund rate applied to pan-EU (`/eu/...`) URLs that
 * don't carry a specific country code. An approximation of the
 * Italian / French / Spanish net refund for a ~€1000 Global Blue
 * purchase.
 */
const DEFAULT_EU_REFUND_RATE = 0.12;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Derive the EUR price representation for a single stored item given
 * the current FX rate. For EU items:
 *   - `rawEur` = priceRaw (already EUR)
 *   - `netEur` = rawEur * (1 - refundRate)
 * For US items:
 *   - `rawUsd` = priceRaw (USD sticker)
 *   - `rawEur` = rawUsd * fxRate
 *   - `netEur` = rawEur (no tourist VAT refund in the US)
 * If fxRate is null and the item is USD, both rawEur and netEur are
 * NaN — the UI shows the raw USD number and a "FX unavailable"
 * indicator.
 */
function priceForItem(
  item: TrackedItem,
  fxRate: number | null,
): ItemPrice {
  if (item.currency === "USD") {
    const rawUsd = item.priceRaw;
    const rawEur = fxRate != null ? round2(rawUsd * fxRate) : NaN;
    // US has no tourist VAT refund; net === raw.
    const netEur = rawEur;
    return { item, rawEur, netEur, rawUsd };
  }
  // EU / EUR
  const rawEur = round2(item.priceRaw);
  const refundRate = item.euRefundRate ?? DEFAULT_EU_REFUND_RATE;
  const netEur = round2(rawEur * (1 - refundRate));
  return { item, rawEur, netEur };
}

/**
 * Group tracked items by (host, productCode) and, for each group,
 * return an N-wide comparison. Every stored item for a product
 * becomes its own row (US, IT, DE, FR, …) so the user can compare
 * three or more regions side-by-side. Pairing is scoped to the same
 * host because product codes from different brands live in different
 * namespaces.
 *
 * Pure function — no React, no side effects, no network. Deterministic
 * for the same `(items, fxRate)` input.
 */
export function groupAndAnalyze(
  items: TrackedItem[],
  fxRate: number | null,
): ComparisonItem[] {
  const groups = new Map<string, TrackedItem[]>();
  for (const item of items) {
    const key = `${item.host}\u0000${item.productCode}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const result: ComparisonItem[] = [];
  for (const groupItems of groups.values()) {
    // Stable display order: newest updates first.
    const sorted = [...groupItems].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    const host = sorted[0].host;
    const productCode = sorted[0].productCode;
    // Prefer the first non-empty productName as the card title.
    const productName =
      sorted.find((x) => x.productName?.trim())?.productName ?? productCode;

    const prices = sorted.map((it) => priceForItem(it, fxRate));

    // Cheapest across every priced row where we actually have a
    // finite number (so USD items during an FX outage are excluded
    // from the winner selection but still shown in the card).
    const withRaw = prices.filter((p) => Number.isFinite(p.rawEur));
    const withNet = prices.filter((p) => Number.isFinite(p.netEur));
    const cheapestRaw =
      withRaw.length > 0
        ? withRaw.reduce((a, b) => (a.rawEur <= b.rawEur ? a : b))
        : undefined;
    const cheapestNet =
      withNet.length > 0
        ? withNet.reduce((a, b) => (a.netEur <= b.netEur ? a : b))
        : undefined;

    result.push({
      host,
      productCode,
      productName,
      prices,
      fxRate,
      cheapestRawItemId: cheapestRaw?.item.id,
      cheapestNetItemId: cheapestNet?.item.id,
    });
  }

  // Overall card order: newest touched first.
  result.sort((a, b) => {
    const at = Math.max(
      ...a.prices.map((p) => Date.parse(p.item.updatedAt) || 0),
    );
    const bt = Math.max(
      ...b.prices.map((p) => Date.parse(p.item.updatedAt) || 0),
    );
    return bt - at;
  });

  return result;
}
