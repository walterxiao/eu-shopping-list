"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { DEFAULT_US_SALES_TAX_RATE } from "@/lib/compute";
import { parseProductUrl, ProductUrlParseError } from "@/lib/product-url";
import { formatPricePreview, parsePrice } from "@/lib/price-parse";
import type { TrackedItem } from "@/lib/types";

const DEFAULT_US_SALES_TAX_TEXT = String(DEFAULT_US_SALES_TAX_RATE * 100);

interface Props {
  open: boolean;
  onClose: () => void;
  items: TrackedItem[];
  onAdd: (
    url: string,
    productName: string,
    priceRaw: number,
    salesTaxRate?: number,
  ) => Promise<void>;
}

type ParseResult =
  | { kind: "empty" }
  | {
      kind: "ok";
      host: string;
      productCode: string;
      region: "EU" | "US";
      country?: string;
      refundRate?: number;
    }
  | { kind: "error"; reason: string };

function parseForBadge(url: string): ParseResult {
  if (!url.trim()) return { kind: "empty" };
  try {
    const p = parseProductUrl(url);
    return {
      kind: "ok",
      host: p.host,
      productCode: p.productCode,
      region: p.sourceRegion,
      country: p.sourceCountry,
      refundRate: p.euRefundRate,
    };
  } catch (err) {
    const reason =
      err instanceof ProductUrlParseError ? err.message : String(err);
    return { kind: "error", reason };
  }
}

function shortHost(host: string): string {
  return host.replace(/^www\./, "");
}

export default function AddItemModal({ open, onClose, items, onAdd }: Props) {
  const [url, setUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [priceText, setPriceText] = useState("");
  /**
   * Percent string entered by the user, e.g. "8.25". Defaults to the
   * app-wide US sales tax default so the user can just tab past it.
   * Setting it to "0" explicitly disables sales tax for that row.
   */
  const [salesTaxText, setSalesTaxText] = useState(
    DEFAULT_US_SALES_TAX_TEXT,
  );
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset form state every time the modal closes.
  useEffect(() => {
    if (!open) {
      setUrl("");
      setProductName("");
      setPriceText("");
      setSalesTaxText(DEFAULT_US_SALES_TAX_TEXT);
      setServerError(null);
      setSubmitting(false);
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const parseResult = useMemo(() => parseForBadge(url), [url]);
  const isUs = parseResult.kind === "ok" && parseResult.region === "US";
  const currency: "EUR" | "USD" = isUs ? "USD" : "EUR";
  const parsedPrice = useMemo(() => parsePrice(priceText), [priceText]);

  /**
   * Parse the user's percent string ("8.25") into a fraction (0.0825).
   * Empty / whitespace → 0%. Returns null on garbage so we can show
   * an inline error.
   */
  const parsedSalesTaxFraction = useMemo<number | null>(() => {
    const trimmed = salesTaxText.trim();
    if (trimmed === "") return 0;
    const n = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n >= 100) return null;
    return n / 100;
  }, [salesTaxText]);

  // Auto-suggest the product name when the pasted URL's (host, code)
  // already exists in the store (typically the user is adding the
  // second region for a product they already tracked).
  const suggestedName = useMemo(() => {
    if (parseResult.kind !== "ok") return null;
    const match = items.find(
      (it) =>
        it.host === parseResult.host &&
        it.productCode === parseResult.productCode,
    );
    return match?.productName ?? null;
  }, [parseResult, items]);

  useEffect(() => {
    if (!suggestedName) return;
    setProductName((current) =>
      current.trim() === "" ? suggestedName : current,
    );
  }, [suggestedName]);

  const canSubmit =
    parseResult.kind === "ok" &&
    productName.trim().length > 0 &&
    parsedPrice !== null &&
    parsedSalesTaxFraction !== null &&
    !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || parsedPrice === null) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onAdd(
        url.trim(),
        productName.trim(),
        parsedPrice,
        // Only send the sales tax for US URLs; the server ignores it
        // for EU but no point round-tripping zero noise.
        isUs ? (parsedSalesTaxFraction ?? 0) : undefined,
      );
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add tracked item"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={(e) => {
        // Click on the dim backdrop (not the dialog body) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="mt-12 w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Track a new item</h2>
            <p className="text-xs text-neutral-500">
              Paste a product URL, name, and the price you see on the
              retailer&apos;s page.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Product URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.moncler.com/en-us/.../xxx.html"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
              aria-label="Product URL"
              autoFocus
            />
            {parseResult.kind === "ok" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">
                  {shortHost(parseResult.host)}
                </span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                  {parseResult.region}
                </span>
                {parseResult.country && (
                  <span className="rounded bg-neutral-100 px-2 py-0.5 uppercase text-neutral-700">
                    {parseResult.country}
                  </span>
                )}
                {parseResult.refundRate !== undefined && (
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-700">
                    ≈ {Math.round(parseResult.refundRate * 100)}% refund
                  </span>
                )}
                <span
                  className="truncate rounded bg-neutral-100 px-2 py-0.5 font-mono text-neutral-700"
                  title={parseResult.productCode}
                >
                  #{parseResult.productCode}
                </span>
                <a
                  href={url.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-blue-600 underline"
                >
                  Open page ↗
                </a>
              </div>
            )}
            {parseResult.kind === "error" && (
              <p className="mt-1 text-xs text-red-600">{parseResult.reason}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Product name
            </label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Etiache Hooded Rain Jacket — Navy Blue"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
              aria-label="Product name"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {isUs ? "Sticker (USD, pre-tax)" : `Price (${currency})`}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder={currency === "EUR" ? "€1.190,00" : "$1,190.00"}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
              aria-label="Price"
            />
            {priceText.trim() !== "" && (
              <p className="mt-1 text-xs text-neutral-500">
                {parsedPrice !== null ? (
                  <>= {formatPricePreview(parsedPrice, currency)}</>
                ) : (
                  <span className="text-red-600">
                    Could not parse that as a price
                  </span>
                )}
              </p>
            )}
          </div>

          {isUs && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Sales tax % (your delivery state)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={salesTaxText}
                  onChange={(e) => setSalesTaxText(e.target.value)}
                  placeholder={DEFAULT_US_SALES_TAX_TEXT}
                  className="w-24 rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
                  aria-label="Sales tax percent"
                />
                <span className="text-sm text-neutral-500">%</span>
                {parsedSalesTaxFraction === null ? (
                  <span className="text-xs text-red-600">
                    Enter a number 0–100 (try 7.25)
                  </span>
                ) : parsedPrice !== null && parsedSalesTaxFraction > 0 ? (
                  <span className="text-xs text-neutral-500">
                    after-tax ≈{" "}
                    {formatPricePreview(
                      parsedPrice * (1 + parsedSalesTaxFraction),
                      "USD",
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-neutral-500">
                    Default {DEFAULT_US_SALES_TAX_TEXT}% (Northern VA /
                    ZIP 22180). Clear or set to 0 to disable.
                  </span>
                )}
              </div>
            </div>
          )}

          {serverError && (
            <p className="text-xs text-red-600">{serverError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              {submitting ? "Saving…" : "Save item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
