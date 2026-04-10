import type { FetchOptions, RegionScraper, RimowaProduct } from "./types";
import { getRegionMeta } from "./regions";

/**
 * Placeholder for the live Rimowa EU scraper.
 *
 * The live implementation will use Playwright to navigate
 * `https://www.rimowa.com/eu/en/...<productCode>.html`, wait for the
 * price node, extract the raw price, and return a normalized
 * `RimowaProduct`. Until then, calling this in live mode throws a clear
 * error so the orchestrator surfaces it as a per-item `error` status and
 * the US side continues to work.
 */
export const rimowaEu: RegionScraper = {
  meta: getRegionMeta("EU"),
  async fetchByCode(
    _productCode: string,
    _options: FetchOptions,
  ): Promise<RimowaProduct | null> {
    throw new Error(
      "Live Rimowa EU scraper not yet implemented — set SCRAPE_MOCK=1 or implement lib/scrapers/rimowa-eu.ts",
    );
  },
};
