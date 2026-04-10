import type { FetchOptions, RegionScraper, RimowaProduct } from "./types";
import { getRegionMeta } from "./regions";

/**
 * Placeholder for the live Rimowa US scraper.
 *
 * The live implementation will use Playwright to navigate
 * `https://www.rimowa.com/us-en/...<productCode>.html`, wait for the
 * price node, extract the raw USD price, and return a normalized
 * `RimowaProduct`. Until then, calling this in live mode throws a clear
 * error so the orchestrator surfaces it as a per-item `error` status.
 */
export const rimowaUs: RegionScraper = {
  meta: getRegionMeta("US"),
  async fetchByCode(
    _productCode: string,
    _options: FetchOptions,
  ): Promise<RimowaProduct | null> {
    throw new Error(
      "Live Rimowa US scraper not yet implemented — set SCRAPE_MOCK=1 or implement lib/scrapers/rimowa-us.ts",
    );
  },
};
