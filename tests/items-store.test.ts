import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import Database from "better-sqlite3";
import {
  createItem,
  deleteItem,
  getItem,
  listItems,
  updateItem,
} from "@/lib/items-store";
import { resetDbForTest } from "@/lib/db";
import { ProductUrlParseError } from "@/lib/product-url";

const EU_URL =
  "https://www.rimowa.com/eu/en/luggage/cabin/original-cabin/original-cabin-black/92552634.html";
const IT_URL =
  "https://www.rimowa.com/it/it/luggage/colour/silver/cabin/97353004.html";
const US_URL =
  "https://www.rimowa.com/us-en/luggage/cabin/original-cabin/original-cabin-black/92552634.html";
const UK_URL =
  "https://www.rimowa.com/uk/en/luggage/cabin/92552634.html";
const MONCLER_US_URL =
  "https://www.moncler.com/en-us/men/outerwear/windbreakers-and-raincoats/etiache-hooded-rain-jacket-navy-blue-L10911A001605968E742.html";
const MONCLER_IT_URL =
  "https://www.moncler.com/it-it/men/outerwear/etiache-hooded-rain-jacket-L10911A001605968E742.html";

describe("items-store", () => {
  beforeEach(() => {
    // vitest.config.ts forces CACHE_DB_PATH=:memory:, so each test
    // run starts with a fresh in-memory DB once we reset the singleton.
    resetDbForTest();
  });

  it("returns empty list when store is fresh", () => {
    expect(listItems()).toEqual([]);
  });

  it("creates an EU item and derives metadata from the URL", () => {
    const item = createItem({
      url: EU_URL,
      productName: "Original Cabin — Black",
      priceRaw: 1350,
    });
    expect(item.id).toMatch(/[0-9a-f-]{36}/);
    expect(item.host).toBe("www.rimowa.com");
    expect(item.productCode).toBe("92552634");
    expect(item.region).toBe("EU");
    expect(item.sourceCountry).toBeUndefined();
    expect(item.euRefundRate).toBeUndefined();
    expect(item.currency).toBe("EUR");
    expect(item.priceRaw).toBe(1350);
    expect(item.productName).toBe("Original Cabin — Black");
    expect(item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("creates a Moncler item with alphanumeric SKU and the right host", () => {
    const item = createItem({
      url: MONCLER_US_URL,
      productName: "Etiache Hooded Rain Jacket — Navy Blue",
      priceRaw: 1450,
    });
    expect(item.host).toBe("www.moncler.com");
    expect(item.productCode).toBe("L10911A001605968E742");
    expect(item.region).toBe("US");
    expect(item.currency).toBe("USD");
  });

  it("creates the EU counterpart of a Moncler item (same SKU, IT locale)", () => {
    const item = createItem({
      url: MONCLER_IT_URL,
      productName: "Etiache Hooded Rain Jacket — Navy Blue",
      priceRaw: 1290,
    });
    expect(item.host).toBe("www.moncler.com");
    expect(item.productCode).toBe("L10911A001605968E742");
    expect(item.region).toBe("EU");
    expect(item.sourceCountry).toBe("it");
    expect(item.euRefundRate).toBe(0.12);
    expect(item.currency).toBe("EUR");
  });

  it("creates an Italian item with the correct per-country refund rate", () => {
    const item = createItem({
      url: IT_URL,
      productName: "Classic Cabin — Silver",
      priceRaw: 1275,
    });
    expect(item.region).toBe("EU");
    expect(item.sourceCountry).toBe("it");
    expect(item.euRefundRate).toBe(0.12);
    expect(item.currency).toBe("EUR");
  });

  it("creates a US item with USD currency and no refund rate", () => {
    const item = createItem({
      url: US_URL,
      productName: "Original Cabin — Black",
      priceRaw: 1300,
    });
    expect(item.region).toBe("US");
    expect(item.euRefundRate).toBeUndefined();
    expect(item.currency).toBe("USD");
  });

  it("stores salesTaxRate on a US item when provided", () => {
    const item = createItem({
      url: US_URL,
      productName: "Original Cabin — Black",
      priceRaw: 1300,
      salesTaxRate: 0.0725,
    });
    expect(item.salesTaxRate).toBe(0.0725);
    expect(getItem(item.id)?.salesTaxRate).toBe(0.0725);
  });

  it("ignores salesTaxRate on EU items even if provided", () => {
    const item = createItem({
      url: IT_URL,
      productName: "Classic Cabin — Silver",
      priceRaw: 1275,
      // Caller mistakenly attached a sales tax rate to an EU item;
      // the store drops it on the floor (EU items don't have sales
      // tax, they have a VAT refund instead).
      salesTaxRate: 0.0725,
    });
    expect(item.region).toBe("EU");
    expect(item.salesTaxRate).toBeUndefined();
  });

  it("rejects a salesTaxRate larger than 1 (must be a fraction)", () => {
    expect(() =>
      createItem({
        url: US_URL,
        productName: "X",
        priceRaw: 1,
        salesTaxRate: 7.25, // user mistakenly passed 7.25 instead of 0.0725
      }),
    ).toThrow(/fraction/i);
  });

  it("rejects a negative salesTaxRate", () => {
    expect(() =>
      createItem({
        url: US_URL,
        productName: "X",
        priceRaw: 1,
        salesTaxRate: -0.01,
      }),
    ).toThrow(/non-negative/i);
  });

  it("uses an explicit euRefundRate override on an EU item", () => {
    // User wants to override the parser's country default (0.12 for
    // IT) with a different refund rate — e.g. their refund operator
    // gives them 10% instead of 12%. The explicit override should win.
    const item = createItem({
      url: IT_URL,
      productName: "Classic Cabin — Silver",
      priceRaw: 1275,
      euRefundRate: 0.1,
    });
    expect(item.region).toBe("EU");
    expect(item.euRefundRate).toBe(0.1);
  });

  it("falls back to the parsed country default when no override is given", () => {
    const item = createItem({
      url: IT_URL,
      productName: "Classic Cabin — Silver",
      priceRaw: 1275,
    });
    // No explicit override → should use the IT default of 0.12.
    expect(item.euRefundRate).toBe(0.12);
  });

  it("ignores euRefundRate on US items even if provided", () => {
    const item = createItem({
      url: US_URL,
      productName: "Original Cabin — Black",
      priceRaw: 1300,
      // US rows don't have a refund rate — store drops it.
      euRefundRate: 0.1,
    });
    expect(item.region).toBe("US");
    expect(item.euRefundRate).toBeUndefined();
  });

  it("rejects a euRefundRate larger than 1 (must be a fraction)", () => {
    expect(() =>
      createItem({
        url: IT_URL,
        productName: "X",
        priceRaw: 1,
        euRefundRate: 12, // user mistakenly passed 12 instead of 0.12
      }),
    ).toThrow(/fraction/i);
  });

  it("rejects a negative euRefundRate", () => {
    expect(() =>
      createItem({
        url: IT_URL,
        productName: "X",
        priceRaw: 1,
        euRefundRate: -0.01,
      }),
    ).toThrow(/non-negative/i);
  });

  it("updateItem can change an EU item's euRefundRate without touching price", () => {
    const created = createItem({
      url: IT_URL,
      productName: "X",
      priceRaw: 1275,
    });
    expect(created.euRefundRate).toBe(0.12);
    const updated = updateItem(created.id, { euRefundRate: 0.15 });
    expect(updated).not.toBeNull();
    expect(updated!.euRefundRate).toBe(0.15);
    expect(updated!.priceRaw).toBe(1275);
  });

  it("updateItem ignores euRefundRate on US rows", () => {
    const created = createItem({
      url: US_URL,
      productName: "X",
      priceRaw: 1300,
    });
    const updated = updateItem(created.id, { euRefundRate: 0.15 });
    expect(updated).not.toBeNull();
    expect(updated!.euRefundRate).toBeUndefined();
  });

  it("updateItem can change a US item's salesTaxRate without touching price", () => {
    const created = createItem({
      url: US_URL,
      productName: "X",
      priceRaw: 1300,
      salesTaxRate: 0,
    });
    const updated = updateItem(created.id, { salesTaxRate: 0.0825 });
    expect(updated).not.toBeNull();
    expect(updated!.salesTaxRate).toBe(0.0825);
    expect(updated!.priceRaw).toBe(1300);
  });

  it("rejects a malformed URL", () => {
    expect(() =>
      createItem({ url: "not a url", productName: "x", priceRaw: 1 }),
    ).toThrow(ProductUrlParseError);
  });

  it("rejects a /uk/ URL with a GBP reason", () => {
    expect(() =>
      createItem({ url: UK_URL, productName: "x", priceRaw: 1 }),
    ).toThrow(/GBP/);
  });

  it("rejects an empty product name", () => {
    expect(() =>
      createItem({ url: EU_URL, productName: "   ", priceRaw: 1 }),
    ).toThrow(/name/i);
  });

  it("rejects a non-positive price", () => {
    expect(() =>
      createItem({ url: EU_URL, productName: "X", priceRaw: 0 }),
    ).toThrow(/positive/i);
  });

  it("lists created items newest-first", () => {
    const a = createItem({ url: EU_URL, productName: "A", priceRaw: 1 });
    // Nudge updated_at forward so ordering is deterministic.
    const b = createItem({ url: US_URL, productName: "B", priceRaw: 2 });
    const list = listItems();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it("updates an item's price and bumps updatedAt", async () => {
    const created = createItem({
      url: EU_URL,
      productName: "A",
      priceRaw: 1350,
    });
    // Sleep 1 second so the second-precision timestamp can move forward.
    await new Promise((r) => setTimeout(r, 1100));
    const updated = updateItem(created.id, { priceRaw: 1400 });
    expect(updated).not.toBeNull();
    expect(updated!.priceRaw).toBe(1400);
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(
      Date.parse(created.updatedAt),
    );
  });

  it("updateItem returns null for unknown id", () => {
    expect(updateItem("nope", { priceRaw: 1 })).toBeNull();
  });

  it("deletes an item and returns true on first delete", () => {
    const created = createItem({
      url: EU_URL,
      productName: "A",
      priceRaw: 1350,
    });
    expect(deleteItem(created.id)).toBe(true);
    expect(getItem(created.id)).toBeNull();
    // Second delete is a no-op.
    expect(deleteItem(created.id)).toBe(false);
  });
});

// ------------------------------------------------------------------
// Regression guard for the v4 → v6 upgrade path
// ------------------------------------------------------------------

describe("items-store — v4 → v6 upgrade migration", () => {
  // These tests point at a real tempfile instead of the :memory:
  // default (set by vitest.config.ts) because the bugs they guard
  // against only reproduce when there's an existing on-disk
  // database from a previous schema version. An in-memory DB is
  // always created from scratch, so the schema migration paths
  // (ensureHostColumn for v5, runV6Migration for v6) never run.
  const tmpPath = join(tmpdir(), `items-store-upgrade-${process.pid}.sqlite`);

  function cleanupTmp(): void {
    for (const suffix of ["", "-shm", "-wal"]) {
      try {
        unlinkSync(`${tmpPath}${suffix}`);
      } catch {
        /* ignore missing */
      }
    }
  }

  beforeEach(() => {
    // Make sure we're not reusing a previous in-memory singleton.
    resetDbForTest();
    cleanupTmp();

    // Create a v4-shape database: tracked_items with NO host column
    // and NO host-aware index, column still named `eu_vat_rate`, and
    // user_version still at 0. Seed two legacy rows:
    //   - one pan-EU row with no country (tests the host backfill
    //     and the v6 rate-rewrite default path)
    //   - one Italian row with eu_vat_rate = 0.22 (tests that the
    //     v6 migration actually rewrites it to 0.12)
    const seed = new Database(tmpPath);
    seed.pragma("journal_mode = WAL");
    seed.exec(`
      CREATE TABLE tracked_items (
        id             TEXT PRIMARY KEY,
        url            TEXT NOT NULL,
        product_code   TEXT NOT NULL,
        region         TEXT NOT NULL,
        source_country TEXT,
        eu_vat_rate    REAL,
        product_name   TEXT NOT NULL,
        price_raw      REAL NOT NULL,
        currency       TEXT NOT NULL,
        updated_at     INTEGER NOT NULL
      );
      CREATE INDEX idx_tracked_items_product_code
        ON tracked_items(product_code);
      CREATE TABLE fx_cache (
        pair       TEXT PRIMARY KEY,
        rate       REAL NOT NULL,
        fetched_at INTEGER NOT NULL
      );
    `);
    const insert = seed.prepare(
      `INSERT INTO tracked_items(
        id, url, product_code, region, source_country, eu_vat_rate,
        product_name, price_raw, currency, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Math.floor(Date.now() / 1000);
    insert.run(
      "legacy-eu",
      "https://www.rimowa.com/eu/en/old/92552634.html",
      "92552634",
      "EU",
      null,
      null,
      "Legacy Rimowa Item",
      1000,
      "EUR",
      now,
    );
    insert.run(
      "legacy-it",
      "https://www.rimowa.com/it/it/old/97353004.html",
      "97353004",
      "EU",
      "it",
      0.22, // the old v5 Italian VAT rate — v6 migration must rewrite
      "Legacy Italian Item",
      1275,
      "EUR",
      now,
    );
    seed.close();

    // Point the items-store at the tempfile for this describe block.
    vi.stubEnv("CACHE_DB_PATH", tmpPath);
  });

  afterEach(() => {
    resetDbForTest();
    vi.unstubAllEnvs();
    cleanupTmp();
  });

  it("opens a v4-shape DB without throwing (adds host column + v6 column rename)", () => {
    // Two historical bugs this guards against:
    //
    // 1) v5 — SqliteError: no such column: host
    //    SCHEMA_SQL had a CREATE INDEX referencing `host` that ran
    //    before ensureHostColumn() had a chance to ALTER it in.
    // 2) v6 — runV6Migration must ALTER TABLE RENAME COLUMN
    //    `eu_vat_rate` → `eu_refund_rate` BEFORE items-store tries
    //    to INSERT using the new column name.
    //
    // Calling createItem() exercises both migrations and the
    // subsequent INSERT.
    const item = createItem({
      url: "https://www.rimowa.com/it/it/luggage/97353004.html",
      productName: "Classic Cabin Silver",
      priceRaw: 1275,
    });
    expect(item.host).toBe("www.rimowa.com");
    expect(item.productCode).toBe("97353004");
    expect(item.region).toBe("EU");
    expect(item.sourceCountry).toBe("it");
    // The new item is stored under the renamed column and with the
    // v6 refund-rate value.
    expect(item.euRefundRate).toBe(0.12);
  });

  it("backfills host on legacy rows that were inserted pre-v5", () => {
    const all = listItems();
    const legacy = all.find((i) => i.id === "legacy-eu");
    expect(legacy).toBeDefined();
    expect(legacy!.host).toBe("www.rimowa.com");
    expect(legacy!.productName).toBe("Legacy Rimowa Item");
  });

  it("rewrites eu_vat_rate 0.22 → eu_refund_rate 0.12 for the Italian legacy row", () => {
    const all = listItems();
    const legacy = all.find((i) => i.id === "legacy-it");
    expect(legacy).toBeDefined();
    // The v6 migration should have looked up source_country='it' in
    // EUROZONE_REFUND_RATE and written 0.12 to the renamed column.
    expect(legacy!.sourceCountry).toBe("it");
    expect(legacy!.euRefundRate).toBe(0.12);
  });

  it("sets user_version to 7 (current schema) so migrations don't re-run", () => {
    // Touch the DB once so the migration chain runs.
    listItems();
    // Open a read-only handle and check the pragma.
    const db = new Database(tmpPath, { readonly: true });
    const row = db
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    db.close();
    expect(row.user_version).toBe(7);
  });

  it("v7 migration adds the sales_tax_rate column on upgrade", () => {
    // Touch the DB once so the migration chain runs.
    listItems();
    const db = new Database(tmpPath, { readonly: true });
    const cols = db
      .prepare("PRAGMA table_info(tracked_items)")
      .all() as { name: string }[];
    db.close();
    const names = cols.map((c) => c.name);
    expect(names).toContain("sales_tax_rate");
    // The eu_refund_rate column should also be present (renamed by v6).
    expect(names).toContain("eu_refund_rate");
    expect(names).not.toContain("eu_vat_rate");
  });
});
