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
    salesTaxRate: partial.salesTaxRate,
    jpTaxFreeRate: partial.jpTaxFreeRate,
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

/**
 * Test FX snapshot. Most tests only care about USD→EUR (most pre-v8
 * tests are US/EU only), but `groupAndAnalyze` now takes the full
 * three-currency snapshot, so we hand it plausible values for
 * HKD/JPY too. The HK and JP tests below construct different
 * snapshots when they need specific math.
 *
 * Numbers reflect rough late-2025 rates: 1 HKD ≈ 0.117 EUR,
 * 1 JPY ≈ 0.0061 EUR (i.e. ¥150 ≈ €0.92, HK$10 ≈ €1.17).
 */
const FX = { usdToEur: 0.92, hkdToEur: 0.117, jpyToEur: 0.0061, sarToEur: 0.245 };

describe("groupAndAnalyze", () => {
  it("returns an empty list for empty input", () => {
    expect(groupAndAnalyze([], FX)).toEqual([]);
  });

  it("returns a single-region card when only one item exists", () => {
    const items = [mk({ id: "only", region: "EU" })];
    const res = groupAndAnalyze(items, FX);
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
    const res = groupAndAnalyze(items, FX);
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
    // US with no explicit sales tax: falls back to the app default
    // (DEFAULT_US_SALES_TAX_RATE = 0.06, Northern VA ZIP 22180).
    // net = 1012 * 1.06 = 1072.72
    expect(us.netEur).toBeCloseTo(1072.72, 2);

    // Cheapest raw (sticker only): US (1012) still beats IT (1190)
    expect(card.cheapestRawItemId).toBe("us");
    // Cheapest net (after refund / after tax): IT (1047.20) beats
    // US-with-default-tax (1072.72) — the default sales tax flips
    // the winner from US to IT.
    expect(card.cheapestNetItemId).toBe("it");
  });

  it("supports 3+ region comparisons (the v7 ask)", () => {
    const items = [
      mk({ id: "de", host: "www.moncler.com", productCode: "L1", region: "EU", sourceCountry: "de", euRefundRate: 0.11, priceRaw: 1290 }),
      mk({ id: "it", host: "www.moncler.com", productCode: "L1", region: "EU", sourceCountry: "it", euRefundRate: 0.12, priceRaw: 1290 }),
      mk({ id: "fr", host: "www.moncler.com", productCode: "L1", region: "EU", sourceCountry: "fr", euRefundRate: 0.12, priceRaw: 1300 }),
      mk({ id: "us", host: "www.moncler.com", productCode: "L1", region: "US", currency: "USD", priceRaw: 1450 }),
    ];
    const res = groupAndAnalyze(items, FX);
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

    // Cheapest raw in EUR: US (1450 * 0.92 = 1334) vs EU items
    // (1290/1290/1300). DE and IT are 1290 → the first one in sorted
    // order wins.
    expect(["de", "it"]).toContain(card.cheapestRawItemId);

    // Cheapest after refund / after tax:
    //   DE net = 1290 * 0.89            = 1148.10
    //   IT net = 1290 * 0.88            = 1135.20
    //   FR net = 1300 * 0.88            = 1144.00
    //   US net = 1450 * 0.92 * 1.06     = 1413.88 (default 6% tax)
    // IT wins by a wider margin now that the US row carries tax.
    expect(card.cheapestNetItemId).toBe("it");
  });

  it("falls back to 0.12 for a pan-EU URL without a country", () => {
    const items = [
      mk({ id: "pan", region: "EU", sourceCountry: undefined, euRefundRate: undefined, priceRaw: 1000 }),
    ];
    const res = groupAndAnalyze(items, FX);
    const row = findRow(res[0], "pan");
    expect(row.netEur).toBeCloseTo(880, 2);
  });

  it("groups multiple unrelated products into separate cards", () => {
    // Different product names → different cards, even though the
    // default mk() host is shared. With the v9 name-based grouping
    // we MUST give the two products distinct names; otherwise
    // they'd merge into a single card by name.
    const items = [
      mk({ id: "a-eu", productCode: "A", productName: "Cabin Alpha", region: "EU", priceRaw: 1000 }),
      mk({ id: "a-us", productCode: "A", productName: "Cabin Alpha", region: "US", currency: "USD", priceRaw: 900 }),
      mk({ id: "b-eu", productCode: "B", productName: "Cabin Beta", region: "EU", priceRaw: 2000 }),
      mk({ id: "b-us", productCode: "B", productName: "Cabin Beta", region: "US", currency: "USD", priceRaw: 1800 }),
    ];
    const res = groupAndAnalyze(items, FX);
    expect(res).toHaveLength(2);
    expect(res.every((c) => c.prices.length === 2)).toBe(true);
  });

  it("groups color variants with the same name into one card (v9)", () => {
    // Different product codes — they're different colors of the
    // Rimowa Classic Cabin — but the user typed the same name for
    // both, so they should end up on the same card. This is the
    // v9 "same name = same product" grouping behavior.
    const items = [
      mk({
        id: "silver-eu",
        host: "www.rimowa.com",
        productCode: "97353004",
        productName: "Classic Cabin",
        region: "EU",
        sourceCountry: "it",
        euRefundRate: 0.12,
        priceRaw: 1275,
      }),
      mk({
        id: "black-eu",
        host: "www.rimowa.com",
        productCode: "97353005",
        productName: "Classic Cabin",
        region: "EU",
        sourceCountry: "it",
        euRefundRate: 0.12,
        priceRaw: 1275,
      }),
      mk({
        id: "silver-us",
        host: "www.rimowa.com",
        productCode: "97353004",
        productName: "Classic Cabin",
        region: "US",
        currency: "USD",
        priceRaw: 1200,
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    expect(res).toHaveLength(1);
    expect(res[0].prices).toHaveLength(3);
    // All three rows are on the card, regardless of differing codes.
    const ids = res[0].prices.map((p) => p.item.id).sort();
    expect(ids).toEqual(["black-eu", "silver-eu", "silver-us"]);
  });

  it("is case-insensitive and whitespace-insensitive for the name key", () => {
    // "Classic Cabin", "classic cabin", and "CLASSIC  CABIN  "
    // (extra/weird whitespace + mixed case) should all collapse
    // to the same bucket.
    const items = [
      mk({ id: "a", productName: "Classic Cabin", productCode: "X1" }),
      mk({ id: "b", productName: "classic cabin", productCode: "X2" }),
      mk({ id: "c", productName: "  CLASSIC   CABIN  ", productCode: "X3" }),
    ];
    const res = groupAndAnalyze(items, FX);
    expect(res).toHaveLength(1);
    expect(res[0].prices).toHaveLength(3);
  });

  it("splits items with the same code but different names (rename escape hatch)", () => {
    // If the user deliberately renames one item to separate it
    // from another that shares its productCode, the split should
    // actually take effect — names win over codes.
    const items = [
      mk({
        id: "silver",
        host: "www.rimowa.com",
        productCode: "X",
        productName: "Classic Cabin Silver",
      }),
      mk({
        id: "gold",
        host: "www.rimowa.com",
        productCode: "X",
        productName: "Classic Cabin Gold",
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    // Two cards — the user explicitly separated them by name.
    expect(res).toHaveLength(2);
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
    const res = groupAndAnalyze(items, FX);
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
    const res = groupAndAnalyze(items, FX);
    const us = findRow(res[0], "us");
    expect(us.rawUsd).toBe(1300);
    expect(us.rawEur).toBeCloseTo(1196, 2);
  });

  it("uses the country's refund rate from the stored item", () => {
    // Explicit rates on the item win over the default 0.12.
    const it = groupAndAnalyze(
      [mk({ id: "it", region: "EU", sourceCountry: "it", euRefundRate: 0.12, priceRaw: 1000 })],
      FX,
    );
    const de = groupAndAnalyze(
      [mk({ id: "de", region: "EU", sourceCountry: "de", euRefundRate: 0.11, priceRaw: 1000 })],
      FX,
    );
    const itNet = findRow(it[0], "it").netEur;
    const deNet = findRow(de[0], "de").netEur;
    // Italy refunds more, so the net is lower than Germany's.
    expect(itNet).toBeCloseTo(880, 2);
    expect(deNet).toBeCloseTo(890, 2);
    expect(itNet).toBeLessThan(deNet);
  });

  // ----- v7 sales-tax-on-US tests -----

  it("US item with no sales tax: applies the DEFAULT_US_SALES_TAX_RATE", () => {
    // When salesTaxRate is undefined (NULL in the DB), compute falls
    // back to DEFAULT_US_SALES_TAX_RATE (0.06 = Northern VA ZIP 22180)
    // rather than treating it as 0%. This makes the "no tax entered"
    // case match what most US online shoppers actually pay at
    // checkout without requiring them to re-open every row.
    const items = [
      mk({
        id: "us",
        region: "US",
        currency: "USD",
        priceRaw: 1000,
        // salesTaxRate omitted → undefined → default 6% applied
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const us = findRow(res[0], "us");
    expect(us.rawEur).toBeCloseTo(920, 2);
    // 920 * 1.06 = 975.20
    expect(us.netEur).toBeCloseTo(975.2, 2);
  });

  it("US item with explicit 0% sales tax: net === rawEur (override)", () => {
    // Setting salesTaxRate: 0 explicitly (vs leaving it undefined)
    // should disable the default — useful for modeling Oregon,
    // Montana, Delaware, or tax-free shipping.
    const items = [
      mk({
        id: "us",
        region: "US",
        currency: "USD",
        priceRaw: 1000,
        salesTaxRate: 0,
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const us = findRow(res[0], "us");
    expect(us.rawEur).toBeCloseTo(920, 2);
    expect(us.netEur).toBeCloseTo(920, 2);
  });

  it("US item with sales tax: net = rawEur × (1 + salesTaxRate)", () => {
    const items = [
      mk({
        id: "us-ca",
        region: "US",
        currency: "USD",
        priceRaw: 1000,
        salesTaxRate: 0.0725, // 7.25% California rate
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const us = findRow(res[0], "us-ca");
    expect(us.rawEur).toBeCloseTo(920, 2);
    // 920 × 1.0725 = 986.70
    expect(us.netEur).toBeCloseTo(986.7, 2);
  });

  it("compares EU after-refund vs US after-tax for the cheapest-net winner", () => {
    // €1000 IT @ 12% refund → €880 net
    // $1100 US @ 7.25% tax  → $1100 × 0.92 = €1012 → × 1.0725 = €1085.37
    // EU should be the cheapest after refund/tax
    const items = [
      mk({
        id: "it",
        region: "EU",
        sourceCountry: "it",
        euRefundRate: 0.12,
        priceRaw: 1000,
      }),
      mk({
        id: "us",
        region: "US",
        currency: "USD",
        priceRaw: 1100,
        salesTaxRate: 0.0725,
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const card = res[0];
    expect(findRow(card, "it").netEur).toBeCloseTo(880, 2);
    expect(findRow(card, "us").netEur).toBeCloseTo(1085.37, 1);
    expect(card.cheapestNetItemId).toBe("it");

    // The "raw" (sticker) winner is also IT in this example because
    // the US sticker converts to €1012 vs IT €1000.
    expect(card.cheapestRawItemId).toBe("it");
  });

  it("a high US sales tax can flip the winner from US to EU", () => {
    // EU net = 1000 × 0.88 = 880
    // US net = 920 × 1.10 = 1012  → EU wins
    // (vs without tax: US net would be 920 → US wins)
    const items = [
      mk({
        id: "it",
        region: "EU",
        sourceCountry: "it",
        euRefundRate: 0.12,
        priceRaw: 1000,
      }),
      mk({
        id: "us",
        region: "US",
        currency: "USD",
        priceRaw: 1000,
        salesTaxRate: 0.10, // 10% sales tax
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    expect(res[0].cheapestNetItemId).toBe("it");
  });

  it("EU items ignore salesTaxRate even if accidentally set", () => {
    const items = [
      mk({
        id: "eu",
        region: "EU",
        priceRaw: 1000,
        // EU items don't use salesTaxRate; the field should have no
        // effect on the math even if a malformed row carried it.
        salesTaxRate: 0.99,
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const eu = findRow(res[0], "eu");
    // Default refund 0.12 applied; salesTaxRate ignored.
    expect(eu.netEur).toBeCloseTo(880, 2);
  });

  // ----- diffVsUs tests -----

  it("attaches diffVsUsEur/Percent to non-US rows, scoped to the US baseline", () => {
    // US: $1100 × 0.92 = €1012, × 1.0725 = €1085.37 (after tax)
    // IT: €1000 × 0.88                      = €880    (after refund)
    //   → diff = 880 - 1085.37 = -205.37 ≈ -18.9%
    // DE: €1200 × 0.89                      = €1068.00
    //   → diff = 1068 - 1085.37 = -17.37 ≈ -1.6%
    const items = [
      mk({
        id: "it",
        region: "EU",
        sourceCountry: "it",
        euRefundRate: 0.12,
        priceRaw: 1000,
      }),
      mk({
        id: "de",
        region: "EU",
        sourceCountry: "de",
        euRefundRate: 0.11,
        priceRaw: 1200,
      }),
      mk({
        id: "us",
        region: "US",
        currency: "USD",
        priceRaw: 1100,
        salesTaxRate: 0.0725,
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const card = res[0];

    const it = findRow(card, "it");
    expect(it.diffVsUsEur).toBeCloseTo(-205.37, 1);
    expect(it.diffVsUsPercent).toBeCloseTo(-18.92, 1);

    const de = findRow(card, "de");
    expect(de.diffVsUsEur).toBeCloseTo(-17.37, 1);
    expect(de.diffVsUsPercent).toBeCloseTo(-1.6, 1);

    // US row is the baseline — it gets no diff.
    const us = findRow(card, "us");
    expect(us.diffVsUsEur).toBeUndefined();
    expect(us.diffVsUsPercent).toBeUndefined();
  });

  it("shows a positive diff when the EU row is more expensive than US after tax", () => {
    const items = [
      mk({
        id: "it",
        region: "EU",
        sourceCountry: "it",
        euRefundRate: 0.12,
        priceRaw: 1500, // net 1320
      }),
      mk({
        id: "us",
        region: "US",
        currency: "USD",
        priceRaw: 1000,
        salesTaxRate: 0, // net 920
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const it = findRow(res[0], "it");
    // 1320 - 920 = +400
    expect(it.diffVsUsEur).toBeCloseTo(400, 2);
    expect(it.diffVsUsPercent).toBeGreaterThan(0);
  });

  it("leaves diffVsUsEur undefined on all rows when the card has no US row", () => {
    const items = [
      mk({ id: "it", region: "EU", sourceCountry: "it", euRefundRate: 0.12, priceRaw: 1000 }),
      mk({ id: "de", region: "EU", sourceCountry: "de", euRefundRate: 0.11, priceRaw: 1000 }),
    ];
    const res = groupAndAnalyze(items, FX);
    for (const p of res[0].prices) {
      expect(p.diffVsUsEur).toBeUndefined();
      expect(p.diffVsUsPercent).toBeUndefined();
    }
  });

  it("leaves diffVsUs undefined when the only US row has NaN (FX missing)", () => {
    const items = [
      mk({ id: "eu", region: "EU", priceRaw: 1000 }),
      mk({ id: "us", region: "US", currency: "USD", priceRaw: 1100 }),
    ];
    const res = groupAndAnalyze(items, null); // fxRate missing → US net is NaN
    const eu = findRow(res[0], "eu");
    expect(eu.diffVsUsEur).toBeUndefined();
  });

  it("picks the cheapest US row as the baseline when multiple US entries exist", () => {
    // Two US entries for the same product (unusual but possible) —
    // the cheaper one is the baseline all EU rows compare against.
    const items = [
      mk({
        id: "us-cheap",
        region: "US",
        currency: "USD",
        priceRaw: 1000,
        salesTaxRate: 0, // net 920
      }),
      mk({
        id: "us-spendy",
        region: "US",
        currency: "USD",
        priceRaw: 1200,
        salesTaxRate: 0, // net 1104
      }),
      mk({
        id: "it",
        region: "EU",
        sourceCountry: "it",
        euRefundRate: 0.12,
        priceRaw: 1000, // net 880
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const it = findRow(res[0], "it");
    // Baseline is the cheaper US (920), not the spendy one (1104)
    expect(it.diffVsUsEur).toBeCloseTo(-40, 2);
  });
});

// ------------------------------------------------------------------
// Hong Kong + Japan — new in v8
// ------------------------------------------------------------------

describe("groupAndAnalyze — Japan and Hong Kong", () => {
  it("converts a JPY item to EUR and applies the 10% tax-free", () => {
    const items = [
      mk({
        id: "jp",
        region: "JP",
        currency: "JPY",
        priceRaw: 200_000,
        sourceCountry: "jp",
        // Default 10% tax-free is applied by compute when the row
        // has no explicit jpTaxFreeRate stored.
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const jp = findRow(res[0], "jp");
    // Sticker is ¥200,000. At jpyToEur 0.0061 → €1,220 raw EUR.
    expect(jp.rawEur).toBeCloseTo(1220, 1);
    expect(jp.rawJpy).toBe(200_000);
    // After 10% tourist tax-free, net is rawEur * 0.90 = €1,098.
    expect(jp.netEur).toBeCloseTo(1098, 1);
  });

  it("respects an explicit jpTaxFreeRate override", () => {
    const items = [
      mk({
        id: "jp-no-refund",
        region: "JP",
        currency: "JPY",
        priceRaw: 200_000,
        jpTaxFreeRate: 0, // user can't claim it (e.g. consumables under threshold)
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const jp = findRow(res[0], "jp-no-refund");
    // No refund → net == raw.
    expect(jp.netEur).toBeCloseTo(jp.rawEur, 2);
  });

  it("converts an HKD item to EUR with no tax adjustment", () => {
    const items = [
      mk({
        id: "hk",
        region: "HK",
        currency: "HKD",
        priceRaw: 10_000,
        sourceCountry: "hk",
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const hk = findRow(res[0], "hk");
    // Sticker is HK$10,000. At hkdToEur 0.117 → €1,170 raw EUR.
    expect(hk.rawEur).toBeCloseTo(1170, 1);
    expect(hk.rawHkd).toBe(10_000);
    // HK has no VAT/sales tax — net is exactly raw.
    expect(hk.netEur).toBeCloseTo(hk.rawEur, 2);
  });

  it("groups four regions of the same product and ranks them by net", () => {
    // Real-ish numbers for Rimowa Trunk Plus (product code 83280631).
    // Using deliberately crafted prices so the JP row wins after the
    // 10% tax-free is applied.
    const items = [
      mk({
        id: "us",
        region: "US",
        currency: "USD",
        priceRaw: 1500,
        salesTaxRate: 0.06, // net 1500 * 0.92 * 1.06 = 1462.8
        productCode: "83280631",
      }),
      mk({
        id: "eu-it",
        region: "EU",
        currency: "EUR",
        priceRaw: 1450,
        sourceCountry: "it",
        euRefundRate: 0.12, // net 1450 * 0.88 = 1276
        productCode: "83280631",
      }),
      mk({
        id: "jp",
        region: "JP",
        currency: "JPY",
        priceRaw: 220_000, // raw 220000 * 0.0061 = 1342, net * 0.9 = 1207.8
        sourceCountry: "jp",
        productCode: "83280631",
      }),
      mk({
        id: "hk",
        region: "HK",
        currency: "HKD",
        priceRaw: 11_500, // raw HK$11500 * 0.117 = 1345.5, no adjustment
        sourceCountry: "hk",
        productCode: "83280631",
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    expect(res).toHaveLength(1);
    const card = res[0];
    expect(card.prices).toHaveLength(4);

    // JP wins on net after the 10% tax-free.
    expect(card.cheapestNetItemId).toBe("jp");

    // Every non-US row gets a diff vs the US baseline (1462.8).
    const jp = findRow(card, "jp");
    const it = findRow(card, "eu-it");
    const hk = findRow(card, "hk");
    expect(jp.diffVsUsEur).toBeLessThan(0); // JP cheaper than US
    expect(it.diffVsUsEur).toBeLessThan(0); // IT cheaper than US
    expect(hk.diffVsUsEur).toBeLessThan(0); // HK cheaper than US
  });

  it("excludes JP/HK from cheapest-net selection when FX is null", () => {
    const items = [
      mk({
        id: "jp",
        region: "JP",
        currency: "JPY",
        priceRaw: 200_000,
      }),
      mk({
        id: "eu",
        region: "EU",
        currency: "EUR",
        priceRaw: 1000,
        euRefundRate: 0.12,
      }),
    ];
    const res = groupAndAnalyze(items, null);
    const card = res[0];
    const jp = findRow(card, "jp");
    expect(Number.isFinite(jp.netEur)).toBe(false);
    // The EU row is the only one with a finite net.
    expect(card.cheapestNetItemId).toBe("eu");
  });
});

// ------------------------------------------------------------------
// Saudi Arabia — new in SA addition
// ------------------------------------------------------------------

describe("groupAndAnalyze — Saudi Arabia", () => {
  it("converts a SAR item to EUR with no adjustment (like HK)", () => {
    const items = [
      mk({
        id: "sa",
        region: "SA",
        currency: "SAR",
        priceRaw: 5_000,
        sourceCountry: "sa",
      }),
    ];
    const res = groupAndAnalyze(items, FX);
    const sa = findRow(res[0], "sa");
    // Sticker is SAR 5,000. At sarToEur 0.245 → €1,225 raw EUR.
    expect(sa.rawEur).toBeCloseTo(1225, 1);
    expect(sa.rawSar).toBe(5_000);
    // SA has no refund/tax adjustment — net is exactly raw.
    expect(sa.netEur).toBeCloseTo(sa.rawEur, 2);
  });
});
