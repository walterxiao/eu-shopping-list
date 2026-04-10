import { describe, it, expect } from "vitest";
import {
  parseRimowaUrl,
  RimowaUrlParseError,
} from "@/lib/rimowa-url";

describe("parseRimowaUrl", () => {
  it("parses a standard EU URL", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/eu/en/luggage/cabin/original-cabin/original-cabin-black/92552634.html",
    );
    expect(parsed.productCode).toBe("92552634");
    expect(parsed.sourceRegion).toBe("EU");
  });

  it("parses a standard US URL", () => {
    const parsed = parseRimowaUrl(
      "https://www.rimowa.com/us-en/luggage/cabin/original-cabin/original-cabin-black/92552634.html",
    );
    expect(parsed.productCode).toBe("92552634");
    expect(parsed.sourceRegion).toBe("US");
  });

  it("parses an EU URL with a non-English locale segment", () => {
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
    expect(parseRimowaUrl("https://www.rimowa.com/EU/en/x/92552634.html").sourceRegion).toBe("EU");
    expect(parseRimowaUrl("https://www.rimowa.com/US-EN/x/92552634.html").sourceRegion).toBe("US");
  });

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

  it("rejects an unknown region segment", () => {
    expect(() =>
      parseRimowaUrl("https://www.rimowa.com/asia/cabin/92552634.html"),
    ).toThrow(/region/i);
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
