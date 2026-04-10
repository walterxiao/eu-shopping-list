import { describe, it, expect } from "vitest";
import { groupAndAnalyze } from "@/lib/compute";
import type { ComparisonItem, TrackedItem } from "@/lib/types";

function mk(partial: Partial<TrackedItem>): TrackedItem {
  return {
    id: partial.id ?? `id-${Math.random()}`,
    url: partial.url ?? "https://www.rimowa.com/eu/en/x/92552634.html",
    host: partial.host ?? "www.rimowa.com",
    productCode: partial.productCode ?? "92552634",
    region: partial.region ?? "EU",
    sourceCountry: partial.sourceCountry,
    euRefundRate: partial.euRefundRate,
    productName: partial.productName ?? "Original Cabin — Black",
    priceRaw: partial.priceRaw ?? 1350,
    currency: partial.currency ?? "EUR",
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
  };
}

function findRow(card: ComparisonItem, id: string) {
  const row = card.prices.find((p) => p.item.id === id);
  if (!row) throw new Error(`row ${id} not in card`);
  return row;
}

describe("groupAndAnalyze", () => {
  it("returns an empty list for empty input", () => {
    expect(groupAndAnalyze([], 0.92)).toEqual([]);
  });

  it("returns a single-region card when only one item exists", () => {
    const items = [mk({ id: "only", region: "EU" })];
    const res = groupAndAnalyze(items, 0.92);
    expect(res).toHaveLength(1);
    expect(res[0].prices).toHaveLength(1);
    expect(res[0].cheapestRawItemId).toBe("only");
    expect(res[0].cheapestNetItemId).toBe("only");
  });

  it("pairs EU + US by (host, productCode) with refund-based analysis", () => {
    const items = [
      mk({ id: "it", region: "EU", sourceCountry: "it", euRefundRate: 0.12, priceRaw: 1190 }),
      mk({ id: "us", region: "US", currency: "USD", priceRaw: 1100 }),
    ];
    const res = groupAndAnalyze(items, 0.92);
    expect(res).toHaveLength(1);
    const card = res[0];
    expect(card.prices).toHaveLength(2);

    const it = findRow(card, "it");
    expect(it.rawEur).toBe(1190);
    // IT net = 1190 * (1 - 0.12) = 1047.20
    expect(it.netEur).toBeCloseTo(1047.2, 2);

    const us = findRow(card, "us");
    expect(us.rawUsd).toBe(1100);
    // US raw in EUR = 1100 * 0.92 = 1012
    expect(us.rawEur).toBeCloseTo(1012, 2);
    // US has no refund, net === rawEur
    expect(us.netEur).toBeCloseTo(1012, 2);

    // Cheapest raw: US (1012) beats IT (1190)
    expect(card.cheapestRawItemId).toBe("us");
    // Cheapest net: US (1012) still beats IT (1047.20) in this example
    expect(card.cheapestNetItemId).toBe("us");
  });

  it("supports 3+ region comparisons (the v7 ask)", () => {
    const items = [
      mk({ id: "de", host: "www.moncler.com", productCode: "L1", region: "EU", sourceCountry: "de", euRefundRate: 0.11, priceRaw: 1290 }),
      mk({ id: "it", host: "www.moncler.com", productCode: "L1", region: "EU", sourceCountry: "it", euRefundRate: 0.12, priceRaw: 1290 }),
      mk({ id: "fr", host: "www.moncler.com", productCode: "L1", region: "EU", sourceCountry: "fr", euRefundRate: 0.12, priceRaw: 1300 }),
      mk({ id: "us", host: "www.moncler.com", productCode: "L1", region: "US", currency: "USD", priceRaw: 1450 }),
    ];
    const res = groupAndAnalyze(items, 0.92);
    expect(res).toHaveLength(1);
    const card = res[0];
    expect(card.prices).toHaveLength(4);

    // Sanity: every region has a priced row.
    const regions = card.prices.map((p) =>
      p.item.sourceCountry ?? p.item.region,
    );
    expect(regions).toContain("de");
    expect(regions).toContain("it");
    expect(regions).toContain("fr");
    expect(regions).toContain("US");

    // Cheapest raw in EUR: US (1450 * 0.92 = 1334) vs EU items (1290/1290/1300).
    // DE and IT are 1290 → the first one in sorted order wins.
    expect(["de", "it"]).toContain(card.cheapestRawItemId);

    // Cheapest after refund:
    //   DE net = 1290 * 0.89 = 1148.10
    //   IT net = 1290 * 0.88 = 1135.20
    //   FR net = 1300 * 0.88 = 1144.00
    //   US net = 1334 (no refund)
    // IT wins.
    expect(card.cheapestNetItemId).toBe("it");
  });

  it("falls back to 0.12 for a pan-EU URL without a country", () => {
    const items = [
      mk({ id: "pan", region: "EU", sourceCountry: undefined, euRefundRate: undefined, priceRaw: 1000 }),
    ];
    const res = groupAndAnalyze(items, 0.92);
    const row = findRow(res[0], "pan");
    expect(row.netEur).toBeCloseTo(880, 2);
  });

  it("groups multiple unrelated products into separate cards", () => {
    const items = [
      mk({ id: "a-eu", productCode: "A", region: "EU", priceRaw: 1000 }),
      mk({ id: "a-us", productCode: "A", region: "US", currency: "USD", priceRaw: 900 }),
      mk({ id: "b-eu", productCode: "B", region: "EU", priceRaw: 2000 }),
      mk({ id: "b-us", productCode: "B", region: "US", currency: "USD", priceRaw: 1800 }),
    ];
    const res = groupAndAnalyze(items, 0.92);
    expect(res).toHaveLength(2);
    expect(res.every((c) => c.prices.length === 2)).toBe(true);
  });

  it("does NOT pair items that share a product code across different hosts", () => {
    const items = [
      mk({
        id: "r",
        host: "www.rimowa.com",
        productCode: "COLLISION",
        region: "EU",
        priceRaw: 1000,
      }),
      mk({
        id: "m",
        host: "www.moncler.com",
        productCode: "COLLISION",
        region: "US",
        currency: "USD",
        priceRaw: 1100,
      }),
    ];
    const res = groupAndAnalyze(items, 0.92);
    expect(res).toHaveLength(2);
    const hosts = res.map((c) => c.host).sort();
    expect(hosts).toEqual(["www.moncler.com", "www.rimowa.com"]);
    // Each card has exactly one priced row.
    expect(res.every((c) => c.prices.length === 1)).toBe(true);
  });

  it("produces NaN-safe rows when fxRate is null for a USD item", () => {
    const items = [
      mk({ id: "eu", region: "EU", euRefundRate: 0.12, priceRaw: 1000 }),
      mk({ id: "us", region: "US", currency: "USD", priceRaw: 900 }),
    ];
    const res = groupAndAnalyze(items, null);
    const card = res[0];
    const us = findRow(card, "us");
    expect(Number.isNaN(us.rawEur)).toBe(true);
    expect(Number.isNaN(us.netEur)).toBe(true);
    // The EU row still has finite values and wins both "cheapest"
    // rankings because the US row is excluded from the comparison.
    expect(card.cheapestRawItemId).toBe("eu");
    expect(card.cheapestNetItemId).toBe("eu");
  });

  it("displays USD sticker alongside its EUR conversion for US items", () => {
    const items = [
      mk({ id: "us", region: "US", currency: "USD", priceRaw: 1300 }),
    ];
    const res = groupAndAnalyze(items, 0.92);
    const us = findRow(res[0], "us");
    expect(us.rawUsd).toBe(1300);
    expect(us.rawEur).toBeCloseTo(1196, 2);
  });

  it("uses the country's refund rate from the stored item", () => {
    // Explicit rates on the item win over the default 0.12.
    const it = groupAndAnalyze(
      [mk({ id: "it", region: "EU", sourceCountry: "it", euRefundRate: 0.12, priceRaw: 1000 })],
      0.92,
    );
    const de = groupAndAnalyze(
      [mk({ id: "de", region: "EU", sourceCountry: "de", euRefundRate: 0.11, priceRaw: 1000 })],
      0.92,
    );
    const itNet = findRow(it[0], "it").netEur;
    const deNet = findRow(de[0], "de").netEur;
    // Italy refunds more, so the net is lower than Germany's.
    expect(itNet).toBeCloseTo(880, 2);
    expect(deNet).toBeCloseTo(890, 2);
    expect(itNet).toBeLessThan(deNet);
  });
});
