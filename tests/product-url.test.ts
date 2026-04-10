import { describe, it, expect } from "vitest";
import {
  parseProductUrl,
  ProductUrlParseError,
  EUROZONE_REFUND_RATE,
} from "@/lib/product-url";

// ------------------------------------------------------------------
// Rimowa (numeric SKU) — every v4 test preserved unchanged
// ------------------------------------------------------------------

describe("parseProductUrl — Rimowa pan-EU and US", () => {
  it("parses a standard /eu/en/ Rimowa URL", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/eu/en/luggage/cabin/original-cabin/original-cabin-black/92552634.html",
    );
    expect(parsed.host).toBe("www.rimowa.com");
    expect(parsed.productCode).toBe("92552634");
    expect(parsed.sourceRegion).toBe("EU");
    expect(parsed.sourceCountry).toBeUndefined();
    expect(parsed.euRefundRate).toBeUndefined();
  });

  it("parses a standard /us-en/ Rimowa URL", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/us-en/luggage/cabin/original-cabin/original-cabin-black/92552634.html",
    );
    expect(parsed.productCode).toBe("92552634");
    expect(parsed.sourceRegion).toBe("US");
    expect(parsed.sourceCountry).toBeUndefined();
    expect(parsed.euRefundRate).toBeUndefined();
  });

  it("parses /us/ (without the -en) as US", () => {
    expect(
      parseProductUrl("https://www.rimowa.com/us/cabin/92552634.html")
        .sourceRegion,
    ).toBe("US");
  });

  it("parses a /eu/fr/ locale variant", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/eu/fr/luggage/check-in/essential/essential-check-in-l/83273604.html",
    );
    expect(parsed.productCode).toBe("83273604");
    expect(parsed.sourceRegion).toBe("EU");
  });

  it("accepts URLs without the www subdomain", () => {
    const parsed = parseProductUrl(
      "https://rimowa.com/eu/en/product/92552634.html",
    );
    expect(parsed.host).toBe("rimowa.com");
    expect(parsed.sourceRegion).toBe("EU");
    expect(parsed.productCode).toBe("92552634");
  });

  it("accepts a bare numeric-segment URL (no .html)", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/eu/en/product/92552634",
    );
    expect(parsed.productCode).toBe("92552634");
  });

  it("is case-insensitive for the region segment", () => {
    expect(
      parseProductUrl("https://www.rimowa.com/EU/en/x/92552634.html")
        .sourceRegion,
    ).toBe("EU");
    expect(
      parseProductUrl("https://www.rimowa.com/US-EN/x/92552634.html")
        .sourceRegion,
    ).toBe("US");
  });
});

describe("parseProductUrl — Rimowa Eurozone country subdomains", () => {
  it("parses /it/it/ (Italian) with ~12% tourist refund rate", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/it/it/luggage/colour/silver/cabin/97353004.html",
    );
    expect(parsed.productCode).toBe("97353004");
    expect(parsed.sourceRegion).toBe("EU");
    expect(parsed.sourceCountry).toBe("it");
    expect(parsed.euRefundRate).toBe(0.12);
  });

  it("parses /de/de/ (Germany) with ~11% refund rate", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/de/de/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("de");
    expect(parsed.euRefundRate).toBe(0.11);
  });

  it("parses /fr/fr/ (France) with ~12% refund rate", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/fr/fr/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("fr");
    expect(parsed.euRefundRate).toBe(0.12);
  });

  it("parses /es/es/ (Spain) with ~13% refund rate", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/es/es/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("es");
    expect(parsed.euRefundRate).toBe(0.13);
  });

  it("parses /nl/nl/ (Netherlands) with ~10% refund rate", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/nl/nl/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("nl");
    expect(parsed.euRefundRate).toBe(0.10);
  });

  it("parses /pt/pt/ (Portugal) with ~14% refund rate", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/pt/pt/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("pt");
    expect(parsed.euRefundRate).toBe(0.14);
  });

  it("is case-insensitive for country codes", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/IT/IT/luggage/cabin/92552634.html",
    );
    expect(parsed.sourceCountry).toBe("it");
    expect(parsed.euRefundRate).toBe(0.12);
  });

  it("covers every country in EUROZONE_REFUND_RATE", () => {
    for (const country of Object.keys(EUROZONE_REFUND_RATE)) {
      const parsed = parseProductUrl(
        `https://www.rimowa.com/${country}/en/luggage/cabin/92552634.html`,
      );
      expect(parsed.sourceRegion).toBe("EU");
      expect(parsed.sourceCountry).toBe(country);
      expect(parsed.euRefundRate).toBe(EUROZONE_REFUND_RATE[country]);
    }
  });
});

