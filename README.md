# rimowa-price-compare

> Repo name is historical (`eu-shopping-list`). The app compares **Rimowa
> luggage prices between rimowa.com EU and rimowa.com US** — not groceries.

Paste a list of Rimowa product URLs from either regional site and the app
will show a side-by-side comparison with:

- Raw prices — what you actually pay on each site (EU includes 19% VAT;
  US is pre-sales-tax)
- Tax-normalized prices — both sides stripped of VAT for an
  apples-to-apples comparison
- Live USD→EUR conversion from
  [exchangerate.host](https://exchangerate.host), cached for 24 hours
- A per-product "cheaper by X" summary on both the raw and normalized axes

By default the app runs in **mock mode** using bundled fixture data, so
you can demo the full UX without hitting rimowa.com. Live scraping is
opt-in.

## Quick start (native)

```bash
nvm use                    # Node 22
npm install
cp .env.example .env       # SCRAPE_MOCK=1 by default
npm run dev
# open http://localhost:3000
```

Paste one or more of the sample URLs below, click **Compare EU vs US**,
and you should see populated comparison cards.

## Sample Rimowa URLs (match the mock fixtures)

```
https://www.rimowa.com/eu/en/luggage/cabin/original-cabin/original-cabin-black/92552634.html
https://www.rimowa.com/us-en/luggage/check-in/hybrid/hybrid-check-in-l-black/92573634.html
https://www.rimowa.com/eu/en/luggage/check-in/essential/essential-check-in-l-silver/83273604.html
https://www.rimowa.com/it/it/luggage/colour/silver/cabin/97353004.html
```

You can paste URLs from either region — the app extracts the product code
and looks up the other region automatically.

## Supported URL shapes

The URL parser accepts:

- `www.rimowa.com/eu/<lang>/...` — pan-EU site (normalizes with a default 19% VAT)
- `www.rimowa.com/us-en/...` or `.../us/...` — US site
- `www.rimowa.com/<country>/<lang>/...` — any Eurozone country subdomain.
  Supported country codes: **AT, BE, CY, DE, EE, ES, FI, FR, GR, HR, IE,
  IT, LT, LU, LV, MT, NL, PT, SI, SK**. The "pre-tax" normalization uses
  the correct national VAT rate for the URL's country (e.g. 22% for
  `/it/it/`, 20% for `/fr/fr/`, 19% for `/de/de/`).

Non-Eurozone sites are intentionally rejected with a clear reason:
`/uk/`, `/gb/` (GBP), `/ch/` (CHF), `/jp/` (JPY), `/ca-en/` (CAD),
`/au-en/` (AUD), etc. Adding support for those would require a multi-
currency refactor that's out of scope for the MVP.

### VAT / cache semantics

Under the hood, the product cache stores exactly **one EU entry per
product code** regardless of which country subdomain you pasted.
Rimowa's EU country sites generally show the same EUR sticker across
countries; the national VAT rate is applied per-user at analysis time,
so comparing the same product via `/de/de/` and `/it/it/` will give
different "pre-tax" numbers (Italian 22% strips more VAT).

## Scripts

| Command             | What it does                              |
| ------------------- | ----------------------------------------- |
| `npm run dev`       | Next.js dev server                        |
| `npm run build`     | Production build                          |
| `npm start`         | Run the production build                  |
| `npm test`          | Vitest (always runs with `SCRAPE_MOCK=1`) |
| `npm run typecheck` | `tsc --noEmit`                            |
| `npm run lint`      | ESLint via `next lint`                    |

## Live scraping (opt-in)

```bash
npx playwright install chromium
echo "SCRAPE_MOCK=0" >> .env
npm run dev
```

In live mode the app launches headless chromium and scrapes
`rimowa.com/eu/en` and `rimowa.com/us-en` in parallel for each product
code. First run is slow (10–30 s) while chromium warms up and the FX rate
is fetched. Subsequent runs hit the SQLite cache (product data cached 6 h,
FX rate cached 24 h). If either region's page can't be parsed (anti-bot
challenge, DOM change, network timeout) the affected product is flagged
`error` or `partial` in the UI and the other item continues unaffected.

## How it works

1. **Parse** — `lib/rimowa-url.ts` extracts the 6–8 digit product code
   and source region from any rimowa.com URL.
2. **Fetch both regions in parallel** — `lib/orchestrator.ts` runs the EU
   and US scrapers simultaneously through `getCachedOrFetchProduct`.
3. **Fetch FX** — in parallel with the product fetches,
   `lib/fx.ts` pulls the USD→EUR rate from exchangerate.host (cached 24 h
   in SQLite; falls back to the last known good value on error).
4. **Compute** — for each product with both regions populated, compute
   raw EUR prices, net (pre-VAT / pre-sales-tax) prices, which side is
   cheaper, and by how much.
5. **Render** — `components/ComparisonGrid.tsx` shows one card per
   product with both regions side-by-side and the raw + normalized
   winners highlighted.

The scraper layer is an adapter pattern: `RegionScraper` has a single
method `fetchByCode(productCode, opts)`. The mock and the two live
adapters all implement the same interface, which makes registering a new
region (e.g. UK post-Brexit) a one-line change in `lib/scrapers/registry.ts`.

## Legal & Ethical Notice

**This project is an educational demo.** It fetches publicly available
product pricing from rimowa.com for demonstration purposes only.

- Not affiliated with Rimowa or LVMH.
- Prices may be inaccurate, delayed, or missing. Tax/duty/shipping are
  not included in any comparison.
- No data is redistributed; results are shown only to the user who
  initiated the query.
- Default `SCRAPE_MOCK=1` so a fresh clone never accidentally hits
  rimowa.com.
- You are responsible for complying with rimowa.com's Terms of Service.
  Do not use this tool for commercial price monitoring.
- If you deploy this publicly, you assume full responsibility for ToS
  and GDPR compliance.
- **Cross-border purchasing has real-world consequences** — customs
  duties, import VAT, warranty coverage, and return logistics all
  differ. This app does not account for any of them. Consult a
  professional before making a purchase decision.
