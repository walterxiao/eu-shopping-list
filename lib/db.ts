import Database, { type Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EUROZONE_REFUND_RATE } from "./product-url";

/**
 * Application schema version written to PRAGMA user_version. Bump on
 * every schema change and add a corresponding `if (version < N)` block
 * in `runMigrations()` below so existing users upgrade smoothly.
 */
const APP_SCHEMA_VERSION = 7;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tracked_items (
    id              TEXT PRIMARY KEY,
    url             TEXT NOT NULL,
    host            TEXT,
    product_code    TEXT NOT NULL,
    region          TEXT NOT NULL,
    source_country  TEXT,
    eu_refund_rate  REAL,
    sales_tax_rate  REAL,
    product_name    TEXT NOT NULL,
    price_raw       REAL NOT NULL,
    currency        TEXT NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tracked_items_product_code
    ON tracked_items(product_code);

  CREATE TABLE IF NOT EXISTS fx_cache (
    pair       TEXT PRIMARY KEY,
    rate       REAL NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`;

function getColumns(db: DatabaseType, table: string): string[] {
  return db
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

/**
 * Add the `host` column (introduced in v5), create the host-aware
 * index that SCHEMA_SQL can't safely create on an upgrade, and
 * backfill any NULL host values from the stored `url` field.
 *
 * Idempotent: does nothing if the column already exists and no rows
 * have NULL host. Runs unconditionally on every getDb() call because
 * it pre-dates the user_version migration scheme below.
 */
function ensureHostColumn(db: DatabaseType): void {
  const columns = getColumns(db, "tracked_items");
  if (!columns.includes("host")) {
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
 * Walk the schema-version chain from whatever version this database
 * is on up to APP_SCHEMA_VERSION. Each version block is gated and
 * idempotent so the function can be re-entered safely on every
 * startup. New migrations append a new `if (version < N)` block.
 */
function runMigrations(db: DatabaseType): void {
  let version = (
    db
      .prepare<[], { user_version: number }>("PRAGMA user_version")
      .get() ?? { user_version: 0 }
  ).user_version;

  // -------- v6: rename eu_vat_rate → eu_refund_rate + rewrite values --------
  if (version < 6) {
    const cols = getColumns(db, "tracked_items");
    if (cols.includes("eu_vat_rate") && !cols.includes("eu_refund_rate")) {
      db.exec(
        "ALTER TABLE tracked_items RENAME COLUMN eu_vat_rate TO eu_refund_rate",
      );
    }

    // Rewrite every EU row's stored rate. The v5 DB stored VAT rates
    // (0.22 for IT, 0.19 for DE, …) in this column; v6 stores refund
    // rates (0.12 for IT, 0.11 for DE) instead.
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

    db.pragma("user_version = 6");
    version = 6;
  }

  // -------- v7: add sales_tax_rate column for US items --------
  if (version < 7) {
    const cols = getColumns(db, "tracked_items");
    if (!cols.includes("sales_tax_rate")) {
      db.exec(
        "ALTER TABLE tracked_items ADD COLUMN sales_tax_rate REAL",
      );
    }
    // No value rewrite needed: existing US rows get NULL, which the
    // store maps to undefined and the compute layer treats as 0%.
    db.pragma("user_version = 7");
    version = 7;
  }

  // (Future migrations append here.)
  if (version < APP_SCHEMA_VERSION) {
    throw new Error(
      `runMigrations is missing a block for version < ${APP_SCHEMA_VERSION}`,
    );
  }
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
  runMigrations(db);
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
