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
export const DEFAULT_EU_REFUND_RATE = 0.12;

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

/**
 * Default Japanese tourist tax-free rate applied to JP items that
 * don't carry an explicit jpTaxFreeRate. Tourists who present a
 * passport at checkout get the full 10% consumption tax exempted
 * (免税 / "menzei") with no operator processing fees.
 */
export const DEFAULT_JP_TAX_FREE_RATE = 0.10;

/**
 * The compute layer takes the FX rates as a single object so the
 * caller doesn't have to pass three separate scalar arguments. All
 * three rates are conversions to EUR (the comparison baseline).
 * Pass null to indicate the rates are unavailable — non-EUR rows
 * will have NaN rawEur/netEur and be excluded from cheapest-row
 * selection but still rendered.
 */
export interface FxRatesSnapshot {
  usdToEur: number;
  hkdToEur: number;
  jpyToEur: number;
  sarToEur: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Derive the EUR price representation for a single stored item given
 * the current FX rates.
 *
 * Per-region math:
 *   - EU: rawEur = priceRaw (already EUR; sticker INCLUDES VAT)
 *         netEur = rawEur * (1 - euRefundRate)
 *   - US: rawEur = priceRaw * usdToEur (sticker converted to EUR)
 *         netEur = rawEur * (1 + salesTaxRate)
 *   - JP: rawEur = priceRaw * jpyToEur
 *         netEur = rawEur * (1 - jpTaxFreeRate)
 *   - HK: rawEur = priceRaw * hkdToEur
 *         netEur = rawEur          (no VAT, no sales tax — sticker
 *                                    is the all-in number)
 *
 * The "Net (EUR)" column is the apples-to-apples comparison number.
 * Picking the lowest `netEur` across the card answers "where do I
 * actually pay the least, all-in?".
 *
 * If the FX snapshot is null and the item is non-EUR, both rawEur
 * and netEur are NaN — the UI still shows the raw native number but
 * excludes the row from the cheapest-row comparison.
 */
function priceForItem(
  item: TrackedItem,
  fx: FxRatesSnapshot | null,
): ItemPrice {
  if (item.currency === "USD") {
    const rawUsd = item.priceRaw;
    const rawEur = fx ? round2(rawUsd * fx.usdToEur) : NaN;
    const salesTaxRate = item.salesTaxRate ?? DEFAULT_US_SALES_TAX_RATE;
    const netEur = Number.isFinite(rawEur)
      ? round2(rawEur * (1 + salesTaxRate))
      : NaN;
    return { item, rawEur, netEur, rawUsd };
  }
  if (item.currency === "JPY") {
    const rawJpy = item.priceRaw;
    const rawEur = fx ? round2(rawJpy * fx.jpyToEur) : NaN;
    const jpTaxFreeRate = item.jpTaxFreeRate ?? DEFAULT_JP_TAX_FREE_RATE;
    const netEur = Number.isFinite(rawEur)
      ? round2(rawEur * (1 - jpTaxFreeRate))
      : NaN;
    return { item, rawEur, netEur, rawJpy };
  }
  if (item.currency === "HKD") {
    const rawHkd = item.priceRaw;
    const rawEur = fx ? round2(rawHkd * fx.hkdToEur) : NaN;
    // HK has no VAT and no sales tax — sticker IS the net price.
    const netEur = rawEur;
    return { item, rawEur, netEur, rawHkd };
  }
  if (item.currency === "SAR") {
    const rawSar = item.priceRaw;
    const rawEur = fx ? round2(rawSar * fx.sarToEur) : NaN;
    // SA VAT included, no tourist refund modeled — sticker IS the net.
    const netEur = rawEur;
    return { item, rawEur, netEur, rawSar };
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
/**
 * Normalize a product name for use as a grouping key. Lowercases,
 * trims, and collapses internal whitespace so "Classic Cabin  ",
 * "classic cabin", and "CLASSIC CABIN" all resolve to the same
 * bucket. If the name is empty (shouldn't happen — the API requires
 * it — but be safe), returns an empty string and the caller falls
 * back to productCode.
 */
function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function groupAndAnalyze(
  items: TrackedItem[],
  fx: FxRatesSnapshot | null,
): ComparisonItem[] {
  // Grouping key is (host, normalized product name), NOT (host,
  // productCode). This lets color variants of the same product —
  // e.g. Rimowa Classic Cabin silver (97353004) and black
  // (97353005), both named "Classic Cabin" by the user — share
  // one comparison card even though their SKUs differ. Items
  // still group by code indirectly because the AddItem modal
  // auto-suggests the stored name whenever the (host, productCode)
  // matches, so same-code items in different regions get the same
  // name typed into them and end up in the same bucket.
  //
  // Host is included in the key so a code or name collision
  // between two brands (rimowa.com "Classic Cabin" vs a different
  // site's "Classic Cabin") doesn't incorrectly merge them.
  const groups = new Map<string, TrackedItem[]>();
  for (const item of items) {
    const nameKey = normalizeNameKey(item.productName);
    const fallback = nameKey || item.productCode;
    const key = `${item.host}\u0000${fallback}`;
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

    const prices = sorted.map((it) => priceForItem(it, fx));

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
      fxRate: fx?.usdToEur ?? null,
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
