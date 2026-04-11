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

/**
 * Default US sales tax rate applied when a US item has no explicit
 * salesTaxRate stored. Set to 6% which is the all-in sales tax rate
 * for most of Northern Virginia (4.3% state + 1.0% statewide local
 * + 0.7% NoVa regional) including ZIP 22180 (Vienna, Fairfax
 * County).
 *
 * Override per item in the AddItem form or the inline Edit cell if
 * you ship to a different state. Set to 0 explicitly if you want a
 * tax-free comparison.
 */
export const DEFAULT_US_SALES_TAX_RATE = 0.06;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Derive the EUR price representation for a single stored item given
 * the current FX rate.
 *
 * For EU items:
 *   - `rawEur` = priceRaw (already EUR; sticker INCLUDES VAT)
 *   - `netEur` = rawEur * (1 - euRefundRate)  ← what a non-EU tourist
 *     actually pays after claiming the VAT refund at the airport
 *
 * For US items:
 *   - `rawUsd` = priceRaw (USD sticker; PRE-sales-tax in the US)
 *   - `rawEur` = rawUsd * fxRate (sticker converted to EUR)
 *   - `netEur` = rawEur * (1 + salesTaxRate)  ← what you actually
 *     pay at checkout (sticker + your local sales tax). Defaults
 *     to 0% sales tax if the user didn't specify, in which case
 *     `netEur === rawEur`.
 *
 * The "Net (EUR)" column is the apples-to-apples comparison number:
 * EU rows have it reduced by the tourist refund, US rows have it
 * increased by sales tax. Picking the lowest `netEur` across the
 * card answers "where do I actually pay the least, all-in?".
 *
 * If fxRate is null and the item is USD, both rawEur and netEur are
 * NaN — the UI still shows the raw USD number but excludes the row
 * from the cheapest-row comparison.
 */
function priceForItem(
  item: TrackedItem,
  fxRate: number | null,
): ItemPrice {
  if (item.currency === "USD") {
    const rawUsd = item.priceRaw;
    const rawEur = fxRate != null ? round2(rawUsd * fxRate) : NaN;
    // Fall back to the DEFAULT_US_SALES_TAX_RATE if the row has no
    // explicit rate stored. The user can override per-item; storing
    // 0 explicitly (as opposed to leaving the field NULL) disables
    // sales tax for a specific row.
    const salesTaxRate = item.salesTaxRate ?? DEFAULT_US_SALES_TAX_RATE;
    const netEur = Number.isFinite(rawEur)
      ? round2(rawEur * (1 + salesTaxRate))
      : NaN;
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

    // Attach a signed diff against the cheapest US row's net (the
    // user's baseline for "where would I actually pay less?").
    //   - US rows themselves get no diff (they ARE the baseline).
    //   - If there's no US row with a finite net, no row gets a diff.
    const usBaseline = prices
      .filter((p) => p.item.region === "US" && Number.isFinite(p.netEur))
      .reduce<
        ItemPrice | undefined
      >((best, p) => (best && best.netEur <= p.netEur ? best : p), undefined);
    if (usBaseline && usBaseline.netEur > 0) {
      for (const p of prices) {
        if (p.item.region === "US") continue;
        if (!Number.isFinite(p.netEur)) continue;
        p.diffVsUsEur = round2(p.netEur - usBaseline.netEur);
        p.diffVsUsPercent = round2(
          ((p.netEur - usBaseline.netEur) / usBaseline.netEur) * 100,
        );
      }
    }

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
