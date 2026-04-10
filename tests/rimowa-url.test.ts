import { describe, it, expect } from "vitest";
import {
  parseRimowaUrl,
  RimowaUrlParseError,
  EUROZONE_VAT,
} from "@/lib/rimowa-url";

describe("parseRimowaUrl — pan-EU and US", () => {
  it("parses a standard /eu/en/ URL", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/eu/en/luggage/cabin/original-cabin/original-cabin-black/92552634.html",
    );
    expect(parsed.productCode).toBe("92552634");
    expect(parsed.sourceRegion).toBe("EU");
    expect(parsed.sourceCountry).toBeUndefined();
    expect(parsed.euVatRate).toBeUndefined();
  });

  it("parses a standard /us-en/ URL", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/us-en/luggage/cabin/original-cabin/original-cabin-black/92552634.html",
    );
    expect(parsed.productCode).toBe("92552634");
    expect(parsed.sourceRegion).toBe("US");
    expect(parsed.sourceCountry).toBeUndefined();
    expect(parsed.euVatRate).toBeUndefined();
  });

  it("parses /us/ (without the -en) as US", () => {
    expect(
      parseRimowaUrl("https://www.rimowa.com/us/cabin/92552634.html")
        .sourceRegion,
    ).toBe("US");
  });

  it("parses a /eu/fr/ locale variant", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/eu/fr/luggage/check-in/essential/essential-check-in-l/83273604.html",
    );
    expect(parsed.productCode).toBe("83273604");
    expect(parsed.sourceRegion).toBe("EU");
  });

  it("accepts URLs without the www subdomain", () => {
    const parsed = parseRimowaUrl(
      "https://rimowa.com/eu/en/.../92552634.html",
    );
    expect(parsed.sourceRegion).toBe("EU");
    expect(parsed.productCode).toBe("92552634");
  });

  it("accepts a bare numeric-segment URL", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/eu/en/product/92552634",
    );
    expect(parsed.productCode).toBe("92552634");
  });

  it("is case-insensitive for the region segment", () => {
    expect(
      parseRimowaUrl("https://www.rimowa.com/EU/en/x/92552634.html")
        .sourceRegion,
    ).toBe("EU");
    expect(
      parseRimowaUrl("https://www.rimowa.com/US-EN/x/92552634.html")
        .sourceRegion,
    ).toBe("US");
  });
});

describe("parseRimowaUrl — Eurozone country subdomains", () => {
  it("parses /it/it/ (Italian) with 22% VAT", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/it/it/luggage/colour/silver/cabin/97353004.html",
    );
    expect(parsed.productCode).toBe("97353004");
    expect(parsed.sourceRegion).toBe("EU");
    expect(parsed.sourceCountry).toBe("it");
    expect(parsed.euVatRate).toBe(0.22);
  });

  it("parses /de/de/ (Germany) with 19% VAT", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/de/de/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("de");
    expect(parsed.euVatRate).toBe(0.19);
  });

  it("parses /fr/fr/ (France) with 20% VAT", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/fr/fr/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("fr");
    expect(parsed.euVatRate).toBe(0.20);
  });

  it("parses /es/es/ (Spain) with 21% VAT", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/es/es/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("es");
    expect(parsed.euVatRate).toBe(0.21);
  });

  it("parses /nl/nl/ (Netherlands) with 21% VAT", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/nl/nl/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("nl");
    expect(parsed.euVatRate).toBe(0.21);
  });

  it("parses /pt/pt/ (Portugal) with 23% VAT", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/pt/pt/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("pt");
    expect(parsed.euVatRate).toBe(0.23);
  });

  it("is case-insensitive for country codes", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/IT/IT/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("it");
    expect(parsed.euVatRate).toBe(0.22);
  });

  it("covers every country in EUROZONE_VAT", () => {
    // Guarantees we don't accidentally drop a country from the map.
    for (const country of Object.keys(EUROZONE_VAT)) {
      const parsed = parseRimowaUrl(
        `https://www.rimowa.com/${country}/en/luggage/cabin/92552634.html`,
      );
      expect(parsed.sourceRegion).toBe("EU");
      expect(parsed.sourceCountry).toBe(country);
      expect(parsed.euVatRate).toBe(EUROZONE_VAT[country]);
    }
  });
});

describe("parseRimowaUrl — explicit rejects", () => {
  it("rejects /uk/ with a GBP reason", () => {
    expect(() =>
      parseRimowaUrl("https://www.rimowa.com/uk/en/cabin/92552634.html"),
    ).toThrow(/GBP/);
  });

  it("rejects /gb/ with a GBP reason", () => {
    expect(() =>
      parseRimowaUrl("https://www.rimowa.com/gb/en/cabin/92552634.html"),
    ).toThrow(/GBP/);
  });

  it("rejects /ch/ with a CHF reason", () => {
    expect(() =>
      parseRimowaUrl("https://www.rimowa.com/ch/de/cabin/92552634.html"),
    ).toThrow(/CHF/);
  });

  it("rejects /jp/ with a JPY reason", () => {
    expect(() =>
      parseRimowaUrl("https://www.rimowa.com/jp/ja/cabin/92552634.html"),
    ).toThrow(/JPY/);
  });

  it("rejects /ca-en/ with a CAD reason", () => {
    expect(() =>
      parseRimowaUrl("https://www.rimowa.com/ca-en/cabin/92552634.html"),
    ).toThrow(/CAD/);
  });

  it("rejects an unknown region segment with a generic message", () => {
    expect(() =>
      parseRimowaUrl("https://www.rimowa.com/asia/cabin/92552634.html"),
    ).toThrow(/Unrecognized region/i);
  });
});

describe("parseRimowaUrl — negative cases", () => {
  it("rejects non-URL input", () => {
    expect(() => parseRimowaUrl("not a url")).toThrow(RimowaUrlParseError);
  });

  it("rejects empty input", () => {
    expect(() => parseRimowaUrl("   ")).toThrow(/empty/i);
  });

  it("rejects non-Rimowa hosts", () => {
    expect(() =>
      parseRimowaUrl("https://www.example.com/eu/en/92552634.html"),
    ).toThrow(/rimowa/i);
  });

  it("rejects a URL with no product code", () => {
    expect(() =>
      parseRimowaUrl("https://www.rimowa.com/eu/en/luggage/cabin/"),
    ).toThrow(/product code/i);
  });

  it("picks the last numeric code when multiple numbers appear", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/eu/en/cabin-2024/original/92552634.html",
    );
    // "2024" is only 4 digits and must NOT be picked.
    expect(parsed.productCode).toBe("92552634");
  });
});
