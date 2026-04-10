import { describe, it, expect, beforeEach, vi } from "vitest";
import { compare } from "@/lib/orchestrator";
import { resetDbForTest } from "@/lib/db";
import { setFetchImplForTest } from "@/lib/fx";

function stubFx(rate: number) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify({ rates: { EUR: rate } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  setFetchImplForTest(spy as unknown as typeof fetch);
  return spy;
}

describe("compare orchestrator (mock mode)", () => {
  beforeEach(() => {
    resetDbForTest();
    setFetchImplForTest(undefined);
  });

  it("returns EU + US data and computes analysis for a known product", async () => {
    stubFx(0.92);

    const res = await compare({
      urls: [
        "https://www.rimowa.com/eu/en/luggage/cabin/original-cabin/original-cabin-black/92552634.html",
      ],
    });

    expect(res.items).toHaveLength(1);
    const item = res.items[0];
    expect(item.status).toBe("ok");
    expect(item.productCode).toBe("92552634");
    expect(item.eu?.priceRaw).toBe(1350);
    expect(item.us?.priceRaw).toBe(1300);

    const a = item.analysis!;
    expect(a.usdToEurRate).toBe(0.92);
    // Pan-EU /eu/en/ URL → uses the default 19% rate
    expect(a.euVatRateApplied).toBe(0.19);
    expect(a.euRawEur).toBe(1350);
    // 1300 USD * 0.92 = 1196 EUR
    expect(a.usRawEur).toBeCloseTo(1196, 2);
    // EU net = 1350 / 1.19 ≈ 1134.45
    expect(a.euNetEur).toBeCloseTo(1134.45, 1);
    // US net = 1300 * 0.92 = 1196 (US has no VAT)
    expect(a.usNetEur).toBeCloseTo(1196, 2);

    // Raw: US (1196) is cheaper than EU (1350)
    expect(a.cheaperRaw).toBe("US");
    expect(a.savingsRawEur).toBeCloseTo(154, 1);

    // Normalized: EU (1134.45) is cheaper than US (1196) once you strip VAT
    expect(a.cheaperNormalized).toBe("EU");
    expect(a.savingsNormalizedEur).toBeGreaterThan(0);
  });

  it("applies country-specific VAT for an Italian URL (22%)", async () => {
    stubFx(0.92);
    const res = await compare({
      urls: [
        "https://www.rimowa.com/it/it/luggage/colour/silver/cabin/97353004.html",
      ],
    });
    expect(res.items).toHaveLength(1);
    const item = res.items[0];
    expect(item.status).toBe("ok");
    expect(item.productCode).toBe("97353004");

    const a = item.analysis!;
    expect(a.euVatRateApplied).toBe(0.22);
    // EU raw is 1275 EUR (from the fixture); net = 1275 / 1.22 ≈ 1045.08
    expect(a.euRawEur).toBe(1275);
    expect(a.euNetEur).toBeCloseTo(1045.08, 1);
    // US raw 1200 * 0.92 = 1104 EUR
    expect(a.usRawEur).toBeCloseTo(1104, 2);
    expect(a.usNetEur).toBeCloseTo(1104, 2);
  });

  it("uses different normalized values for /de/de/ vs /it/it/ on the same product", async () => {
    stubFx(0.92);
    const res = await compare({
      urls: [
        "https://www.rimowa.com/de/de/luggage/cabin/97353004.html",
        "https://www.rimowa.com/it/it/luggage/cabin/97353004.html",
      ],
    });

    const [de, it] = res.items;
    expect(de.status).toBe("ok");
    expect(it.status).toBe("ok");

    expect(de.analysis!.euVatRateApplied).toBe(0.19);
    expect(it.analysis!.euVatRateApplied).toBe(0.22);

    // Raw EU is the same sticker number (1275 EUR); only the normalized
    // number should differ, and the Italian net should be LOWER because
    // more VAT is being stripped out.
    expect(de.analysis!.euRawEur).toBe(it.analysis!.euRawEur);
    expect(it.analysis!.euNetEur).toBeLessThan(de.analysis!.euNetEur);
  });

  it("rejects a /uk/ URL with a GBP reason and continues other items", async () => {
    stubFx(0.92);
    const res = await compare({
      urls: [
        "https://www.rimowa.com/uk/en/luggage/cabin/92552634.html",
        "https://www.rimowa.com/eu/en/cabin/92552634.html",
      ],
    });
    expect(res.items).toHaveLength(2);
    expect(res.items[0].status).toBe("error");
    expect(res.items[0].reason).toMatch(/GBP/);
    expect(res.items[1].status).toBe("ok");
  });

  it("handles multiple URLs in parallel", async () => {
    stubFx(0.9);
    const res = await compare({
      urls: [
        "https://www.rimowa.com/eu/en/cabin/original/92552634.html",
        "https://www.rimowa.com/us-en/check-in/hybrid/92573634.html",
        "https://www.rimowa.com/eu/en/check-in/essential/83273604.html",
      ],
    });
    expect(res.items).toHaveLength(3);
    for (const item of res.items) {
      expect(item.status).toBe("ok");
      expect(item.analysis).toBeDefined();
    }
  });

  it("returns not_found when neither region has the product", async () => {
    stubFx(0.92);
    const res = await compare({
      urls: [
        "https://www.rimowa.com/eu/en/something/99999999.html",
      ],
    });
    expect(res.items[0].status).toBe("not_found");
    expect(res.items[0].analysis).toBeUndefined();
  });

  it("reports parse errors cleanly without failing the whole request", async () => {
    stubFx(0.92);
    const res = await compare({
      urls: [
        "not a url at all",
        "https://www.rimowa.com/eu/en/cabin/92552634.html",
      ],
    });
    expect(res.items).toHaveLength(2);
    expect(res.items[0].status).toBe("error");
    expect(res.items[0].reason).toMatch(/valid URL/i);
    expect(res.items[1].status).toBe("ok");
  });

  it("rejects non-Rimowa hosts per item", async () => {
    stubFx(0.92);
    const res = await compare({
      urls: ["https://www.example.com/luggage/92552634.html"],
    });
    expect(res.items[0].status).toBe("error");
    expect(res.items[0].reason).toMatch(/rimowa/i);
  });

  it("surfaces FX fallback as a top-level warning", async () => {
    setFetchImplForTest(
      vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );
    const res = await compare({
      urls: [
        "https://www.rimowa.com/eu/en/cabin/original/92552634.html",
      ],
    });
    // FX fallback should emit a warning.
    expect(res.warnings.some((w) => /FX/i.test(w))).toBe(true);
    // And still compute an analysis with the fallback rate.
    expect(res.items[0].analysis?.usdToEurRate).toBeGreaterThan(0);
  });
});
