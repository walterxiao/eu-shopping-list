import Database, { type Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tracked_items (
    id             TEXT PRIMARY KEY,
    url            TEXT NOT NULL,
    host           TEXT,
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

/**
 * Idempotent migration for databases created before the `host` column
 * existed. Adds the column if missing, creates the host-aware index
 * on top of it, and backfills `host` from the `url` field for any
 * rows that were inserted before the column existed.
 *
 * NB: the host-aware index lives here (not in SCHEMA_SQL) because on
 * an upgrade path, `SCHEMA_SQL` runs before we've had a chance to
 * ALTER the table — creating an index that references a not-yet-
 * existing column would throw "no such column: host" and take down
 * the first request after the upgrade.
 */
function ensureHostColumn(db: DatabaseType): void {
  const columns = db
    .prepare<[], { name: string }>("PRAGMA table_info(tracked_items)")
    .all();
  const hasHost = columns.some((c) => c.name === "host");
  if (!hasHost) {
    db.exec("ALTER TABLE tracked_items ADD COLUMN host TEXT");
  }

  // Safe to create now that the column definitely exists.
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
          // Unparseable URL — skip, leave host NULL. `rowToItem`
          // falls back to re-extracting the host at read time.
        }
      }
    },
  );
  runAll(nullRows);
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
