import { getDb } from "./db";
import type { Region, RimowaProduct } from "./scrapers/types";

const DEFAULT_TTL_SECONDS = 6 * 3600; // 6h — Rimowa prices rarely change
const MISS_TTL_SECONDS = 600; // 10m — don't cache not-found too long

interface Row {
  result_json: string;
  fetched_at: number;
}

function ttlFor(value: RimowaProduct | null): number {
  const configured = Number(
    process.env.CACHE_TTL_SECONDS ?? DEFAULT_TTL_SECONDS,
  );
  return value === null ? Math.min(MISS_TTL_SECONDS, configured) : configured;
}

/**
 * Return cached product data for `(region, productCode)` if fresh,
 * otherwise call `fetcher` and persist its result. A `null` result means
 * "product not found in this region" and is cached with a short TTL so a
 * transient 404 doesn't stick for hours.
 */
export async function getCachedOrFetchProduct(
  region: Region,
  productCode: string,
  fetcher: () => Promise<RimowaProduct | null>,
): Promise<RimowaProduct | null> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .prepare<
      [string, string],
      Row
    >("SELECT result_json, fetched_at FROM product_cache WHERE region = ? AND product_code = ?")
    .get(region, productCode);

  if (row) {
    const parsed = JSON.parse(row.result_json) as RimowaProduct | null;
    if (now - row.fetched_at < ttlFor(parsed)) {
      return parsed;
    }
  }

  const fresh = await fetcher();

  db.prepare(
    `INSERT INTO product_cache(region, product_code, result_json, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(region, product_code) DO UPDATE SET
       result_json = excluded.result_json,
       fetched_at  = excluded.fetched_at`,
  ).run(region, productCode, JSON.stringify(fresh), now);

  return fresh;
}
