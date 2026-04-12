"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  DEFAULT_EU_REFUND_RATE,
  DEFAULT_JP_TAX_FREE_RATE,
  DEFAULT_US_SALES_TAX_RATE,
} from "@/lib/compute";
import { parseProductUrl, ProductUrlParseError } from "@/lib/product-url";
import { formatPricePreview, parsePrice } from "@/lib/price-parse";
import type {
  ComparisonItem,
  Currency,
  ItemPrice,
  Region,
  TrackedItem,
} from "@/lib/types";

const DEFAULT_US_SALES_TAX_TEXT = String(DEFAULT_US_SALES_TAX_RATE * 100);
const DEFAULT_EU_REFUND_TEXT = String(DEFAULT_EU_REFUND_RATE * 100);
const DEFAULT_JP_TAX_FREE_TEXT = String(DEFAULT_JP_TAX_FREE_RATE * 100);

/** Parse a percent string like "7.25" or "12" into a fraction 0..1,
 *  or null if the input isn't a valid percent. Empty string → 0%. */
function parsePercentFraction(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n >= 100) return null;
  return n / 100;
}

/** Format a rate (e.g. 0.0725) as a display percent ("7.25"). Uses
 *  the minimum decimals needed — "6" instead of "6.00" when whole. */
function formatRatePercent(rate: number): string {
  const pct = rate * 100;
  return pct === Math.round(pct) ? pct.toFixed(0) : pct.toFixed(2);
}

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
    euRefundRate?: number,
    jpTaxFreeRate?: number,
  ) => Promise<void>;
  onUpdate: (
    id: string,
    patch: {
      productName?: string;
      priceRaw?: number;
      salesTaxRate?: number;
      euRefundRate?: number;
      jpTaxFreeRate?: number;
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

function jpy(n: number): string {
  // Japanese yen has no fractional unit; round and skip decimals.
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(n);
}

function hkd(n: number): string {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: "HKD",
  }).format(n);
}

/** Render `priceRaw` in its native currency for display in the
 *  Sticker column. */
function nativeMoney(n: number, currency: Currency): string {
  switch (currency) {
    case "USD":
      return usd(n);
    case "JPY":
      return jpy(n);
    case "HKD":
      return hkd(n);
    case "EUR":
      return eur(n);
  }
}

function shortHost(host: string): string {
  return host.replace(/^www\./, "");
}

