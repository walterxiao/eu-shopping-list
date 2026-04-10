# rimowa-price-compare

> Repo is still named `eu-shopping-list` for historical reasons. The app
> compares **Rimowa luggage prices between the EU and US rimowa.com
> sites** using manually-entered prices and automatic VAT + FX math.

A small full-stack app for travelers who want to decide whether to buy
a Rimowa suitcase in the EU or the US. The app **never fetches
rimowa.com itself** — instead, you visit the site yourself, read the
current price, paste the URL into the app along with the price you saw,
and the app handles:

- Persisting your tracked items in SQLite so they survive restarts
- Pairing EU and US items automatically by product code
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

1. **Open rimowa.com in a new tab** — navigate to a product you're
   thinking of buying, for example:
   <https://www.rimowa.com/it/it/luggage/colour/silver/cabin/97353004.html>

2. **Copy the URL** and paste it into the app's URL field. Metadata
   badges appear immediately showing the extracted region, country,
   VAT rate, and product code. The app also shows a small
   "Open page to read price ↗" link that re-opens the page in a new
   tab in case you closed it.

3. **Read the price on rimowa.com** (the real price you'd actually
   pay, including VAT for EU sites).

4. **Back in the app**, type the product name and price, then click
   **Save item**. The item appears in the list on the left, marked
   with an `EU · IT` badge.

5. **Repeat for the US side** — visit
   <https://www.rimowa.com/us-en/.../97353004.html>, read the USD
   price, paste that URL into the app, type the same product name and
   the US price, click Save.

6. **The comparison card populates automatically** on the right
   because both regions now have a record for the same product code.
   It shows:
   - EU raw (with country VAT) and pre-tax (with the country VAT
     stripped out)
   - US raw in USD with the EUR conversion shown alongside
   - Which region is cheaper on the raw axis and by how much
   - Which region is cheaper on the normalized axis and by how much

7. **When you want to check for price changes**, click the stored URL
   in the item list (opens in a new tab), read the current price on
   rimowa.com, come back to the app, click **Edit** on the row, type
   the new price, click **Save**. The comparison card updates
   instantly.

## Supported URL shapes

The URL parser accepts:

- `www.rimowa.com/eu/<lang>/...` — pan-EU site (normalizes with a
  default 19% VAT)
- `www.rimowa.com/us-en/...` or `.../us/...` — US site
- `www.rimowa.com/<country>/<lang>/...` — any Eurozone country
  subdomain. Supported country codes: **AT, BE, CY, DE, EE, ES, FI,
  FR, GR, HR, IE, IT, LT, LU, LV, MT, NL, PT, SI, SK**. The "pre-tax"
  normalization uses the correct national VAT rate (22% for IT, 20%
  for FR, 19% for DE, …).

Non-Eurozone sites are intentionally rejected with a clear reason
(`/uk/`, `/gb/` → GBP; `/ch/` → CHF; `/jp/` → JPY; `/ca-en/` → CAD;
etc.).

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

It never fetches rimowa.com. The comparison analysis (grouping by
product code, VAT normalization, FX conversion, winner selection)
runs client-side as a pure function on the items + rate the server
returned.

## Scripts

| Command             | What it does                             |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Next.js dev server                       |
| `npm run build`     | Production build (Next.js standalone)    |
| `npm run start`     | Run the production build                 |
| `npm test`          | Vitest — 53 tests                        |
| `npm run typecheck` | `tsc --noEmit`                           |
| `npm run lint`      | ESLint via `next lint`                   |
| `npm run docker:up` | Build and run via docker compose         |

## Testing

53 tests across four files:

- `tests/rimowa-url.test.ts` (26) — URL parsing, Eurozone country
  code recognition, VAT rate lookup, explicit currency rejects
- `tests/fx.test.ts` (5) — FX fetcher with mocked HTTP: cache hits,
  stale fallback, hardcoded fallback, malformed payload
- `tests/items-store.test.ts` (12) — in-memory CRUD: EU metadata
  derivation, IT per-country VAT, US currency, malformed URL
  rejection, GBP rejection, name + price validation, newest-first
  ordering with ROWID tiebreak, update bumps updatedAt, delete
  returns true/false
- `tests/compute.test.ts` (10) — pure grouping function: empty
  input, single-side cards, paired analysis, per-country VAT
  differences (DE 19% vs IT 22% on identical raw prices),
  multi-product grouping, same-code dedup, null FX rate

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
