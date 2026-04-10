import Database, { type Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tracked_items (
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
  CREATE INDEX IF NOT EXISTS idx_tracked_items_product_code
    ON tracked_items(product_code);

  CREATE TABLE IF NOT EXISTS fx_cache (
    pair       TEXT PRIMARY KEY,
    rate       REAL NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`;

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
