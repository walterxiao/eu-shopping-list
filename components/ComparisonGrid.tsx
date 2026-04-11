"use client";

import { useMemo, useState, type FormEvent } from "react";
import { parseProductUrl, ProductUrlParseError } from "@/lib/product-url";
import { formatPricePreview, parsePrice } from "@/lib/price-parse";
import type {
  ComparisonItem,
  ItemPrice,
  TrackedItem,
} from "@/lib/types";

interface Props {
  loading: boolean;
  items: ComparisonItem[];
  fxRate: number | null;
  fxSource: string | null;
  fxError: string | null;
  onAdd: (
    url: string,
    productName: string,
    priceRaw: number,
    salesTaxRate?: number,
  ) => Promise<void>;
  onUpdate: (
    id: string,
    patch: {
      productName?: string;
      priceRaw?: number;
      salesTaxRate?: number;
    },
  ) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

function eur(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function shortHost(host: string): string {
  return host.replace(/^www\./, "");
}

function regionLabel(price: ItemPrice): string {
  const { region, sourceCountry } = price.item;
  if (region === "US") return "US";
  if (sourceCountry) return `EU · ${sourceCountry.toUpperCase()}`;
  return "EU";
}

function relativeTime(iso: string): string {
  const delta = Date.now() - Date.parse(iso);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function PriceRow({
  price,
  isCheapestRaw,
  isCheapestNet,
  onUpdate,
  onRemove,
}: {
  price: ItemPrice;
  isCheapestRaw: boolean;
  isCheapestNet: boolean;
  onUpdate: Props["onUpdate"];
  onRemove: Props["onRemove"];
}) {
  const { item, rawEur, netEur, rawUsd } = price;
  const isUs = item.region === "US";
  const [editing, setEditing] = useState(false);
  const [priceText, setPriceText] = useState(String(item.priceRaw));
  /** Sales-tax percent string (e.g. "7.25"); only used for US rows. */
  const [salesTaxText, setSalesTaxText] = useState(
    item.salesTaxRate !== undefined ? String(item.salesTaxRate * 100) : "",
  );
  const [busy, setBusy] = useState(false);

  const parsedEdit = useMemo(() => parsePrice(priceText), [priceText]);
  const parsedSalesTax = useMemo<number | null>(() => {
    if (!isUs) return null;
    const trimmed = salesTaxText.trim();
    if (trimmed === "") return 0;
    const n = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n >= 100) return null;
    return n / 100;
  }, [isUs, salesTaxText]);

  async function handleSave() {
    if (parsedEdit === null) return;
    if (isUs && parsedSalesTax === null) return;
    setBusy(true);
    try {
      await onUpdate(item.id, {
        priceRaw: parsedEdit,
        ...(isUs ? { salesTaxRate: parsedSalesTax ?? 0 } : {}),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove the ${regionLabel(price)} entry for this product?`))
      return;
    setBusy(true);
    try {
      await onRemove(item.id);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Right-column "Adjustment" cell: shows the signed delta between
   * sticker and net for this row.
   *   EU rows  → "−12% refund"
   *   US rows  → "+8.25% tax" (or "+0% tax" / "—" if not specified)
   */
  function renderAdjustmentCell(): React.ReactNode {
    if (isUs) {
      const rate = item.salesTaxRate;
      if (rate === undefined || rate === 0) {
        return <span className="text-neutral-400">+0% tax</span>;
      }
      return `+${(rate * 100).toFixed(2)}% tax`;
    }
    if (item.euRefundRate !== undefined) {
      return `−${Math.round(item.euRefundRate * 100)}% refund`;
    }
    return "—";
  }

  return (
    <tr
      className={`border-t border-neutral-100 ${
        isCheapestNet ? "bg-emerald-50" : ""
      }`}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-700">
            {regionLabel(price)}
          </span>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 underline"
            title={item.url}
          >
            link ↗
          </a>
        </div>
      </td>
      <td className="px-3 py-2 text-sm">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm"
              aria-label="New sticker price"
            />
            <span className="text-xs text-neutral-500">{item.currency}</span>
          </div>
        ) : (
          <div className={isCheapestRaw ? "font-semibold" : ""}>
            {item.currency === "USD" ? usd(item.priceRaw) : eur(item.priceRaw)}
            {rawUsd !== undefined && Number.isFinite(rawEur) && (
              <div className="text-[11px] text-neutral-500">
                ≈ {eur(rawEur)} pre-tax
              </div>
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-neutral-600">
        {editing && isUs ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={salesTaxText}
              onChange={(e) => setSalesTaxText(e.target.value)}
              placeholder="0"
              className="w-14 rounded border border-neutral-300 px-2 py-1 text-xs"
              aria-label="Sales tax percent"
            />
            <span>%</span>
          </div>
        ) : (
          renderAdjustmentCell()
        )}
      </td>
      <td
        className={`px-3 py-2 text-sm ${
          isCheapestNet ? "font-semibold text-emerald-800" : ""
        }`}
      >
        {eur(netEur)}
        {isUs && Number.isFinite(netEur) && (
          <div className="text-[11px] font-normal text-neutral-500">
            after tax
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-neutral-500">
        {relativeTime(item.updatedAt)}
      </td>
      <td className="px-3 py-2 text-right">
        {editing ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-1">
              <button
                onClick={handleSave}
                disabled={
                  busy ||
                  parsedEdit === null ||
                  (isUs && parsedSalesTax === null)
                }
                className="rounded bg-neutral-900 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setPriceText(String(item.priceRaw));
                  setSalesTaxText(
                    item.salesTaxRate !== undefined
                      ? String(item.salesTaxRate * 100)
                      : "",
                  );
                }}
                className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
              >
                Cancel
              </button>
            </div>
            {priceText.trim() !== "" && parsedEdit !== null && (
              <span className="text-[11px] text-neutral-500">
                = {formatPricePreview(parsedEdit, item.currency)}
              </span>
            )}
            {isUs && parsedSalesTax === null && (
              <span className="text-[11px] text-red-600">tax 0–100%</span>
            )}
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-blue-600 underline"
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="text-xs text-neutral-400 hover:text-red-600"
              aria-label={`Remove ${regionLabel(price)}`}
            >
              ×
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Inline form at the bottom of each card for quickly adding another
 * region to the same product. Validates that the pasted URL lives on
 * the same host and has the same productCode as the card — otherwise
 * the user is probably trying to add a different product and should
 * use the top-level "Track a new item" button instead.
 */
function AddAnotherRegionForm({
  card,
  existingItems,
  onAdd,
}: {
  card: ComparisonItem;
  existingItems: TrackedItem[];
  onAdd: Props["onAdd"];
}) {
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState("");
  const [priceText, setPriceText] = useState("");
  const [salesTaxText, setSalesTaxText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse once per URL edit and validate it's the same product.
  const parseResult = useMemo(() => {
    if (!url.trim()) return null;
    try {
      return parseProductUrl(url);
    } catch (err) {
      return err instanceof ProductUrlParseError
        ? { error: err.message }
        : { error: String(err) };
    }
  }, [url]);

  const hostMatches =
    parseResult && "host" in parseResult && parseResult.host === card.host;
  const codeMatches =
    parseResult &&
    "productCode" in parseResult &&
    parseResult.productCode === card.productCode;
  const alreadyExists =
    parseResult &&
    "host" in parseResult &&
    existingItems.some(
      (it) =>
        it.host === parseResult.host &&
        it.productCode === parseResult.productCode &&
        it.sourceCountry === parseResult.sourceCountry &&
        it.region === parseResult.sourceRegion,
    );

  const isUs =
    parseResult &&
    "sourceRegion" in parseResult &&
    parseResult.sourceRegion === "US";
  const currency: "EUR" | "USD" = isUs ? "USD" : "EUR";
  const parsedPrice = useMemo(() => parsePrice(priceText), [priceText]);

  const parsedSalesTax = useMemo<number | null>(() => {
    if (!isUs) return null;
    const trimmed = salesTaxText.trim();
    if (trimmed === "") return 0;
    const n = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n >= 100) return null;
    return n / 100;
  }, [isUs, salesTaxText]);

  const mismatchReason = !parseResult
    ? null
    : "error" in parseResult
      ? parseResult.error
      : !hostMatches
        ? `URL host (${parseResult.host}) doesn't match this card (${card.host})`
        : !codeMatches
          ? `URL product code (${parseResult.productCode}) doesn't match this card (${card.productCode})`
          : alreadyExists
            ? "An entry for that region already exists — edit it instead"
            : null;

  const canSubmit =
    parseResult &&
    "host" in parseResult &&
    hostMatches &&
    codeMatches &&
    !alreadyExists &&
    parsedPrice !== null &&
    (!isUs || parsedSalesTax !== null) &&
    !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || parsedPrice === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(
        url.trim(),
        card.productName,
        parsedPrice,
        isUs ? (parsedSalesTax ?? 0) : undefined,
      );
      setUrl("");
      setPriceText("");
      setSalesTaxText("");
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mt-3 text-xs font-medium text-blue-600 hover:underline"
      >
        + Add another region
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-2 rounded border border-neutral-200 bg-neutral-50 p-3"
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          Add another region
        </p>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setUrl("");
            setPriceText("");
            setSalesTaxText("");
            setError(null);
          }}
          className="text-xs text-neutral-400 hover:text-neutral-700"
        >
          ×
        </button>
      </div>
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={`https://${shortHost(card.host)}/.../... ← paste a URL for a different country`}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
        aria-label="URL for another region"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={priceText}
          onChange={(e) => setPriceText(e.target.value)}
          placeholder={currency === "EUR" ? "€1.190,00" : "$1,190.00"}
          className="w-28 rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
          aria-label="Price"
        />
        <span className="text-[11px] text-neutral-500">
          {isUs ? "USD pre-tax" : currency}
        </span>
        {isUs && (
          <>
            <input
              type="text"
              inputMode="decimal"
              value={salesTaxText}
              onChange={(e) => setSalesTaxText(e.target.value)}
              placeholder="0"
              className="w-14 rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
              aria-label="Sales tax percent"
            />
            <span className="text-[11px] text-neutral-500">% tax</span>
          </>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="ml-auto rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {submitting ? "Saving…" : "Add"}
        </button>
      </div>
      {mismatchReason && (
        <p className="text-[11px] text-red-600">{mismatchReason}</p>
      )}
      {isUs && parsedSalesTax === null && salesTaxText.trim() !== "" && (
        <p className="text-[11px] text-red-600">
          Sales tax must be 0–100 (e.g. 7.25)
        </p>
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </form>
  );
}

function Card({
  card,
  allItems,
  onAdd,
  onUpdate,
  onRemove,
}: {
  card: ComparisonItem;
  allItems: TrackedItem[];
  onAdd: Props["onAdd"];
  onUpdate: Props["onUpdate"];
  onRemove: Props["onRemove"];
}) {
  const cheapestNet = card.prices.find(
    (p) => p.item.id === card.cheapestNetItemId,
  );

  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{card.productName}</h3>
          <p className="text-xs text-neutral-500">
            {shortHost(card.host)} · #{card.productCode}
          </p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Region
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Sticker
              </th>
              <th
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500"
                title="EU rows: tourist VAT refund (subtracted from sticker). US rows: state sales tax (added to sticker)."
              >
                Adj.
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Net (EUR)
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Updated
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {card.prices.map((price) => (
              <PriceRow
                key={price.item.id}
                price={price}
                isCheapestRaw={price.item.id === card.cheapestRawItemId}
                isCheapestNet={price.item.id === card.cheapestNetItemId}
                onUpdate={onUpdate}
                onRemove={onRemove}
              />
            ))}
          </tbody>
        </table>
      </div>

      {cheapestNet && card.prices.length > 1 && (
        <p className="mt-3 text-sm">
          <span className="font-medium">Cheapest after refund:</span>{" "}
          <span className="font-semibold text-emerald-700">
            {regionLabel(cheapestNet)}
          </span>{" "}
          at {eur(cheapestNet.netEur)}
        </p>
      )}

      <AddAnotherRegionForm
        card={card}
        existingItems={allItems}
        onAdd={onAdd}
      />
    </article>
  );
}

export default function ComparisonGrid({
  loading,
  items,
  fxRate,
  fxSource,
  fxError,
  onAdd,
  onUpdate,
  onRemove,
}: Props) {
  // Flat list of every stored item (across all cards) so
  // AddItemModal's auto-suggest and AddAnotherRegionForm's "already
  // exists" check can both look things up by (host, productCode).
  const flatItems = useMemo(
    () => items.flatMap((c) => c.prices.map((p) => p.item)),
    [items],
  );

  if (loading) {
    return (
      <section className="space-y-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-3 h-5 w-2/3 rounded bg-neutral-200" />
            <div className="h-24 rounded bg-neutral-100" />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {fxRate != null && (
        <p className="text-xs text-neutral-500">
          USD → EUR rate:{" "}
          <span className="font-medium">{fxRate.toFixed(4)}</span>
          {fxSource && (
            <span className="ml-1 text-neutral-400">({fxSource})</span>
          )}
        </p>
      )}
      {fxError && (
        <p className="text-xs text-amber-800">FX note: {fxError}</p>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
          <p className="mb-1 text-lg font-medium">No items tracked yet.</p>
          <p className="text-sm">
            Click <span className="font-semibold">+ Track a new item</span>{" "}
            above to add your first product.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((card) => (
            <Card
              key={`${card.host}-${card.productCode}`}
              card={card}
              allItems={flatItems}
              onAdd={onAdd}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-neutral-500">
        The <strong>Net (EUR)</strong> column is the apples-to-apples
        comparison number. <strong>EU rows</strong>: sticker minus an
        approximate Global Blue / Planet tourist refund (~10–17%
        depending on country, varies by operator and purchase amount).
        <strong> US rows</strong>: sticker plus the sales tax rate you
        entered for that item (defaults to 0%). The cheapest-Net row is
        highlighted green and is the right number to compare across
        regions.
      </p>
    </section>
  );
}
