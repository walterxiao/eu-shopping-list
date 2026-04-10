import { describe, it, expect, beforeEach } from "vitest";
import {
  createItem,
  deleteItem,
  getItem,
  listItems,
  updateItem,
} from "@/lib/items-store";
import { resetDbForTest } from "@/lib/db";
import { RimowaUrlParseError } from "@/lib/rimowa-url";

const EU_URL =
  "https://www.rimowa.com/eu/en/luggage/cabin/original-cabin/original-cabin-black/92552634.html";
const IT_URL =
  "https://www.rimowa.com/it/it/luggage/colour/silver/cabin/97353004.html";
const US_URL =
  "https://www.rimowa.com/us-en/luggage/cabin/original-cabin/original-cabin-black/92552634.html";
const UK_URL =
  "https://www.rimowa.com/uk/en/luggage/cabin/92552634.html";

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
    expect(item.productCode).toBe("92552634");
    expect(item.region).toBe("EU");
    expect(item.sourceCountry).toBeUndefined();
    expect(item.euVatRate).toBeUndefined();
    expect(item.currency).toBe("EUR");
    expect(item.priceRaw).toBe(1350);
    expect(item.productName).toBe("Original Cabin — Black");
    expect(item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("creates an Italian item with the correct per-country VAT rate", () => {
    const item = createItem({
      url: IT_URL,
      productName: "Classic Cabin — Silver",
      priceRaw: 1275,
    });
    expect(item.region).toBe("EU");
    expect(item.sourceCountry).toBe("it");
    expect(item.euVatRate).toBe(0.22);
    expect(item.currency).toBe("EUR");
  });

  it("creates a US item with USD currency and no VAT rate", () => {
    const item = createItem({
      url: US_URL,
      productName: "Original Cabin — Black",
      priceRaw: 1300,
    });
    expect(item.region).toBe("US");
    expect(item.euVatRate).toBeUndefined();
    expect(item.currency).toBe("USD");
  });

  it("rejects a malformed URL", () => {
    expect(() =>
      createItem({ url: "not a url", productName: "x", priceRaw: 1 }),
    ).toThrow(RimowaUrlParseError);
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