// ------------------------------------------------------------------
// Moncler (alphanumeric SKU, hyphenated locale) — new in v5
// ------------------------------------------------------------------

describe("parseProductUrl — Moncler (alphanumeric SKU, en-us locale)", () => {
  const MONCLER_US =
    "https://www.moncler.com/en-us/men/outerwear/windbreakers-and-raincoats/etiache-hooded-rain-jacket-navy-blue-L10911A001605968E742.html";
  const MONCLER_IT =
    "https://www.moncler.com/it-it/men/outerwear/windbreakers-and-raincoats/etiache-hooded-rain-jacket-navy-blue-L10911A001605968E742.html";
  const MONCLER_FR =
    "https://www.moncler.com/fr-fr/men/outerwear/etiache-hooded-rain-jacket-L10911A001605968E742.html";
  const MONCLER_DE =
    "https://www.moncler.com/de-de/men/outerwear/etiache-hooded-rain-jacket-L10911A001605968E742.html";
  const MONCLER_UK =
    "https://www.moncler.com/en-gb/men/outerwear/etiache-hooded-rain-jacket-L10911A001605968E742.html";

  it("parses a /en-us/ Moncler US URL (alphanumeric SKU)", () => {
    const parsed = parseProductUrl(MONCLER_US);
    expect(parsed.host).toBe("www.moncler.com");
    expect(parsed.sourceRegion).toBe("US");
    expect(parsed.productCode).toBe("L10911A001605968E742");
    expect(parsed.sourceCountry).toBeUndefined();
    expect(parsed.euRefundRate).toBeUndefined();
  });

  it("parses a /it-it/ Moncler Italy URL with ~12% refund rate", () => {
    const parsed = parseProductUrl(MONCLER_IT);
    expect(parsed.host).toBe("www.moncler.com");
    expect(parsed.sourceRegion).toBe("EU");
    expect(parsed.productCode).toBe("L10911A001605968E742");
    expect(parsed.sourceCountry).toBe("it");
    expect(parsed.euRefundRate).toBe(0.12);
  });

  it("parses a /fr-fr/ Moncler France URL with ~12% refund rate", () => {
    const parsed = parseProductUrl(MONCLER_FR);
    expect(parsed.sourceRegion).toBe("EU");
    expect(parsed.sourceCountry).toBe("fr");
    expect(parsed.euRefundRate).toBe(0.12);
  });

  it("parses a /de-de/ Moncler Germany URL with ~11% refund rate", () => {
    const parsed = parseProductUrl(MONCLER_DE);
    expect(parsed.sourceRegion).toBe("EU");
    expect(parsed.sourceCountry).toBe("de");
    expect(parsed.euRefundRate).toBe(0.11);
  });

  it("rejects a /en-gb/ Moncler UK URL with a GBP reason", () => {
    expect(() => parseProductUrl(MONCLER_UK)).toThrow(/GBP/);
  });

  it("pairs the Moncler EU and US versions by product code", () => {
    const us = parseProductUrl(MONCLER_US);
    const it = parseProductUrl(MONCLER_IT);
    expect(us.productCode).toBe(it.productCode);
    expect(us.host).toBe(it.host);
    expect(us.sourceRegion).toBe("US");
    expect(it.sourceRegion).toBe("EU");
  });
});

