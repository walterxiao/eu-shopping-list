import { getDb } from "./db";

const FX_TTL_SECONDS = 24 * 3600;
const FX_ENDPOINT =
  "https://api.exchangerate.host/latest?base=USD&symbols=EUR";
/**
 * Static fallback rate used when we have no cached rate AND the live
 * endpoint is unreachable. Intentionally rough — a real deploy should
 * alert on this path.
 */
const FALLBACK_RATE_USD_EUR = 0.92;

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

async function fetchLiveRate(): Promise<number> {
  const doFetch = _fetchImpl ?? globalThis.fetch;
  const res = await doFetch(FX_ENDPOINT, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`exchangerate.host responded HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    rates?: { EUR?: number };
    result?: number;
  };
  const rate = data.rates?.EUR ?? data.result;
  if (typeof rate !== "number" || !isFinite(rate) || rate <= 0) {
    throw new Error("exchangerate.host returned an invalid EUR rate");
  }
  return rate;
}

/**
 * Return the USD→EUR rate, cached in SQLite for 24 hours.
 *
 * On a cache miss we fetch live; on a live failure we fall back to the
 * most recent stale cached value, and finally to a hardcoded rate. The
 * caller receives both the rate and a `source` indicator so the UI can
 * surface a warning when the result isn't fresh.
 */
export async function getUsdToEurRate(): Promise<{
  rate: number;
  source: "cache" | "live" | "stale" | "fallback";
}> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .prepare<[string], FxRow>(
      "SELECT rate, fetched_at FROM fx_cache WHERE pair = ?",
    )
    .get("USD-EUR");

  if (row && now - row.fetched_at < FX_TTL_SECONDS) {
    return { rate: row.rate, source: "cache" };
  }

  try {
    const rate = await fetchLiveRate();
    db.prepare(
      `INSERT INTO fx_cache(pair, rate, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(pair) DO UPDATE SET
         rate = excluded.rate,
         fetched_at = excluded.fetched_at`,
    ).run("USD-EUR", rate, now);
    return { rate, source: "live" };
  } catch {
    if (row) return { rate: row.rate, source: "stale" };
    return { rate: FALLBACK_RATE_USD_EUR, source: "fallback" };
  }
}
