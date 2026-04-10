# eu-vs-us price compare

> Repo is still named `eu-shopping-list` for historical reasons. The app
> compares **product prices between the EU and US sites of any
> retailer** using manually-entered prices and automatic VAT + FX math.
> It was originally built around Rimowa, but v5 generalizes the URL
> parser so any brand with a recognizable locale segment and trailing
> product code works — Rimowa, Moncler, Louis Vuitton, and anything
> structurally similar.

A small full-stack app for travelers who want to decide whether to buy
a luxury item (suitcase, jacket, watch, …) in the EU or the US. The
app **never fetches any retailer itself** — instead, you visit the
site yourself, read the current price, paste the URL into the app
along with the price you saw, and the app handles:

- Persisting your tracked items in SQLite so they survive restarts
- Pairing EU and US items automatically by `(host, productCode)` —
  scoping the pairing to the same host so two unrelated brands with a
  coincidentally-matching SKU never get cross-paired
- Stripping the correct per-country VAT from EU prices (22% for Italy,
  20% for France, 19% for Germany, …)
- Fetching and caching the USD→EUR rate from exchangerate.host (24 h)
- Computing both "raw" (what-you-actually-pay) and "pre-tax"
  (apples-to-apples) comparisons
- Highlighting the cheaper region on each axis

## Quick start (native)

```bash
nvm use                    # Node 22
npm install
cp .env.example .env
npm run dev
# open http://localhost:3000
```

## Quick start (Docker)

```bash
docker compose up --build
# open http://localhost:3000
```

The `./data` directory on your host is mounted into the container, so
`data/app.sqlite` (with your tracked items + FX cache) persists across
container restarts.

## Usage walkthrough

1. **Open the retailer's site in a new tab** — navigate to a product
   you're thinking of buying. A few examples that parse successfully:
   - <https://www.rimowa.com/it/it/luggage/colour/silver/cabin/97353004.html>
   - <https://www.moncler.com/en-us/men/outerwear/windbreakers-and-raincoats/etiache-hooded-rain-jacket-navy-blue-L10911A001605968E742.html>

2. **Copy the URL** and paste it into the app's URL field. Metadata
   badges appear immediately showing the host, extracted region,
   country, VAT rate, and product code. The app also shows a small
   "Open page to read price ↗" link that re-opens the page in a new
   tab in case you closed it.

3. **Read the price on the retailer's page** (the real price you'd
   actually pay, including VAT for EU sites).

4. **Back in the app**, type the product name and price, then click
   **Save item**. The item appears in the list on the left, marked
   with `www.moncler.com · EU · IT` (or whichever host/region applies).

5. **Repeat for the US side** — visit the same product on the
   retailer's US site, read the USD price, paste that URL into the
   app, and save. (The app will auto-suggest the product name because
   the `(host, productCode)` pair already exists.)

6. **The comparison card populates automatically** on the right
   because both regions now have a record for the same product code
   on the same host. It shows:
   - EU raw (with country VAT) and pre-tax (with the country VAT
     stripped out)
   - US raw in USD with the EUR conversion shown alongside
   - Which region is cheaper on the raw axis and by how much
   - Which region is cheaper on the normalized axis and by how much

7. **When you want to check for price changes**, click the stored URL
   in the item list (opens in a new tab), read the current price on
   the retailer's site, come back to the app, click **Edit** on the
   row, type the new price, click **Save**. The comparison card
   updates instantly.

## Supported URL shapes

The URL parser is hostname-agnostic — any e-commerce URL with a
recognizable locale segment and a trailing product code works. See
`lib/product-url.ts` for the exact rules.

**Locale segment** (one of these, scanned in the first 3 path
segments, case-insensitive):

- `/eu/` — pan-EU (default 19% VAT)
- `/us-en/`, `/en-us/`, or `/us/` — US
- `/it/`, `/de/`, `/fr/`, `/es/`, `/nl/`, … — any of the 20 Eurozone
  country codes (AT, BE, CY, DE, EE, ES, FI, FR, GR, HR, IE, IT, LT,
  LU, LV, MT, NL, PT, SI, SK)
- Hyphenated pairs like `/it-it/`, `/en-it/`, `/de-de/`, `/fr-fr/`,
  `/en-us/` — either half can carry the country signal
- The "pre-tax" normalization uses the correct national VAT rate
  (22% for IT, 20% for FR, 19% for DE, 17% for LU, 25% for HR, …)

**Product code** (extracted from the last path segment, stripping
`.html`/`.htm`):

- Trailing 6+ digit number (Rimowa: `.../92552634.html`)
- Trailing alphanumeric after a dash (Moncler:
  `.../etiache-...-L10911A001605968E742.html`, or Nike:
  `.../DD1391-100`)
- A bare alphanumeric token (Amazon-style ASIN: `.../dp/B0CHX1W1TX`)
- Alphanumeric codes must include at least one letter AND one digit
  so plain words like `-hooded` aren't mistaken for codes.

