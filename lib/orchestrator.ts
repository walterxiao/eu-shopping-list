import { getCachedOrFetchProduct } from "./cache";
import { getUsdToEurRate } from "./fx";
import { parseRimowaUrl, RimowaUrlParseError } from "./rimowa-url";
import { getRegionScrapers } from "./scrapers/registry";
import { DEFAULT_EU_VAT_RATE } from "./scrapers/regions";
import type {
  FetchOptions,
  Region,
  RegionScraper,
  RimowaProduct,
} from "./scrapers/types";
import type {
  CompareRequest,
  CompareResponse,
  ComparisonItem,
  ItemAnalysis,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const OUTER_TIMEOUT_MS = 16_000;

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms: ${label}`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/** Dispatch one region fetch through the cache layer. */
async function fetchRegion(
  scraper: RegionScraper,
  productCode: string,
): Promise<RimowaProduct | null> {
  const options: FetchOptions = { timeoutMs: DEFAULT_TIMEOUT_MS };
  return withTimeout(
    getCachedOrFetchProduct(scraper.meta.region, productCode, () =>
      scraper.fetchByCode(productCode, options),
    ),
    OUTER_TIMEOUT_MS,
    `${scraper.meta.region}:${productCode}`,
  );
}

/** Round to 2 decimal places without introducing FP noise. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeAnalysis(
  eu: RimowaProduct,
  us: RimowaProduct,
  usdToEurRate: number,
  euVatRate: number,
): ItemAnalysis {
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

/**
 * Intermediate shape produced by `compareOne` before the FX rate + VAT
 * analysis are folded in at the end of `compare`.
 */
interface CompareOneResult {
  base: Omit<ComparisonItem, "analysis">;
  euVatRate: number;
}

async function compareOne(
  inputUrl: string,
  eu: RegionScraper,
  us: RegionScraper,
): Promise<CompareOneResult> {
  let productCode: string;
  let euVatRate: number;
  try {
    const parsed = parseRimowaUrl(inputUrl);
    productCode = parsed.productCode;
    euVatRate = parsed.euVatRate ?? DEFAULT_EU_VAT_RATE;
  } catch (err) {
    const reason =
      err instanceof RimowaUrlParseError ? err.message : String(err);
    return {
      base: { input: inputUrl, status: "error", reason },
      euVatRate: DEFAULT_EU_VAT_RATE,
    };
  }

  const [euResult, usResult] = await Promise.allSettled([
    fetchRegion(eu, productCode),
    fetchRegion(us, productCode),
  ]);

  const euProduct =
    euResult.status === "fulfilled" ? euResult.value : null;
  const usProduct =
    usResult.status === "fulfilled" ? usResult.value : null;

  const errors: string[] = [];
  if (euResult.status === "rejected") {
    errors.push(
      `EU fetch failed: ${euResult.reason instanceof Error ? euResult.reason.message : String(euResult.reason)}`,
    );
  }
  if (usResult.status === "rejected") {
    errors.push(
      `US fetch failed: ${usResult.reason instanceof Error ? usResult.reason.message : String(usResult.reason)}`,
    );
  }

  if (euResult.status === "rejected" && usResult.status === "rejected") {
    return {
      base: {
        input: inputUrl,
        productCode,
        status: "error",
        reason: errors.join("; "),
      },
      euVatRate,
    };
  }

  const base: Omit<ComparisonItem, "analysis"> = {
    input: inputUrl,
    productCode,
    productName: euProduct?.productName ?? usProduct?.productName,
    eu: euProduct ?? undefined,
    us: usProduct ?? undefined,
    status: "not_found",
  };

  if (euProduct && usProduct) {
    base.status = "ok";
  } else if (euProduct || usProduct) {
    base.status = "partial";
  } else if (errors.length > 0) {
    base.status = "error";
    base.reason = errors.join("; ");
  }

  return { base, euVatRate };
}

/** Core entry point, shared by the API route and tests. */
export async function compare(
  req: CompareRequest,
): Promise<CompareResponse> {
  const { eu, us } = await getRegionScrapers();
  // FX fetch runs in parallel with the scraper calls.
  const ratePromise = getUsdToEurRate();

  const perUrl = await Promise.all(
    req.urls.map((url) => compareOne(url, eu, us)),
  );

  const fx = await ratePromise;
  const warnings: string[] = [];
  if (fx.source === "stale") {
    warnings.push(
      "FX rate is stale — live fetch failed, using last known value.",
    );
  } else if (fx.source === "fallback") {
    warnings.push(
      "FX rate unavailable — using a hardcoded fallback. Converted US prices may be inaccurate.",
    );
  }

  const items: ComparisonItem[] = perUrl.map(({ base, euVatRate }) => {
    if (base.status !== "ok" || !base.eu || !base.us) return base;
    return {
      ...base,
      analysis: computeAnalysis(base.eu, base.us, fx.rate, euVatRate),
    };
  });

  for (const item of items) {
    if (item.status === "partial") {
      const missing = !item.eu ? "EU" : "US";
      warnings.push(
        `Product ${item.productCode ?? "(?)"} not available on ${missing} site.`,
      );
    }
    if (item.status === "error" && item.reason) {
      warnings.push(
        `Could not compare ${item.input}: ${item.reason}`,
      );
    }
  }

  return {
    items,
    usdToEurRate: fx.rate,
    generatedAt: new Date().toISOString(),
    warnings,
  };
}
