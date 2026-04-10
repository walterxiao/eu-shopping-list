import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getRegionMeta } from "./regions";
import type {
  FetchOptions,
  Region,
  RegionScraper,
  RimowaProduct,
} from "./types";

const FIXTURE_ROOT = resolve(process.cwd(), "fixtures");

interface RawFixture {
  productCode: string;
  productName: string;
  priceRaw: number;
  url: string;
  imageUrl?: string;
}

async function loadFixture(
  region: Region,
  productCode: string,
): Promise<RawFixture | null> {
  const dir = region === "EU" ? "rimowa-eu" : "rimowa-us";
  const path = resolve(FIXTURE_ROOT, dir, `${productCode}.json`);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as RawFixture;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Create a fixture-backed region scraper. Used whenever `SCRAPE_MOCK=1` so
 * tests and demos never hit rimowa.com.
 */
export function mockRegionScraper(region: Region): RegionScraper {
  const meta = getRegionMeta(region);

  return {
    meta,
    async fetchByCode(
      productCode: string,
      _options: FetchOptions,
    ): Promise<RimowaProduct | null> {
      const fixture = await loadFixture(region, productCode);
      if (!fixture) return null;

      const product: RimowaProduct = {
        productCode: fixture.productCode,
        productName: fixture.productName,
        region,
        currency: meta.currency,
        priceRaw: fixture.priceRaw,
        url: fixture.url,
        imageUrl: fixture.imageUrl,
        scrapedAt: new Date().toISOString(),
      };
      return product;
    },
  };
}
