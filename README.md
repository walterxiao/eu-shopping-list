# eu-vs-us price compare

> Repo is still named `eu-shopping-list` for historical reasons. The app
> compares **product prices across as many regions as you like** using
> manually-entered prices and automatic tourist-refund + FX math.
> It started as a Rimowa EU-vs-US checker but now works with any brand
> that has a recognizable locale segment and trailing product code —
> Rimowa, Moncler, Louis Vuitton, and anything structurally similar.

A small full-stack app for travelers deciding where to buy a luxury
item (suitcase, jacket, watch, …) across regions. The app **never
fetches any retailer itself** — instead, you visit the site yourself,
read the current price, paste the URL and the price you saw, and the
app handles:

- Persisting your tracked items in SQLite so they survive restarts
- Pairing items automatically by `(host, productCode)` so multiple
  country versions of the same product end up on one card
- **Supports 2+ regions per product** — compare US + IT + DE + FR
  all on the same card (not just EU vs US)
- Modeling the **tourist VAT refund** (Global Blue / Planet) for each
  EU country so the "Net" column reflects what a non-EU visitor
  actually pays at the airport, not a theoretical pre-VAT wholesale
  price
- Modeling the **US sales tax** that gets added at checkout (entered
  per item; defaults to 0%) so US prices are compared at-checkout,
  not as the pre-tax sticker shown on the website
- Fetching and caching the USD→EUR rate from exchangerate.host (24 h)
- Picking the cheapest **after-refund / after-tax** row across the
  whole card and highlighting it green

## Quick start (native)

```bash
nvm use                    # Node 22
npm install
cp .env.example .env
npm run dev
# open http://localhost:9753
```

## Quick start (Docker)

```bash
docker compose up --build
# open http://localhost:9753
```

The `./data` directory on your host is mounted into the container, so
`data/app.sqlite` (with your tracked items + FX cache) persists across
container restarts.

## Usage walkthrough

1. **Click `+ Track a new item`** in the top-right of the page — a
   modal opens.

2. **Open the retailer's site in a new tab** — navigate to a product
   you're thinking of buying. A few examples that parse successfully:
   - <https://www.rimowa.com/it/it/luggage/colour/silver/cabin/97353004.html>
   - <https://www.moncler.com/en-us/men/outerwear/windbreakers-and-raincoats/etiache-hooded-rain-jacket-navy-blue-L10911A001605968E742.html>

3. **Paste the URL** into the modal's URL field. Metadata badges
   appear immediately: host, region, country code, tourist refund
   rate (EU only), product code. The modal also shows an "Open
   page ↗" link in case you closed the retailer tab.

4. **Read the price on the retailer's page** (the sticker — what
   the website displays. EU sites include VAT; US sites do not
   include sales tax).

5. **Type the product name and price.** For **US** URLs, the modal
   also shows a **Sales tax %** input. It pre-fills with **6%**
   (the all-in rate for Northern Virginia / ZIP 22180 — 5.3%
   state + local + 0.7% NoVa regional). If you ship somewhere else,
   override it: e.g. `7.25` for California, `8.875` for NYC, `0`
   for tax-free states like Oregon / Montana / Delaware. See
   `DEFAULT_US_SALES_TAX_RATE` in `lib/compute.ts` to change the
   global default. Click **Save item**. The modal closes and a
   card appears.

6. **Add more regions to the same product.** Scroll to the card and
   click **+ Add another region**. A small inline form appears
   right on the card — paste the URL for a different country
   (say `/de-de/` or `/us-en/`), enter that country's price, click
   **Add**. The app validates that the URL is for the same product
   (same host + same product code) and adds a new row to the card.
   You can repeat this as many times as you like — compare US + IT +
   DE + FR side-by-side on one card.

7. **Read the comparison.** The card shows a table with one row per
   stored region:

   | Region | Sticker | Adj. | Net (EUR) | Updated |
   |---|---|---|---|---|
   | EU · IT | €1,190 | −12% refund | **€1,047.20** | just now |
   | US     | $1,100 (≈ €1,012 pre-tax) | +7.25% tax | **€1,085.37** after tax | just now |

   - **EU rows** show the sticker (incl. local VAT) and the Net
     after subtracting the tourist refund.
   - **US rows** show the USD sticker (with the EUR conversion
     below as "pre-tax"), and the Net after **adding** the sales
     tax you entered.
   - The **cheapest Net** row across all regions is highlighted
     green. That's the apples-to-apples winner — EU after refund
     compared against US after sales tax.

