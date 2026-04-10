import { mockRegionScraper } from "./mock";
import type { RegionScraper } from "./types";

/**
 * Return the active EU and US scrapers.
 *
 * - When `SCRAPE_MOCK=1` (the default), both are fixture-backed mocks.
 * - Otherwise, dynamically import the Playwright-backed live adapters so
 *   Playwright and chromium are never loaded in mock mode (keeps Vitest
 *   fast and keeps the client bundle clean).
 */
export async function getRegionScrapers(): Promise<{
  eu: RegionScraper;
  us: RegionScraper;
}> {
  if (process.env.SCRAPE_MOCK === "1") {
    return {
      eu: mockRegionScraper("EU"),
      us: mockRegionScraper("US"),
    };
  }
  const [{ rimowaEu }, { rimowaUs }] = await Promise.all([
    import("./rimowa-eu"),
    import("./rimowa-us"),
  ]);
  return { eu: rimowaEu, us: rimowaUs };
}
