import { getDb } from "./db";

const FX_TTL_SECONDS = 24 * 3600;
const FX_ENDPOINT =
  "https://api.exchangerate.host/latest?base=USD&symbols=EUR,HKD,JPY";
/**
 * Static fallback rates used when we have no cached rate AND the live
 * endpoint is unreachable. Intentionally rough averages from late
 * 2025 — a real deploy should alert on this path.
 */
const FALLBACK_RATES_FROM_USD: Record<string, number> = {
  EUR: 0.92,
  HKD: 7.83,
  JPY: 150,
};

/** Currencies the app converts to EUR (the comparison baseline). */
export type SupportedCurrency = "USD" | "HKD" | "JPY";

interface FxRow {
  rate: number;
  fetched_at: number;
}

/**
 * Inject a custom fetch implementation (tests use this to mock HTTP).
 * Production code leaves it unset and the built-in global fetch is used.
 */
export type FetchFn = typeof fetch;
let _fetchImpl: FetchFn | undefined;
export function setFetchImplForTest(fn: FetchFn | undefined): void {
  _fetchImpl = fn;
}

interface LiveRates {
  USD_EUR: number;
  HKD_EUR: number;
  JPY_EUR: number;
}

/**
 * Fetch USD-base rates for EUR, HKD, JPY in a single round trip and
 * derive the corresponding {currency}_EUR conversion rates the rest
 * of the app uses.
 *
 * Math: exchangerate.host returns rates as `1 USD = X target`. So:
 *   - USD→EUR: rates.EUR directly
 *   - HKD→EUR: rates.EUR / rates.HKD
 *     (because 1 HKD = (1/rates.HKD) USD = (rates.EUR/rates.HKD) EUR)
 *   - JPY→EUR: rates.EUR / rates.JPY
 */
async function fetchLiveRates(): Promise<LiveRates> {
  const doFetch = _fetchImpl ?? globalThis.fetch;
  const res = await doFetch(FX_ENDPOINT, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`exchangerate.host responded HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    rates?: { EUR?: number; HKD?: number; JPY?: number };
  };
  const eur = data.rates?.EUR;
  const hkd = data.rates?.HKD;
  const jpy = data.rates?.JPY;
  if (
    typeof eur !== "number" || !isFinite(eur) || eur <= 0 ||
    typeof hkd !== "number" || !isFinite(hkd) || hkd <= 0 ||
    typeof jpy !== "number" || !isFinite(jpy) || jpy <= 0
  ) {
    throw new Error("exchangerate.host returned invalid rate data");
  }
  return {
    USD_EUR: eur,
    HKD_EUR: eur / hkd,
    JPY_EUR: eur / jpy,
  };
}

export interface FxRates {
  /** USD → EUR (e.g. 0.92). */
  usdToEur: number;
  /** HKD → EUR (e.g. 0.117). */
  hkdToEur: number;
  /** JPY → EUR (e.g. 0.0061). */
  jpyToEur: number;
  source: "cache" | "live" | "stale" | "fallback";
}

/**
 * Return the USD/HKD/JPY → EUR conversion rates, cached in SQLite for
 * 24 hours. The three pairs are stored as separate `fx_cache` rows
 * (`USD-EUR`, `HKD-EUR`, `JPY-EUR`) but fetched together in a single
 * exchangerate.host round-trip when any of them is missing or stale,
 * to keep the network footprint identical to the v1 single-pair
 * implementation.
 *
 * Same fall-back chain as before: live → stale-cached → hardcoded
 * fallback. The `source` is the *worst* tier any pair fell back to
 * (i.e. one fresh cache + one stale cache reports "stale").
 */
export async function getEurFxRates(): Promise<FxRates> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  function readRow(pair: string): FxRow | undefined {
    return db
      .prepare<[string], FxRow>(
        "SELECT rate, fetched_at FROM fx_cache WHERE pair = ?",
      )
      .get(pair);
  }

  const usdRow = readRow("USD-EUR");
  const hkdRow = readRow("HKD-EUR");
  const jpyRow = readRow("JPY-EUR");

  const allFresh =
    usdRow && hkdRow && jpyRow &&
    now - usdRow.fetched_at < FX_TTL_SECONDS &&
    now - hkdRow.fetched_at < FX_TTL_SECONDS &&
    now - jpyRow.fetched_at < FX_TTL_SECONDS;

  if (allFresh) {
    return {
      usdToEur: usdRow.rate,
      hkdToEur: hkdRow.rate,
      jpyToEur: jpyRow.rate,
      source: "cache",
    };
  }

  try {
    const live = await fetchLiveRates();
    const upsert = db.prepare(
      `INSERT INTO fx_cache(pair, rate, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(pair) DO UPDATE SET
         rate = excluded.rate,
         fetched_at = excluded.fetched_at`,
    );
    db.transaction(() => {
      upsert.run("USD-EUR", live.USD_EUR, now);
      upsert.run("HKD-EUR", live.HKD_EUR, now);
      upsert.run("JPY-EUR", live.JPY_EUR, now);
    })();
    return {
      usdToEur: live.USD_EUR,
      hkdToEur: live.HKD_EUR,
      jpyToEur: live.JPY_EUR,
      source: "live",
    };
  } catch {
    // Live failed — fall back to whatever we have, even if stale.
    if (usdRow && hkdRow && jpyRow) {
      return {
        usdToEur: usdRow.rate,
        hkdToEur: hkdRow.rate,
        jpyToEur: jpyRow.rate,
        source: "stale",
      };
    }
    return {
      usdToEur: usdRow?.rate ?? FALLBACK_RATES_FROM_USD.EUR,
      hkdToEur:
        hkdRow?.rate ??
        FALLBACK_RATES_FROM_USD.EUR / FALLBACK_RATES_FROM_USD.HKD,
      jpyToEur:
        jpyRow?.rate ??
        FALLBACK_RATES_FROM_USD.EUR / FALLBACK_RATES_FROM_USD.JPY,
      source: "fallback",
    };
  }
}

/**
 * Legacy single-rate accessor kept for backward compatibility with
 * the existing FX route and any tests that import it. Internally
 * delegates to {@link getEurFxRates} so it benefits from the same
 * batched-fetch + per-pair cache.
 */
export async function getUsdToEurRate(): Promise<{
  rate: number;
  source: "cache" | "live" | "stale" | "fallback";
}> {
  const all = await getEurFxRates();
  return { rate: all.usdToEur, source: all.source };
}
