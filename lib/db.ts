import Database, { type Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EUROZONE_REFUND_RATE } from "./product-url";

/**
 * Application schema version written to PRAGMA user_version. Increment
 * on every schema change and add a corresponding block in
 * `runMigrations()` below so existing users upgrade smoothly.
 */
const APP_SCHEMA_VERSION = 6;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tracked_items (
    id             TEXT PRIMARY KEY,
    url            TEXT NOT NULL,
    host           TEXT,
    product_code   TEXT NOT NULL,
    region         TEXT NOT NULL,
    source_country TEXT,
    eu_refund_rate REAL,
    product_name   TEXT NOT NULL,
    price_raw      REAL NOT NULL,
    currency       TEXT NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tracked_items_product_code
    ON tracked_items(product_code);

  CREATE TABLE IF NOT EXISTS fx_cache (
    pair       TEXT PRIMARY KEY,
    rate       REAL NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`;

/**
 * Add the `host` column (introduced in v5), create the host-aware
 * index that SCHEMA_SQL can't safely create on an upgrade, and
 * backfill any NULL host values from the stored `url` field.
 *
 * Idempotent: does nothing if the column already exists and no
 * rows have NULL host.
 */
function ensureHostColumn(db: DatabaseType): void {
  const columns = db
    .prepare<[], { name: string }>("PRAGMA table_info(tracked_items)")
    .all();
  const hasHost = columns.some((c) => c.name === "host");
  if (!hasHost) {
    db.exec("ALTER TABLE tracked_items ADD COLUMN host TEXT");
  }

  // Safe to create now that the column exists.
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_tracked_items_host_code ON tracked_items(host, product_code)",
  );

  const nullRows = db
    .prepare<[], { id: string; url: string }>(
      "SELECT id, url FROM tracked_items WHERE host IS NULL",
    )
    .all();
  if (nullRows.length === 0) return;

  const update = db.prepare(
    "UPDATE tracked_items SET host = ? WHERE id = ?",
  );
  const runAll = db.transaction(
    (rows: { id: string; url: string }[]) => {
      for (const row of rows) {
        try {
          const host = new URL(row.url).hostname.toLowerCase();
          update.run(host, row.id);
        } catch {
          /* unparseable URL — leave host NULL, rowToItem re-derives */
        }
      }
    },
  );
  runAll(nullRows);
}

/**
 * v6 migration: the column formerly known as `eu_vat_rate` now stores
 * an approximate tourist VAT-refund rate, not the country's actual
 * VAT rate. This migration:
 *
 *   1. Renames the column `eu_vat_rate` → `eu_refund_rate` on
 *      databases created before v6.
 *   2. Rewrites every EU row's value from the v5 VAT rate to the v6
 *      refund rate looked up from `EUROZONE_REFUND_RATE`, keyed by
 *      `source_country` (falls back to 0.12 for pan-EU rows with no
 *      country).
 *
 * Gated by `PRAGMA user_version` — runs exactly once per database.
 */
function runV6Migration(db: DatabaseType): void {
  const userVersion =
    (
      db
        .prepare<[], { user_version: number }>("PRAGMA user_version")
        .get() ?? { user_version: 0 }
    ).user_version;
  if (userVersion >= 6) return;

  const columns = db
    .prepare<[], { name: string }>("PRAGMA table_info(tracked_items)")
    .all()
    .map((c) => c.name);

  // 1) Column rename: only needed on DBs that pre-date v6.
  if (columns.includes("eu_vat_rate") && !columns.includes("eu_refund_rate")) {
    db.exec(
      "ALTER TABLE tracked_items RENAME COLUMN eu_vat_rate TO eu_refund_rate",
    );
  }

  // 2) Rewrite every EU row's stored rate. Even on a v5 DB that
  //    already went through ensureHostColumn, the rate values are
  //    v5 VAT rates (0.22 for IT, 0.19 for DE, …) and we need to
  //    replace them with v6 refund rates (0.12 for IT, 0.11 for DE).
  const DEFAULT_EU_REFUND_RATE = 0.12;
  const euRows = db
    .prepare<[], { id: string; source_country: string | null }>(
      "SELECT id, source_country FROM tracked_items WHERE region = 'EU'",
    )
    .all();
  if (euRows.length > 0) {
    const update = db.prepare(
      "UPDATE tracked_items SET eu_refund_rate = ? WHERE id = ?",
    );
    const runAll = db.transaction(
      (rows: { id: string; source_country: string | null }[]) => {
        for (const row of rows) {
          const rate =
            (row.source_country
              ? EUROZONE_REFUND_RATE[row.source_country]
              : undefined) ?? DEFAULT_EU_REFUND_RATE;
          update.run(rate, row.id);
        }
      },
    );
    runAll(euRows);
  }

  // 3) Mark the migration as done so it doesn't re-run on startup.
  db.pragma(`user_version = ${APP_SCHEMA_VERSION}`);
}

let _db: DatabaseType | null = null;

/** Lazily open (or reopen) the SQLite app DB. */
export function getDb(): DatabaseType {
  if (_db) return _db;

  const path = process.env.CACHE_DB_PATH || "data/app.sqlite";

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  ensureHostColumn(db);
  runV6Migration(db);
  _db = db;
  return db;
}

/** For tests: close and forget the singleton so the next call reopens. */
export function resetDbForTest(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
