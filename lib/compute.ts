import type {
  ComparisonItem,
  ItemAnalysis,
  Region,
  TrackedItem,
} from "./types";

/** Default VAT rate applied to pan-EU `/eu/...` URLs that carry no country. */
const DEFAULT_EU_VAT_RATE = 0.19;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute the full side-by-side analysis for one paired (EU, US) product. */
function computeAnalysis(
  eu: TrackedItem,
  us: TrackedItem,
  usdToEurRate: number,
): ItemAnalysis {
  const euVatRate = eu.euVatRate ?? DEFAULT_EU_VAT_RATE;

  const euRawEur = round2(eu.priceRaw);
  const usRawEur = round2(us.priceRaw * usdToEurRate);

  // EU raw price includes country-specific VAT; strip it out.
  const euNetEur = round2(eu.priceRaw / (1 + euVatRate));
  // US raw price is already pre-sales-tax on the site.
  const usNetEur = round2(us.priceRaw * usdToEurRate);

  const cheaperRaw: Region = usRawEur <= euRawEur ? "US" : "EU";
  const rawHigh = Math.max(euRawEur, usRawEur);
  const rawLow = Math.min(euRawEur, usRawEur);
  const savingsRawEur = round2(rawHigh - rawLow);
  const savingsRawPercent =
    rawHigh === 0 ? 0 : round2((savingsRawEur / rawHigh) * 100);

  const cheaperNormalized: Region = usNetEur <= euNetEur ? "US" : "EU";
  const netHigh = Math.max(euNetEur, usNetEur);
  const netLow = Math.min(euNetEur, usNetEur);
  const savingsNormalizedEur = round2(netHigh - netLow);
  const savingsNormalizedPercent =
    netHigh === 0 ? 0 : round2((savingsNormalizedEur / netHigh) * 100);

  return {
    usdToEurRate,
    euVatRateApplied: euVatRate,
    euRawEur,
    usRawEur,
    euNetEur,
    usNetEur,
    cheaperRaw,
    savingsRawEur,
    savingsRawPercent,
    cheaperNormalized,
    savingsNormalizedEur,
    savingsNormalizedPercent,
  };
}

/** Returns the item with the newer `updatedAt` (ties broken by string order). */
function pickNewest(a: TrackedItem, b: TrackedItem): TrackedItem {
  return a.updatedAt >= b.updatedAt ? a : b;
}

/**
 * Group tracked items by (host, productCode) and, for each group,
 * attach the latest EU + US entries (if present) along with the
 * computed analysis. Pairing is scoped to the same host because
 * product codes from different brands live in different namespaces
 * — a Rimowa "92552634" and a hypothetical Moncler "92552634" are
 * not the same product.
 *
 * Pure function — no React, no side effects, no network. Deterministic
 * for the same `(items, fxRate)` input.
 */
export function groupAndAnalyze(
  items: TrackedItem[],
  fxRate: number | null,
): ComparisonItem[] {
  const groups = new Map<
    string,
    { host: string; productCode: string; eu?: TrackedItem; us?: TrackedItem }
  >();

  for (const item of items) {
    const key = `${item.host}\u0000${item.productCode}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { host: item.host, productCode: item.productCode };
      groups.set(key, bucket);
    }
    if (item.region === "EU") {
      bucket.eu = bucket.eu ? pickNewest(bucket.eu, item) : item;
    } else {
      bucket.us = bucket.us ? pickNewest(bucket.us, item) : item;
    }
  }

  const result: ComparisonItem[] = [];
  for (const { host, productCode, eu, us } of groups.values()) {
    const productName = eu?.productName ?? us?.productName ?? productCode;

    if (eu && us && fxRate != null) {
      result.push({
        host,
        productCode,
        productName,
        eu,
        us,
        analysis: computeAnalysis(eu, us, fxRate),
        status: "ok",
      });
    } else if (eu && us) {
      // Paired but FX rate not available — still show the card with
      // raw prices, no analysis.
      result.push({ host, productCode, productName, eu, us, status: "ok" });
    } else if (eu) {
      result.push({
        host,
        productCode,
        productName,
        eu,
        status: "single_eu",
      });
    } else if (us) {
      result.push({
        host,
        productCode,
        productName,
        us,
        status: "single_us",
      });
    }
  }

  // Newest-first ordering: use the max updatedAt across eu/us.
  result.sort((a, b) => {
    const at = Math.max(
      a.eu ? Date.parse(a.eu.updatedAt) : 0,
      a.us ? Date.parse(a.us.updatedAt) : 0,
    );
    const bt = Math.max(
      b.eu ? Date.parse(b.eu.updatedAt) : 0,
      b.us ? Date.parse(b.us.updatedAt) : 0,
    );
    return bt - at;
  });

  return result;
}