**Intentional rejects** — non-EUR / non-USD sites throw a specific
reason naming the currency:

`/uk/`, `/gb/`, `/en-gb/` → GBP; `/ch/` → CHF; `/jp/` → JPY;
`/ca-en/` → CAD; `/au-en/` → AUD; `/kr/` → KRW; `/cn/` → CNY;
`/sg/` → SGD; `/hk/` → HKD; `/ae/` → AED; `/sa/` → SAR.

Supporting any of these would require a multi-currency refactor;
for now the app is strictly EUR-vs-USD.

## Architecture at a glance

```
Browser                         Next.js backend
───────                         ───────────────
ShoppingListApp  ◀─── HTTP ───▶ /api/items  (GET / POST)
 ├─ items list                  /api/items/[id]  (PATCH / DELETE)
 ├─ fxRate                      /api/fx  (GET)
 └─ groupAndAnalyze()           │
    (pure function)             ▼
                             lib/items-store.ts   (CRUD)
                             lib/fx.ts            (24h FX cache)
                             lib/db.ts            (better-sqlite3)
                                   │
                                   ▼
                             data/app.sqlite
```

The backend's only jobs are:

1. Persist user-entered items in the `tracked_items` table
2. Proxy the FX rate from `exchangerate.host` and cache it for 24 h
   in the `fx_cache` table

It never fetches any retailer. The comparison analysis (grouping by
`(host, productCode)`, VAT normalization, FX conversion, winner
selection) runs client-side as a pure function on the items + rate
the server returned.

## Scripts

| Command             | What it does                             |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Next.js dev server                       |
| `npm run build`     | Production build (Next.js standalone)    |
| `npm run start`     | Run the production build                 |
| `npm test`          | Vitest — 95 tests                        |
| `npm run typecheck` | `tsc --noEmit`                           |
| `npm run lint`      | ESLint via `next lint`                   |
| `npm run docker:up` | Build and run via docker compose         |

## Testing

95 tests across five files:

- `tests/product-url.test.ts` (38) — URL parsing: Rimowa (numeric
  SKU) and Moncler (alphanumeric SKU) happy paths, every Eurozone
  country code, every rejected non-EUR/non-USD country, hostname
  normalization, non-http protocol rejection, edge cases around
  product code extraction (trailing-digit vs dashed-alphanumeric vs
  bare-alphanumeric ASIN)
- `tests/price-parse.test.ts` (26) — US and EU number formats,
  currency symbols, thousands separators, invalid input
- `tests/fx.test.ts` (5) — FX fetcher with mocked HTTP: cache hits,
  stale fallback, hardcoded fallback, malformed payload
- `tests/items-store.test.ts` (14) — in-memory CRUD: EU metadata
  derivation, IT per-country VAT, US currency, host field, Moncler
  alphanumeric SKU handling, malformed URL rejection, GBP
  rejection, name + price validation, newest-first ordering, update
  bumps updatedAt, delete returns true/false
- `tests/compute.test.ts` (12) — pure grouping function: empty
  input, single-side cards, paired analysis, per-country VAT
  differences (DE 19% vs IT 22% on identical raw prices),
  multi-product grouping, same-code dedup, null FX rate,
  cross-host collision guard (same product code under different
  hosts stays unpaired)

## Data persistence

Tracked items live in `data/app.sqlite` on the host (mounted into the
container for Docker users). To wipe everything and start fresh:

```bash
rm data/app.sqlite*
```

The schema is created automatically on startup by `lib/db.ts`.

## Deployment to AWS (future)

The same Docker image is deployable to AWS with minimal changes:

- **App Runner** (simplest) — push to ECR, point App Runner at the
  image. Note: App Runner doesn't support persistent volumes, so
  `data/app.sqlite` becomes ephemeral (users lose their items on
  redeploy). For personal use this may be acceptable.
- **ECS Fargate + EFS** — mount EFS at `/app/data` for true
  persistence across tasks.
- **EC2 + docker compose** — simplest persistent option; point the
  host volume at an EBS disk.
- **Long-term path** — migrate `items-store.ts` from SQLite to
  DynamoDB. Only `items-store.ts` and `fx.ts` need to change; the
  rest of the app is decoupled from storage.

Authentication is still out of scope. Anyone who can reach the server
can see and edit all items. For multi-user deployment you'd add
Auth.js with the SQLite adapter (see the v2 plan in the archive for
the design sketch).

## Legal & ethical notice

This project is an **educational demo** that processes user-entered
prices. It does not scrape, crawl, or automate access to rimowa.com.

- Not affiliated with Rimowa or LVMH.
- Prices are whatever you typed in; the app does not verify them.
- Customs duties, import VAT, warranty differences, and shipping
  costs are **not** modeled. A lower sticker price on one side does
  not mean lower total cost of ownership.
- Cross-border purchases have real consequences — consult a
  professional before acting on the numbers this app shows.