describe("parseProductUrl — hostname-agnostic", () => {
  it("accepts a non-Rimowa hostname (the whole point of v5)", () => {
    // v4 used to reject this as "Expected a rimowa.com URL".
    const parsed = parseProductUrl(
      "https://www.example.com/eu/en/product/92552634.html",
    );
    expect(parsed.host).toBe("www.example.com");
    expect(parsed.productCode).toBe("92552634");
    expect(parsed.sourceRegion).toBe("EU");
  });

  it("normalizes the hostname to lowercase", () => {
    const parsed = parseProductUrl(
      "https://WWW.MONCLER.COM/en-us/outerwear/jacket-AB123CD.html",
    );
    expect(parsed.host).toBe("www.moncler.com");
  });

  it("rejects non-http(s) protocols", () => {
    expect(() =>
      parseProductUrl("ftp://www.rimowa.com/eu/en/x/92552634.html"),
    ).toThrow(/http/i);
  });
});

// ------------------------------------------------------------------
// Product code extraction edge cases
// ------------------------------------------------------------------

describe("parseProductUrl — product code extraction edge cases", () => {
  it("picks the trailing 8-digit number over shorter numeric noise", () => {
    const parsed = parseProductUrl(
      "https://www.rimowa.com/eu/en/cabin-2024/original/92552634.html",
    );
    expect(parsed.productCode).toBe("92552634");
  });

  it("requires alphanumeric codes to contain both letters and digits", () => {
    // "hooded" is 6+ letters but no digits — must not be picked as a code.
    expect(() =>
      parseProductUrl(
        "https://www.example.com/eu/en/outerwear/jacket-hooded.html",
      ),
    ).toThrow(/product code/i);
  });

  it("accepts a bare alphanumeric segment (Amazon-style ASIN)", () => {
    // No dash; whole segment is the code.
    const parsed = parseProductUrl(
      "https://www.example.com/us-en/dp/B0CHX1W1TX",
    );
    expect(parsed.productCode).toBe("B0CHX1W1TX");
    expect(parsed.sourceRegion).toBe("US");
  });
});

// ------------------------------------------------------------------
// Negative cases
// ------------------------------------------------------------------

describe("parseProductUrl — explicit rejects", () => {
  it("rejects /uk/ with a GBP reason", () => {
    expect(() =>
      parseProductUrl("https://www.rimowa.com/uk/en/cabin/92552634.html"),
    ).toThrow(/GBP/);
  });

  it("rejects /gb/ with a GBP reason", () => {
    expect(() =>
      parseProductUrl("https://www.rimowa.com/gb/en/cabin/92552634.html"),
    ).toThrow(/GBP/);
  });

  it("rejects /ch/ with a CHF reason", () => {
    expect(() =>
      parseProductUrl("https://www.rimowa.com/ch/de/cabin/92552634.html"),
    ).toThrow(/CHF/);
  });

  it("rejects /jp/ with a JPY reason", () => {
    expect(() =>
      parseProductUrl("https://www.rimowa.com/jp/ja/cabin/92552634.html"),
    ).toThrow(/JPY/);
  });

  it("rejects /ca-en/ with a CAD reason", () => {
    expect(() =>
      parseProductUrl("https://www.rimowa.com/ca-en/cabin/92552634.html"),
    ).toThrow(/CAD/);
  });

  it("rejects an unknown region segment with a generic message", () => {
    expect(() =>
      parseProductUrl("https://www.rimowa.com/asia/cabin/92552634.html"),
    ).toThrow(/region/i);
  });
});

describe("parseProductUrl — malformed input", () => {
  it("rejects non-URL input", () => {
    expect(() => parseProductUrl("not a url")).toThrow(
      ProductUrlParseError,
    );
  });

  it("rejects empty input", () => {
    expect(() => parseProductUrl("   ")).toThrow(/empty/i);
  });

  it("rejects a URL with no path", () => {
    expect(() => parseProductUrl("https://www.rimowa.com")).toThrow(
      /path/i,
    );
  });

  it("rejects a URL with no detectable region", () => {
    expect(() =>
      parseProductUrl("https://www.example.com/shop/cabin/92552634.html"),
    ).toThrow(/region/i);
  });

  it("rejects a URL with no product code", () => {
    expect(() =>
      parseProductUrl("https://www.rimowa.com/eu/en/luggage/cabin/"),
    ).toThrow(/product code/i);
  });
});
