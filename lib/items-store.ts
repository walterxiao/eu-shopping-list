import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { parseProductUrl, ProductUrlParseError } from "./product-url";
import type {
  NewItemInput,
  TrackedItem,
  UpdateItemInput,
} from "./types";

interface Row {
  id: string;
  url: string;
  /** Nullable in the DB because pre-v5 rows didn't have it; the
   * migration in `ensureHostColumn` backfills most of them, but any
   * row with a malformed URL is left NULL. */
  host: string | null;
  product_code: string;
  region: "EU" | "US";
  source_country: string | null;
  eu_refund_rate: number | null;
  /** US sales tax rate (fraction); NULL for EU rows or unspecified. */
  sales_tax_rate: number | null;
  product_name: string;
  price_raw: number;
  currency: "EUR" | "USD";
  updated_at: number;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function rowToItem(row: Row): TrackedItem {
  return {
    id: row.id,
    url: row.url,
    // Fall back to extracting from the URL if the migration left it NULL
    // (should be rare — only for rows whose URL doesn't parse).
    host: row.host ?? hostFromUrl(row.url),
    productCode: row.product_code,
    region: row.region,
    sourceCountry: row.source_country ?? undefined,
    euRefundRate: row.eu_refund_rate ?? undefined,
    salesTaxRate: row.sales_tax_rate ?? undefined,
    productName: row.product_name,
    priceRaw: row.price_raw,
    currency: row.currency,
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  };
}

/** Return all tracked items, newest first. Ties broken by insert order. */
export function listItems(): TrackedItem[] {
  const rows = getDb()
    .prepare<[], Row>(
      "SELECT * FROM tracked_items ORDER BY updated_at DESC, ROWID DESC",
    )
    .all();
  return rows.map(rowToItem);
}

/** Look up a single item by id, or return null if not found. */
export function getItem(id: string): TrackedItem | null {
  const row = getDb()
    .prepare<[string], Row>("SELECT * FROM tracked_items WHERE id = ?")
    .get(id);
  return row ? rowToItem(row) : null;
}

/**
 * Create a new tracked item.
 *
 * The URL is parsed server-side so the client can't spoof region,
 * country, or host. {@link ProductUrlParseError} propagates to the
 * caller (which maps it to HTTP 400 in the route handler).
 */
export function createItem(input: NewItemInput): TrackedItem {
  const productName = input.productName.trim();
  if (!productName) {
    throw new ProductUrlParseError("Product name is required");
  }
  if (!Number.isFinite(input.priceRaw) || input.priceRaw <= 0) {
    throw new ProductUrlParseError("Price must be a positive number");
  }
  if (input.salesTaxRate !== undefined) {
    if (!Number.isFinite(input.salesTaxRate) || input.salesTaxRate < 0) {
      throw new ProductUrlParseError(
        "Sales tax rate must be a non-negative number",
      );
    }
    if (input.salesTaxRate > 1) {
      throw new ProductUrlParseError(
        "Sales tax rate must be a fraction (e.g. 0.0725 for 7.25%), not a percent",
      );
    }
  }

  // Throws ProductUrlParseError on bad input.
  const parsed = parseProductUrl(input.url);

  const id = randomUUID();
  const currency = parsed.sourceRegion === "US" ? "USD" : "EUR";
  // Sales tax only makes sense for US items; ignore the field for EU.
  const salesTaxRate =
    parsed.sourceRegion === "US"
      ? (input.salesTaxRate ?? null)
      : null;
  const now = Math.floor(Date.now() / 1000);

  getDb()
    .prepare(
      `INSERT INTO tracked_items(
        id, url, host, product_code, region, source_country, eu_refund_rate,
        sales_tax_rate, product_name, price_raw, currency, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.url.trim(),
      parsed.host,
      parsed.productCode,
      parsed.sourceRegion,
      parsed.sourceCountry ?? null,
      parsed.euRefundRate ?? null,
      salesTaxRate,
      productName,
      input.priceRaw,
      currency,
      now,
    );

  return getItem(id)!;
}

/**
 * Update an item's mutable fields (productName and/or priceRaw).
 * Bumps updatedAt. Returns the updated row, or null if no such id.
 */
export function updateItem(
  id: string,
  patch: UpdateItemInput,
): TrackedItem | null {
  const existing = getItem(id);
  if (!existing) return null;

  const nextName =
    patch.productName !== undefined
      ? patch.productName.trim()
      : existing.productName;
  const nextPrice =
    patch.priceRaw !== undefined ? patch.priceRaw : existing.priceRaw;
  // salesTaxRate only meaningful for US rows; ignore the field for EU.
  const nextSalesTax =
    existing.region === "US" && patch.salesTaxRate !== undefined
      ? patch.salesTaxRate
      : (existing.salesTaxRate ?? null);

  if (!nextName) {
    throw new ProductUrlParseError("Product name cannot be empty");
  }
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    throw new ProductUrlParseError("Price must be a positive number");
  }
  if (nextSalesTax !== null && nextSalesTax !== undefined) {
    if (!Number.isFinite(nextSalesTax) || nextSalesTax < 0) {
      throw new ProductUrlParseError(
        "Sales tax rate must be a non-negative number",
      );
    }
    if (nextSalesTax > 1) {
      throw new ProductUrlParseError(
        "Sales tax rate must be a fraction (e.g. 0.0725 for 7.25%), not a percent",
      );
    }
  }

  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(
      `UPDATE tracked_items
       SET product_name = ?, price_raw = ?, sales_tax_rate = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(nextName, nextPrice, nextSalesTax, now, id);

  return getItem(id);
}

/** Delete an item. Returns true if a row was removed, false otherwise. */
export function deleteItem(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM tracked_items WHERE id = ?")
    .run(id);
  return result.changes > 0;
}
