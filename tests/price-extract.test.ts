import { describe, it, expect } from "vitest";
import { extractPriceFromHtml } from "@/lib/price-extract";

describe("extractPriceFromHtml — JSON-LD", () => {
  it("extracts a Product with a single Offer", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Classic Cabin",
        "offers": {
          "@type": "Offer",
          "price": "1275.00",
          "priceCurrency": "EUR"
        }
      }</script>
      </head></html>`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 1275,
      currency: "EUR",
    });
  });

  it("extracts a Product with offers as an array", () => {
    const html = `
      <script type="application/ld+json">{
        "@type": "Product",
        "offers": [
          { "@type": "Offer", "price": 1450, "priceCurrency": "USD" },
          { "@type": "Offer", "price": 1500, "priceCurrency": "USD" }
        ]
      }</script>`;
    // First offer wins.
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 1450,
      currency: "USD",
    });
  });

  it("walks an @graph wrapper to find the Offer", () => {
    const html = `
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", "name": "Example" },
          { "@type": "BreadcrumbList", "itemListElement": [] },
          {
            "@type": "Product",
            "offers": { "@type": "Offer", "price": "899.99", "priceCurrency": "USD" }
          }
        ]
      }</script>`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 899.99,
      currency: "USD",
    });
  });

  it("handles a numeric price (not stringified)", () => {
    const html = `
      <script type="application/ld+json">{
        "@type": "Offer",
        "price": 1190,
        "priceCurrency": "EUR"
      }</script>`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 1190,
      currency: "EUR",
    });
  });

  it("parses an EU-formatted price string (1.190,00)", () => {
    const html = `
      <script type="application/ld+json">{
        "@type": "Offer",
        "price": "1.190,00",
        "priceCurrency": "EUR"
      }</script>`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 1190,
      currency: "EUR",
    });
  });

  it("parses a US-formatted price string (1,190.00)", () => {
    const html = `
      <script type="application/ld+json">{
        "@type": "Offer",
        "price": "1,190.00",
        "priceCurrency": "USD"
      }</script>`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 1190,
      currency: "USD",
    });
  });

  it("rejects unsupported currencies (GBP)", () => {
    const html = `
      <script type="application/ld+json">{
        "@type": "Offer",
        "price": "1500",
        "priceCurrency": "GBP"
      }</script>`;
    expect(extractPriceFromHtml(html)).toBeNull();
  });

  it("survives a script block with malformed JSON", () => {
    const html = `
      <script type="application/ld+json">{ this is not json }</script>
      <script type="application/ld+json">{
        "@type": "Offer",
        "price": "500",
        "priceCurrency": "USD"
      }</script>`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 500,
      currency: "USD",
    });
  });

  it("strips CDATA wrappers", () => {
    const html = `
      <script type="application/ld+json">/*<![CDATA[*/{
        "@type": "Offer",
        "price": "750.50",
        "priceCurrency": "EUR"
      }/*]]>*/</script>`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 750.5,
      currency: "EUR",
    });
  });

  it("returns null when JSON-LD has no Offer", () => {
    const html = `
      <script type="application/ld+json">{
        "@type": "WebSite",
        "name": "Example"
      }</script>`;
    expect(extractPriceFromHtml(html)).toBeNull();
  });
});

describe("extractPriceFromHtml — OpenGraph meta tags", () => {
  it("extracts product:price:amount + currency", () => {
    const html = `
      <head>
        <meta property="product:price:amount" content="1275.00" />
        <meta property="product:price:currency" content="EUR" />
      </head>`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 1275,
      currency: "EUR",
    });
  });

  it("extracts og:price:amount as a fallback", () => {
    const html = `
      <meta property="og:price:amount" content="1450" />
      <meta property="og:price:currency" content="USD" />`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 1450,
      currency: "USD",
    });
  });

  it("tolerates content-attribute-first ordering", () => {
    const html = `
      <meta content="999" property="product:price:amount" />
      <meta content="USD" property="product:price:currency" />`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 999,
      currency: "USD",
    });
  });

  it("returns null when only the amount is present", () => {
    const html = `<meta property="product:price:amount" content="100" />`;
    expect(extractPriceFromHtml(html)).toBeNull();
  });
});

describe("extractPriceFromHtml — microdata", () => {
  it("extracts itemprop=price + itemprop=priceCurrency", () => {
    const html = `
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="price" content="1190.00">$1,190.00</span>
        <meta itemprop="priceCurrency" content="USD" />
      </div>`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 1190,
      currency: "USD",
    });
  });

  it("falls back to lowPrice when price isn't present", () => {
    const html = `
      <span itemprop="lowPrice" content="850" />
      <meta itemprop="priceCurrency" content="EUR" />`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 850,
      currency: "EUR",
    });
  });
});

describe("extractPriceFromHtml — strategy precedence", () => {
  it("prefers JSON-LD over OpenGraph when both are present", () => {
    const html = `
      <meta property="product:price:amount" content="999" />
      <meta property="product:price:currency" content="USD" />
      <script type="application/ld+json">{
        "@type": "Offer",
        "price": "1275",
        "priceCurrency": "EUR"
      }</script>`;
    // JSON-LD wins.
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 1275,
      currency: "EUR",
    });
  });

  it("falls back to OpenGraph when JSON-LD has no Offer", () => {
    const html = `
      <script type="application/ld+json">{
        "@type": "WebSite",
        "name": "Example"
      }</script>
      <meta property="product:price:amount" content="500" />
      <meta property="product:price:currency" content="EUR" />`;
    expect(extractPriceFromHtml(html)).toEqual({
      priceRaw: 500,
      currency: "EUR",
    });
  });
});

describe("extractPriceFromHtml — failure modes", () => {
  it("returns null when there is no price anywhere", () => {
    expect(
      extractPriceFromHtml("<html><body>no price here</body></html>"),
    ).toBeNull();
  });

  it("returns null on an empty string", () => {
    expect(extractPriceFromHtml("")).toBeNull();
  });

  it("returns null when the price is zero or negative", () => {
    const html = `
      <script type="application/ld+json">{
        "@type": "Offer",
        "price": 0,
        "priceCurrency": "EUR"
      }</script>`;
    expect(extractPriceFromHtml(html)).toBeNull();
  });
});