function regionLabel(price: ItemPrice): string {
  const { region, sourceCountry } = price.item;
  if (region === "US") return "US";
  if (region === "JP") return "JP";
  if (region === "HK") return "HK";
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
  const isEu = item.region === "EU";
  const isJp = item.region === "JP";
  const isHk = item.region === "HK";
  const [editing, setEditing] = useState(false);
  const [priceText, setPriceText] = useState(String(item.priceRaw));
  /**
   * Sales-tax percent string (e.g. "7.25"); only used for US rows.
   * If the stored item has no explicit rate, fall back to the
   * app-wide default so the edit field matches what the compute
   * layer is already applying to the displayed Net.
   */
  const [salesTaxText, setSalesTaxText] = useState(
    item.salesTaxRate !== undefined
      ? String(item.salesTaxRate * 100)
      : DEFAULT_US_SALES_TAX_TEXT,
  );
  /**
   * Tourist refund percent string (e.g. "12.0"); only used for EU
   * rows. Falls back to the per-country default (or 12% pan-EU) if
   * the stored item has no explicit rate — so the edit cell matches
   * what the Adj. column is already rendering.
   */
  const [refundText, setRefundText] = useState(
    item.euRefundRate !== undefined
      ? formatRatePercent(item.euRefundRate)
      : DEFAULT_EU_REFUND_TEXT,
  );
  /**
   * Japanese tax-free percent string; only used for JP rows. Defaults
   * to 10% (full consumption-tax exemption) if the row has no
   * explicit value stored.
   */
  const [jpTaxFreeText, setJpTaxFreeText] = useState(
    item.jpTaxFreeRate !== undefined
      ? formatRatePercent(item.jpTaxFreeRate)
      : DEFAULT_JP_TAX_FREE_TEXT,
  );
  const [busy, setBusy] = useState(false);

  const parsedEdit = useMemo(() => parsePrice(priceText), [priceText]);
  const parsedSalesTax = useMemo<number | null>(
    () => (isUs ? parsePercentFraction(salesTaxText) : null),
    [isUs, salesTaxText],
  );
  const parsedRefund = useMemo<number | null>(
    () => (isEu ? parsePercentFraction(refundText) : null),
    [isEu, refundText],
  );
  const parsedJpTaxFree = useMemo<number | null>(
    () => (isJp ? parsePercentFraction(jpTaxFreeText) : null),
    [isJp, jpTaxFreeText],
  );

  async function handleSave() {
    if (parsedEdit === null) return;
    if (isUs && parsedSalesTax === null) return;
    if (isEu && parsedRefund === null) return;
    if (isJp && parsedJpTaxFree === null) return;
    setBusy(true);
    try {
      await onUpdate(item.id, {
        priceRaw: parsedEdit,
        ...(isUs ? { salesTaxRate: parsedSalesTax ?? 0 } : {}),
        ...(isEu ? { euRefundRate: parsedRefund ?? 0 } : {}),
        ...(isJp ? { jpTaxFreeRate: parsedJpTaxFree ?? 0 } : {}),
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
   *   US rows  → "+6% tax" (default) / "+0% tax" (muted)
   *   EU rows  → "−12% refund" (fallback to app default if the row
   *              has no explicit rate, matching what compute.ts
   *              renders in the Net column)
   *   JP rows  → "−10% tax-free" (full consumption-tax exemption
   *              for tourists at checkout)
   *   HK rows  → "—" (no VAT, no sales tax — sticker IS the net)
   */
  function renderAdjustmentCell(): React.ReactNode {
    if (isUs) {
      const rate = item.salesTaxRate ?? DEFAULT_US_SALES_TAX_RATE;
      if (rate === 0) {
        return <span className="text-neutral-400">+0% tax</span>;
      }
      return `+${formatRatePercent(rate)}% tax`;
    }
    if (isJp) {
      const rate = item.jpTaxFreeRate ?? DEFAULT_JP_TAX_FREE_RATE;
      if (rate === 0) {
        return <span className="text-neutral-400">−0% tax-free</span>;
      }
      return `−${formatRatePercent(rate)}% tax-free`;
    }
    if (isHk) {
      return <span className="text-neutral-400">duty-free</span>;
    }
    // EU row: fall back to DEFAULT_EU_REFUND_RATE for legacy rows.
    const rate = item.euRefundRate ?? DEFAULT_EU_REFUND_RATE;
    if (rate === 0) {
      return <span className="text-neutral-400">−0% refund</span>;
    }
    return `−${formatRatePercent(rate)}% refund`;
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
            {nativeMoney(item.priceRaw, item.currency)}
            {item.currency !== "EUR" && Number.isFinite(rawEur) && (
              <div className="text-[11px] text-neutral-500">
                ≈ {eur(rawEur)}
                {isUs && " pre-tax"}
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
              placeholder={DEFAULT_US_SALES_TAX_TEXT}
              className="w-14 rounded border border-neutral-300 px-2 py-1 text-xs"
              aria-label="Sales tax percent"
            />
            <span>% tax</span>
          </div>
        ) : editing && isEu ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={refundText}
              onChange={(e) => setRefundText(e.target.value)}
              placeholder={DEFAULT_EU_REFUND_TEXT}
              className="w-14 rounded border border-neutral-300 px-2 py-1 text-xs"
              aria-label="Tourist refund percent"
            />
            <span>% refund</span>
          </div>
        ) : editing && isJp ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={jpTaxFreeText}
              onChange={(e) => setJpTaxFreeText(e.target.value)}
              placeholder={DEFAULT_JP_TAX_FREE_TEXT}
              className="w-14 rounded border border-neutral-300 px-2 py-1 text-xs"
              aria-label="Japanese tax-free percent"
            />
            <span>% tax-free</span>
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
        {!isUs && price.diffVsUsEur !== undefined && (
          <div
            className={`text-[11px] font-normal ${
              price.diffVsUsEur < 0
                ? "text-emerald-700"
                : price.diffVsUsEur > 0
                  ? "text-red-600"
                  : "text-neutral-500"
            }`}
            title="Difference vs the cheapest US row's after-tax price"
          >
            {price.diffVsUsEur < 0 ? "−" : price.diffVsUsEur > 0 ? "+" : "±"}
            {eur(Math.abs(price.diffVsUsEur))}
            {price.diffVsUsPercent !== undefined && (
              <>
                {" "}
                ({price.diffVsUsPercent < 0 ? "−" : "+"}
                {Math.abs(price.diffVsUsPercent).toFixed(1)}%)
              </>
            )}{" "}
            vs US
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
                  (isUs && parsedSalesTax === null) ||
                  (isEu && parsedRefund === null) ||
                  (isJp && parsedJpTaxFree === null)
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
                      : DEFAULT_US_SALES_TAX_TEXT,
                  );
                  setRefundText(
                    item.euRefundRate !== undefined
                      ? formatRatePercent(item.euRefundRate)
                      : DEFAULT_EU_REFUND_TEXT,
                  );
                  setJpTaxFreeText(
                    item.jpTaxFreeRate !== undefined
                      ? formatRatePercent(item.jpTaxFreeRate)
                      : DEFAULT_JP_TAX_FREE_TEXT,
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
            {isEu && parsedRefund === null && (
              <span className="text-[11px] text-red-600">
                refund 0–100%
              </span>
            )}
            {isJp && parsedJpTaxFree === null && (
              <span className="text-[11px] text-red-600">
                tax-free 0–100%
              </span>
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
  const [salesTaxText, setSalesTaxText] = useState(
    DEFAULT_US_SALES_TAX_TEXT,
  );
  const [refundText, setRefundText] = useState(DEFAULT_EU_REFUND_TEXT);
  const [jpTaxFreeText, setJpTaxFreeText] = useState(
    DEFAULT_JP_TAX_FREE_TEXT,
  );
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
  // v9: codeMatches is no longer a hard requirement — the user
  // can paste a different color (different productCode) and the
  // new row will still group on the card because grouping is by
  // (host, productName) now, and this form pre-fills the card's
  // name. We still block exact duplicates below.
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

  const region: Region | null =
    parseResult && "sourceRegion" in parseResult
      ? parseResult.sourceRegion
      : null;
  const isUs = region === "US";
  const isEu = region === "EU";
  const isJp = region === "JP";
  const isHk = region === "HK";
  const currency: Currency =
    region === "US"
      ? "USD"
      : region === "JP"
        ? "JPY"
        : region === "HK"
          ? "HKD"
          : "EUR";
  const parsedPrice = useMemo(() => parsePrice(priceText), [priceText]);

  const parsedSalesTax = useMemo<number | null>(
    () => (isUs ? parsePercentFraction(salesTaxText) : null),
    [isUs, salesTaxText],
  );
  const parsedRefund = useMemo<number | null>(
    () => (isEu ? parsePercentFraction(refundText) : null),
    [isEu, refundText],
  );
  const parsedJpTaxFree = useMemo<number | null>(
    () => (isJp ? parsePercentFraction(jpTaxFreeText) : null),
    [isJp, jpTaxFreeText],
  );

  // Auto-fill the refund % from the URL's country when the user
  // pastes an EU URL. Pre-fills "12" for IT, "11" for DE, etc.
  useEffect(() => {
    if (!isEu || !parseResult || !("euRefundRate" in parseResult)) return;
    const rate = parseResult.euRefundRate ?? DEFAULT_EU_REFUND_RATE;
    setRefundText(formatRatePercent(rate));
  }, [isEu, parseResult]);

  // Auto-fill the JP tax-free % when the user pastes a JP URL.
  useEffect(() => {
    if (!isJp || !parseResult || !("jpTaxFreeRate" in parseResult)) return;
    const rate = parseResult.jpTaxFreeRate ?? DEFAULT_JP_TAX_FREE_RATE;
    setJpTaxFreeText(formatRatePercent(rate));
  }, [isJp, parseResult]);

  const mismatchReason = !parseResult
    ? null
    : "error" in parseResult
      ? parseResult.error
      : !hostMatches
        ? `URL host (${parseResult.host}) doesn't match this card (${card.host})`
        : alreadyExists
          ? "An entry for that exact SKU + region already exists — edit it instead"
          : null;

  const canSubmit =
    parseResult &&
    "host" in parseResult &&
    hostMatches &&
    !alreadyExists &&
    parsedPrice !== null &&
    (!isUs || parsedSalesTax !== null) &&
    (!isEu || parsedRefund !== null) &&
    (!isJp || parsedJpTaxFree !== null) &&
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
        isEu ? (parsedRefund ?? 0) : undefined,
        isJp ? (parsedJpTaxFree ?? 0) : undefined,
      );
      setUrl("");
      setPriceText("");
      setSalesTaxText(DEFAULT_US_SALES_TAX_TEXT);
      setRefundText(DEFAULT_EU_REFUND_TEXT);
      setJpTaxFreeText(DEFAULT_JP_TAX_FREE_TEXT);
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
            setSalesTaxText(DEFAULT_US_SALES_TAX_TEXT);
            setRefundText(DEFAULT_EU_REFUND_TEXT);
            setJpTaxFreeText(DEFAULT_JP_TAX_FREE_TEXT);
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
          placeholder={
            currency === "EUR"
              ? "€1.190,00"
              : currency === "USD"
                ? "$1,190.00"
                : currency === "JPY"
                  ? "¥150,000"
                  : "HK$9,500"
          }
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
              placeholder={DEFAULT_US_SALES_TAX_TEXT}
              className="w-14 rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
              aria-label="Sales tax percent"
            />
            <span className="text-[11px] text-neutral-500">% tax</span>
          </>
        )}
        {isEu && (
          <>
            <input
              type="text"
              inputMode="decimal"
              value={refundText}
              onChange={(e) => setRefundText(e.target.value)}
              placeholder={DEFAULT_EU_REFUND_TEXT}
              className="w-14 rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
              aria-label="Tourist refund percent"
            />
            <span className="text-[11px] text-neutral-500">% refund</span>
          </>
        )}
        {isJp && (
          <>
            <input
              type="text"
              inputMode="decimal"
              value={jpTaxFreeText}
              onChange={(e) => setJpTaxFreeText(e.target.value)}
              placeholder={DEFAULT_JP_TAX_FREE_TEXT}
              className="w-14 rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
              aria-label="Japanese tax-free percent"
            />
            <span className="text-[11px] text-neutral-500">% tax-free</span>
          </>
        )}
        {isHk && (
          <span className="text-[11px] text-neutral-500">duty-free</span>
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
      {isEu && parsedRefund === null && refundText.trim() !== "" && (
        <p className="text-[11px] text-red-600">
          Refund rate must be 0–100 (e.g. 12)
        </p>
      )}
      {isJp && parsedJpTaxFree === null && jpTaxFreeText.trim() !== "" && (
        <p className="text-[11px] text-red-600">
          Tax-free rate must be 0–100 (e.g. 10)
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
  // Default to collapsed so the list is compact on load. Users
  // click "Expand" on individual cards they want to drill into.
  // Single-row cards behave identically either way — the toggle
  // only renders when there's more than one row to hide.
  const [collapsed, setCollapsed] = useState(true);

  const cheapestNet = card.prices.find(
    (p) => p.item.id === card.cheapestNetItemId,
  );

  // Distinct product codes in the card — may be more than one if
  // color variants are grouped together (same name, different SKUs).
  // Shown as a compact list under the header so the user can still
  // see which codes are represented.
  const uniqueCodes = Array.from(
    new Set(card.prices.map((p) => p.item.productCode)),
  );

  // When collapsed, show only the cheapest-net row. On single-row
  // cards there's nothing to collapse and we don't render the
  // toggle. Fallback to the first row if cheapestNet is undefined
  // (can happen when every row has NaN netEur — e.g. FX fetch
  // failed and every row is non-EUR).
  const canCollapse = card.prices.length > 1;
  const visiblePrices =
    canCollapse && collapsed
      ? cheapestNet
        ? [cheapestNet]
        : [card.prices[0]]
      : card.prices;

  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{card.productName}</h3>
          <p className="text-xs text-neutral-500">
            {shortHost(card.host)}
            {uniqueCodes.length === 1 ? (
              <>
                {" · "}#{uniqueCodes[0]}
              </>
            ) : (
              <>
                {" · "}
                {uniqueCodes.length} variants
              </>
            )}
            {canCollapse && collapsed && cheapestNet && (
              <>
                {" · "}
                <span className="text-neutral-600">
                  showing cheapest ({regionLabel(cheapestNet)}) of{" "}
                  {card.prices.length} regions
                </span>
              </>
            )}
          </p>
        </div>
        {canCollapse && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand all regions" : "Collapse to cheapest"}
            className="shrink-0 rounded border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {collapsed ? "▸ Expand" : "▾ Collapse"}
          </button>
        )}
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
            {visiblePrices.map((price) => (
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

      {cheapestNet && card.prices.length > 1 && !collapsed && (
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

  // Group cards by host (brand) so the UI renders brand sections
  // with a header like "rimowa.com" above each cluster. Within each
  // brand, cards keep their existing order (newest-touched first,
  // set by compute.ts).
  const brandGroups = useMemo(() => {
    const groups = new Map<string, ComparisonItem[]>();
    for (const card of items) {
      const brand = card.host;
      const existing = groups.get(brand);
      if (existing) existing.push(card);
      else groups.set(brand, [card]);
    }
    return Array.from(groups.entries());
  }, [items]);

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
        <div className="space-y-6">
          {brandGroups.map(([host, cards]) => (
            <div key={host}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                {shortHost(host)}
              </h2>
              <div className="space-y-3">
                {cards.map((card) => (
                  <Card
                    key={`${card.host}-${card.productName}`}
                    card={card}
                    allItems={flatItems}
                    onAdd={onAdd}
                    onUpdate={onUpdate}
                    onRemove={onRemove}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-neutral-500">
        The <strong>Net (EUR)</strong> column is the apples-to-apples
        comparison number. <strong>EU rows</strong>: sticker minus an
        approximate Global Blue / Planet tourist refund (~10–17%,
        varies by country and operator). <strong>US rows</strong>:
        sticker plus the sales tax rate you entered for that item
        (default 6% Northern VA). <strong>JP rows</strong>: sticker
        minus the 10% consumption-tax exemption available to
        passport-holding tourists at checkout. <strong>HK rows</strong>:
        sticker as-is — Hong Kong has no VAT or sales tax. The
        cheapest-Net row is highlighted green and is the right
        number to compare across regions.
      </p>
    </section>
  );
}
