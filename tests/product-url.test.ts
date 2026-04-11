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
// Hong Kong + Japan — new in v8
// ------------------------------------------------------------------

describe("parseProductUrl — Rimowa Japan and Hong Kong", () => {
  // The actual URLs the user pasted as test fixtures.
  const RIMOWA_JP =
    "https://www.rimowa.com/jp/ja/luggage-collection-essential-trunk-plus/83280631.html";
  const RIMOWA_HK =
    "https://www.rimowa.com/hk/en/luggage/colour/black/trunk-plus/83280631.html";

  it("parses /jp/ja/ as Japan with the default 10% tax-free rate", () => {
    const p = parseProductUrl(RIMOWA_JP);
    expect(p.host).toBe("www.rimowa.com");
    expect(p.productCode).toBe("83280631");
    expect(p.sourceRegion).toBe("JP");
    expect(p.sourceCountry).toBe("jp");
    expect(p.jpTaxFreeRate).toBe(0.1);
    expect(p.euRefundRate).toBeUndefined();
  });

  it("parses /hk/en/ as Hong Kong with no refund/tax", () => {
    const p = parseProductUrl(RIMOWA_HK);
    expect(p.host).toBe("www.rimowa.com");
    expect(p.productCode).toBe("83280631");
    expect(p.sourceRegion).toBe("HK");
    expect(p.sourceCountry).toBe("hk");
    // HK has no refund and no tax-free.
    expect(p.euRefundRate).toBeUndefined();
    expect(p.jpTaxFreeRate).toBeUndefined();
  });

  it("parses bare /jp/ as Japan", () => {
    const p = parseProductUrl(
      "https://example.com/jp/men/cabin/12345678.html",
    );
    expect(p.sourceRegion).toBe("JP");
    expect(p.jpTaxFreeRate).toBe(0.1);
  });

  it("parses /hk/zh/ as Hong Kong", () => {
    const p = parseProductUrl(
      "https://example.com/hk/zh/men/cabin/12345678.html",
    );
    expect(p.sourceRegion).toBe("HK");
  });

  it("parses /ja-jp/ hyphenated locale as Japan", () => {
    const p = parseProductUrl(
      "https://example.com/ja-jp/men/cabin/12345678.html",
    );
    expect(p.sourceRegion).toBe("JP");
    expect(p.jpTaxFreeRate).toBe(0.1);
  });

  it("parses /jp-ja/ hyphenated locale as Japan", () => {
    const p = parseProductUrl(
      "https://example.com/jp-ja/men/cabin/12345678.html",
    );
    expect(p.sourceRegion).toBe("JP");
  });

  it("parses /en-hk/ hyphenated locale as Hong Kong", () => {
    const p = parseProductUrl(
      "https://example.com/en-hk/men/cabin/12345678.html",
    );
    expect(p.sourceRegion).toBe("HK");
  });

  it("parses /zh-hk/ hyphenated locale as Hong Kong", () => {
    const p = parseProductUrl(
      "https://example.com/zh-hk/men/cabin/12345678.html",
    );
    expect(p.sourceRegion).toBe("HK");
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

  it("parses a Van Cleef & Arpels URL with `CODE---slug` structure", () => {
    const parsed = parseProductUrl(
      "https://www.vancleefarpels.com/us/en/collections/jewelry/alhambra/vcarf48700---vintage-alhambra-pendant.html",
    );
    expect(parsed.host).toBe("www.vancleefarpels.com");
    expect(parsed.sourceRegion).toBe("US");
    expect(parsed.productCode).toBe("vcarf48700");
  });

  it("parses a Graff URL with `CODE_CODE` underscore-separated structure", () => {
    const parsed = parseProductUrl(
      "https://www.graff.com/us-en/jewelry/view-by-collection/laurence-graff-signature/rings/laurance-graff-signature-four-row-layered-diamond-ring/RGR1086ALL_RGR1086ALL.html",
    );
    expect(parsed.host).toBe("www.graff.com");
    expect(parsed.sourceRegion).toBe("US");
    expect(parsed.productCode).toBe("RGR1086ALL");
  });

  it("parses a Chanel URL where the SKU is an earlier path segment", () => {
    const parsed = parseProductUrl(
      "https://www.chanel.com/us/fashion/p/AS6233B24008U8393/maxi-flapbag-grained-calfskin-silver-tone-metal/",
    );
    expect(parsed.host).toBe("www.chanel.com");
    expect(parsed.sourceRegion).toBe("US");
    // The last segment is the descriptive slug (no digits). The parser
    // scans right-to-left, falls through to the whole-segment
    // alphanumeric pattern on the previous segment, and captures the
    // SKU there.
    expect(parsed.productCode).toBe("AS6233B24008U8393");
  });

  it("does NOT false-positive on a leading single-dash slug", () => {
    // "product-name" does not look like "CODE---slug", so the leading-
    // alphanumeric pattern should not fire. Pattern 2 (trailing after
    // dash) also fails because "name" has no digit. This URL should
    // be rejected as "no product code found".
    expect(() =>
      parseProductUrl("https://www.example.com/us-en/shop/product-name"),
    ).toThrow(/product code/i);
  });
});

// ------------------------------------------------------------------
// Homepage detection
// ------------------------------------------------------------------

describe("parseProductUrl — homepage detection", () => {
  it("rejects a bare /us/ landing page (Chanel homepage)", () => {
    expect(() =>
      parseProductUrl(
        "https://www.chanel.com/us/?gclsrc=aw.ds&gad_source=1&gclid=x",
      ),
    ).toThrow(/homepage|category/i);
  });

  it("rejects a /us-en/home/ URL (Graff homepage)", () => {
    expect(() =>
      parseProductUrl(
        "https://www.graff.com/us-en/home/?gad_source=1&gclid=x",
      ),
    ).toThrow(/homepage|category/i);
  });

  it("rejects a generic /us/shop/ landing page", () => {
    expect(() =>
      parseProductUrl("https://www.example.com/us/shop/"),
    ).toThrow(/homepage|category/i);
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