8. **Update prices as they change.** Click the stored URL to revisit
   the retailer (opens in a new tab). Read the new price, come back
   to the app, click **Edit** on that row. For US rows you can edit
   both the sticker AND the sales tax % inline. Click **Save**. The
   comparison updates instantly.

### Keyboard & UX notes

- The modal closes on `Escape` or clicking outside the dialog.
- The "Add another region" form is validated inline: paste a URL
  from a different host or different product code and you'll see
  "URL host doesn't match this card" before you can submit.
- If you re-paste a URL for a region you already tracked, the form
  rejects with "an entry for that region already exists — edit it
  instead".

## Supported URL shapes

The URL parser is hostname-agnostic — any e-commerce URL with a
recognizable locale segment and a trailing product code works. See
`lib/product-url.ts` for the exact rules.

**Locale segment** (one of these, scanned in the first 3 path
segments, case-insensitive):

- `/eu/` — pan-EU (default ~12% tourist refund)
- `/us-en/`, `/en-us/`, or `/us/` — US (no tourist refund)
- `/it/`, `/de/`, `/fr/`, `/es/`, `/nl/`, … — any of the 20 Eurozone
  country codes (AT, BE, CY, DE, EE, ES, FI, FR, GR, HR, IE, IT, LT,
  LU, LV, MT, NL, PT, SI, SK)
- Hyphenated pairs like `/it-it/`, `/en-it/`, `/de-de/`, `/fr-fr/`,
  `/en-us/` — either half can carry the country signal
- The "Net (EUR)" column uses an approximate **tourist refund rate**
  per country (Italy ~12%, Germany ~11%, Finland ~16%, …). This is
  NOT the VAT rate — it's the net amount a non-EU visitor receives
  back from Global Blue / Planet at the airport, after processing
  fees are deducted. See `lib/product-url.ts` for the full table.

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
`(host, productCode)`, tourist-refund normalization, FX conversion,
winner selection) runs client-side as a pure function on the items +
rate the server returned.

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

108 tests across five files:

- `tests/product-url.test.ts` (38) — URL parsing: Rimowa (numeric
  SKU) and Moncler (alphanumeric SKU) happy paths, every Eurozone
  country code with its refund rate, every rejected non-EUR/non-USD
  country, hostname normalization, non-http protocol rejection,
  edge cases around product code extraction
- `tests/price-parse.test.ts` (26) — US and EU number formats,
  currency symbols, thousands separators, invalid input
- `tests/fx.test.ts` (5) — FX fetcher with mocked HTTP: cache hits,
  stale fallback, hardcoded fallback, malformed payload
- `tests/items-store.test.ts` (24) — in-memory CRUD + on-disk
  v4→v7 upgrade migration: EU metadata derivation, per-country
  refund rate (IT 0.12), US currency, host field, Moncler
  alphanumeric SKU, malformed URL rejection, GBP rejection,
  **salesTaxRate stored on US items / ignored on EU items**,
  validation that sales tax must be a fraction 0..1, migration:
  add host column, rename eu_vat_rate → eu_refund_rate, rewrite
  0.22 → 0.12, **add sales_tax_rate column**, set user_version
  to 7
- `tests/compute.test.ts` (15) — pure grouping function: empty
  input, single-region card, paired EU + US with refund math,
  **3+ region comparison** (DE / IT / FR / US on one product),
  per-country refund rates, null FX rate (NaN-safe), cross-host
  collision guard, **US sales-tax math** (back-compat default 0%,
  CA 7.25%, EU-vs-US after-refund-vs-after-tax winner selection,
  high US sales tax can flip the winner from US to EU)

## Data persistence

Tracked items live in `data/app.sqlite` on the host (mounted into the
container for Docker users). To wipe everything and start fresh:

```bash
rm data/app.sqlite*
```

The schema is created automatically on startup by `lib/db.ts`.

## Deployment to EC2 (GitHub Actions)

Pushes to `main` automatically deploy to your EC2 instance via the
workflow in `.github/workflows/deploy.yml`. The workflow SSHes to the
box, pulls the new commit, runs `scripts/deploy-on-ec2.sh`, and waits
for a healthcheck against `http://localhost:9753/api/items` before
reporting success.

### One-time setup on the EC2 box

The workflow assumes the box has Node 22, pm2, and git, and that the
repository is already cloned to a known directory. Bootstrap once:

