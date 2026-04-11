import { describe, it, expect, beforeEach, vi } from "vitest";
import { getUsdToEurRate, setFetchImplForTest } from "@/lib/fx";
import { resetDbForTest } from "@/lib/db";

/**
 * Build a response shaped like exchangerate.host's USD-base reply.
 * Defaults HKD and JPY to plausible mid-2025 values so existing tests
 * that only care about the USD→EUR rate continue to pass without
 * having to spell out the other two pairs.
 */
function makeOkResponse(eurRate: number): Response {
  return new Response(
    JSON.stringify({
      rates: { EUR: eurRate, HKD: 7.83, JPY: 150 },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("getUsdToEurRate", () => {
  beforeEach(() => {
    resetDbForTest();
    setFetchImplForTest(undefined);
  });

  it("hits the live endpoint on a cold cache", async () => {
    const spy = vi.fn(async () => makeOkResponse(0.95));
    setFetchImplForTest(spy as unknown as typeof fetch);

    const { rate, source } = await getUsdToEurRate();
    expect(rate).toBe(0.95);
    expect(source).toBe("live");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("serves from cache on the second call", async () => {
    const spy = vi.fn(async () => makeOkResponse(0.93));
    setFetchImplForTest(spy as unknown as typeof fetch);

    await getUsdToEurRate();
    const second = await getUsdToEurRate();

    expect(second.rate).toBe(0.93);
    expect(second.source).toBe("cache");
    // Only one network call total.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the stale cached value when live fetch fails", async () => {
    let callCount = 0;
    const spy = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return makeOkResponse(0.91);
      throw new Error("network down");
    });
    setFetchImplForTest(spy as unknown as typeof fetch);

    // Warm the cache.
    await getUsdToEurRate();

    // Force expiry by rewinding fetched_at far into the past. This uses
    // the same DB the cache wrote to.
    const { getDb } = await import("@/lib/db");
    getDb()
      .prepare("UPDATE fx_cache SET fetched_at = 0 WHERE pair = ?")
      .run("USD-EUR");

    const stale = await getUsdToEurRate();
    expect(stale.rate).toBe(0.91);
    expect(stale.source).toBe("stale");
  });

  it("falls back to a hardcoded rate when there is no cache and live fails", async () => {
    const spy = vi.fn(async () => {
      throw new Error("network down");
    });
    setFetchImplForTest(spy as unknown as typeof fetch);

    const { rate, source } = await getUsdToEurRate();
    expect(source).toBe("fallback");
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(2);
  });

  it("rejects an invalid response payload via fallback", async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ oops: true }), { status: 200 }),
    );
    setFetchImplForTest(spy as unknown as typeof fetch);

    const { source } = await getUsdToEurRate();
    expect(source).toBe("fallback");
  });
});
