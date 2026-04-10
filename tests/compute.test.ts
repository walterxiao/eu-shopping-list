import { describe, it, expect } from "vitest";
import { groupAndAnalyze } from "@/lib/compute";
import type { TrackedItem } from "@/lib/types";

function mk(partial: Partial<TrackedItem>): TrackedItem {
  return {
    id: partial.id ?? `id-${Math.random()}`,
    url: partial.url ?? "https://www.rimowa.com/eu/en/x/92552634.html",
    productCode: partial.productCode ?? "92552634",
    region: partial.region ?? "EU",
    sourceCountry: partial.sourceCountry,
    euVatRate: partial.euVatRate,
    productName: partial.productName ?? "Original Cabin — Black",
    priceRaw: partial.priceRaw ?? 1350,
    currency: partial.currency ?? "EUR",
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
  };
}

describe("groupAndAnalyze", () => {
  it("returns an empty list for empty input", () => {
    expect(groupAndAnalyze([], 0.92)).toEqual([]);
  });

  it("returns a single_eu card when only the EU side exists", () => {
    const items = [mk({ region: "EU" })];
    const res = groupAndAnalyze(items, 0.92);
    expect(res).toHaveLength(1);
    expect(res[0].status).toBe("single_eu");
    expect(res[0].eu).toBeDefined();
    expect(res[0].us).toBeUndefined();
    expect(res[0].analysis).toBeUndefined();
  });

  it("returns a single_us card when only the US side exists", () => {
    const items = [mk({ region: "US", currency: "USD", priceRaw: 1300 })];
    const res = groupAndAnalyze(items, 0.92);
    expect(res).toHaveLength(1);
    expect(res[0].status).toBe("single_us");
    expect(res[0].us).toBeDefined();
    expect(res[0].eu).toBeUndefined();
  });

  it("pairs EU + US by product code and computes analysis", () => {
    const items = [
      mk({ region: "EU", priceRaw: 1350 }),
      mk({ region: "US", currency: "USD", priceRaw: 1300 }),
    ];
    const res = groupAndAnalyze(items, 0.92);
    expect(res).toHaveLength(1);
    expect(res[0].status).toBe("ok");
    expect(res[0].analysis).toBeDefined();

    const a = res[0].analysis!;
    expect(a.usdToEurRate).toBe(0.92);
    // Default EU VAT rate (0.19) since the mock item has no country.
    expect(a.euVatRateApplied).toBe(0.19);
    expect(a.euRawEur).toBe(1350);
    expect(a.usRawEur).toBeCloseTo(1196, 2);
    expect(a.euNetEur).toBeCloseTo(1134.45, 1);
    expect(a.usNetEur).toBeCloseTo(1196, 2);
    expect(a.cheaperRaw).toBe("US");
    expect(a.cheaperNormalized).toBe("EU");
  });

  it("uses the EU item's per-country VAT rate (22% for IT)", () => {
    const items = [
      mk({
        region: "EU",
        sourceCountry: "it",
        euVatRate: 0.22,
        priceRaw: 1275,
        productCode: "97353004",
      }),
      mk({
        region: "US",
        currency: "USD",
        priceRaw: 1200,
        productCode: "97353004",
      }),
    ];
    const res = groupAndAnalyze(items, 0.92);
    const a = res[0].analysis!;
    expect(a.euVatRateApplied).toBe(0.22);
    expect(a.euNetEur).toBeCloseTo(1045.08, 1);
  });

  it("produces different normalized results for DE vs IT on the same raw prices", () => {
    const de = groupAndAnalyze(
      [
        mk({
          region: "EU",
          sourceCountry: "de",
          euVatRate: 0.19,
          priceRaw: 1275,
          productCode: "97353004",
        }),
        mk({
          region: "US",
          currency: "USD",
          priceRaw: 1200,
          productCode: "97353004",
        }),
      ],
      0.92,
    );
    const it = groupAndAnalyze(
      [
        mk({
          region: "EU",
          sourceCountry: "it",
          euVatRate: 0.22,
          priceRaw: 1275,
          productCode: "97353004",
        }),
        mk({
          region: "US",
          currency: "USD",
          priceRaw: 1200,
          productCode: "97353004",
        }),
      ],
      0.92,
    );
    expect(de[0].analysis!.euRawEur).toBe(it[0].analysis!.euRawEur);
    // Italian net is lower than German net because more VAT is stripped.
    expect(it[0].analysis!.euNetEur).toBeLessThan(
      de[0].analysis!.euNetEur,
    );
  });

  it("groups multiple unrelated products into separate cards", () => {
    const items = [
      mk({ productCode: "A", region: "EU" }),
      mk({ productCode: "A", region: "US", currency: "USD" }),
      mk({ productCode: "B", region: "EU" }),
      mk({ productCode: "B", region: "US", currency: "USD" }),
    ];
    const res = groupAndAnalyze(items, 0.92);
    expect(res).toHaveLength(2);
    expect(res.every((i) => i.status === "ok")).toBe(true);
  });

  it("mixes paired and single-side cards", () => {
    const items = [
      mk({ productCode: "A", region: "EU" }),
      mk({ productCode: "A", region: "US", currency: "USD" }),
      mk({ productCode: "B", region: "EU" }),
    ];
    const res = groupAndAnalyze(items, 0.92);
    expect(res).toHaveLength(2);
    const byCode = Object.fromEntries(res.map((r) => [r.productCode, r]));
    expect(byCode.A.status).toBe("ok");
    expect(byCode.B.status).toBe("single_eu");
  });

  it("when two EU items share a product code, keeps the newer one", () => {
    const older = mk({
      productCode: "A",
      region: "EU",
      priceRaw: 1000,
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    const newer = mk({
      productCode: "A",
      region: "EU",
      priceRaw: 1200,
      updatedAt: "2024-06-01T00:00:00.000Z",
    });
    const res = groupAndAnalyze([older, newer], 0.92);
    expect(res).toHaveLength(1);
    expect(res[0].eu!.priceRaw).toBe(1200);
  });

  it("produces cards with no analysis when fxRate is null", () => {
    const items = [
      mk({ region: "EU" }),
      mk({ region: "US", currency: "USD" }),
    ];
    const res = groupAndAnalyze(items, null);
    expect(res[0].status).toBe("ok");
    expect(res[0].analysis).toBeUndefined();
  });
});
