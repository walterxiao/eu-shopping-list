import Database, { type Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS product_cache (
    region       TEXT NOT NULL,
    product_code TEXT NOT NULL,
    result_json  TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL,
    PRIMARY KEY (region, product_code)
  );
  CREATE INDEX IF NOT EXISTS idx_product_cache_fetched_at
    ON product_cache(fetched_at);

  CREATE TABLE IF NOT EXISTS fx_cache (
    pair       TEXT PRIMARY KEY,
    rate       REAL NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`;

let _db: DatabaseType | null = null;

/** Lazily open (or reopen) the SQLite cache DB. */
export function getDb(): DatabaseType {
  if (_db) return _db;

  const path = process.env.CACHE_DB_PATH || "data/cache.sqlite";

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