```bash
# SSH in
ssh ec2-user@<your-ec2-ip>

# Install Node 22 + build tools (Amazon Linux 2023)
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs git python3 make gcc-c++

# Install pm2 and wire it into systemd so the app survives reboots
sudo npm install -g pm2
pm2 startup systemd -u ec2-user --hp /home/ec2-user
# (run the sudo command pm2 prints)

# Clone the repo
git clone https://github.com/<owner>/eu-shopping-list.git ~/eu-shopping-list
cd ~/eu-shopping-list
npm ci
npm run build

# First start — pm2 reads ecosystem.config.cjs for env vars + start command
pm2 start ecosystem.config.cjs
pm2 save
```

After this, every push to `main` triggers the workflow which calls
`pm2 reload ecosystem.config.cjs` for a zero-downtime restart.

### Required GitHub repo secrets

Add these under **Settings → Secrets and variables → Actions** in
the repo:

| Secret | Required | Example | What it is |
|---|---|---|---|
| `EC2_HOST` | yes | `3.142.99.240` | Public IP or DNS name of the box |
| `EC2_USER` | yes | `ec2-user` | SSH login (or `ubuntu` on Ubuntu AMIs) |
| `EC2_SSH_KEY` | yes | `-----BEGIN OPENSSH...` | Full PEM contents of an SSH private key authorized on the box |
| `EC2_PROJECT_DIR` | optional | `/home/ec2-user/eu-shopping-list` | Where the repo lives. Defaults to `~/eu-shopping-list` |
| `EC2_SSH_PORT` | optional | `22` | Non-default SSH port. Defaults to `22` |

The SSH key only needs to be authorized for the `EC2_USER` account
(usually `ec2-user`), not root. Generate one with `ssh-keygen -t
ed25519`, paste the public half into `~/.ssh/authorized_keys` on the
box, paste the private half into the `EC2_SSH_KEY` secret.

### Security group

Whatever your security group allows for SSH (port 22) is enough for
the workflow itself. For the app to actually be reachable from your
laptop, also open inbound TCP **9753** in the security group from
your IP (or `0.0.0.0/0` for public access).

### How the workflow runs

1. Push to `main` → workflow starts on `ubuntu-latest`
2. Workflow SSHes to `${EC2_HOST}` as `${EC2_USER}` using
   `${EC2_SSH_KEY}`
3. On the box: `cd ${EC2_PROJECT_DIR}`, `git fetch origin main`,
   `git reset --hard <pushed-sha>`, `bash scripts/deploy-on-ec2.sh`
4. The deploy script runs `npm ci`, `npm run build`, then either
   `pm2 reload ecosystem.config.cjs` (subsequent deploys) or
   `pm2 start ecosystem.config.cjs` (very first deploy)
5. Healthcheck: `curl http://localhost:9753/api/items` until it
   returns 200, with a 30s timeout. If it doesn't, the workflow
   fails and the last 30 lines of `pm2 logs` are printed in the
   step output.

### Manual redeploy

The workflow has `workflow_dispatch:`, so you can trigger it from the
**Actions** tab without a code push (e.g. after editing
`ecosystem.config.cjs` directly on the box and wanting to rebuild).

A `concurrency:` group prevents two deploys from overlapping — a
second push that lands during a deploy waits for the first to finish
rather than racing it.

### Manual debugging on the box

The deploy script also runs standalone for debugging:

```bash
ssh ec2-user@<your-ec2-ip>
cd ~/eu-shopping-list
git pull
bash scripts/deploy-on-ec2.sh
```

Useful pm2 commands:

```bash
pm2 list                              # see process status
pm2 logs eu-shopping-list --lines 50  # tail the last 50 lines
pm2 reload eu-shopping-list           # zero-downtime restart
pm2 describe eu-shopping-list         # cwd, args, env, restarts
```

### Other AWS hosting options (not wired up)

If you outgrow a single EC2 box later, the same Docker image works
on:

- **App Runner** — push to ECR, point App Runner at the image. Note:
  App Runner doesn't support persistent volumes, so `data/app.sqlite`
  becomes ephemeral (users lose their items on redeploy).
- **ECS Fargate + EFS** — mount EFS at `/app/data` for persistence
  across tasks.
- **Long-term path** — migrate `items-store.ts` from SQLite to
  DynamoDB. Only `items-store.ts` and `fx.ts` would need to change;
  the rest of the app is decoupled from storage.

Authentication is still out of scope. Anyone who can reach the server
can see and edit all items.

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
