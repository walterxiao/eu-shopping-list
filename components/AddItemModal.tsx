"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { parseProductUrl, ProductUrlParseError } from "@/lib/product-url";
import { formatPricePreview, parsePrice } from "@/lib/price-parse";
import type { TrackedItem } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  items: TrackedItem[];
  onAdd: (
    url: string,
    productName: string,
    priceRaw: number,
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
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset form state every time the modal closes.
  useEffect(() => {
    if (!open) {
      setUrl("");
      setProductName("");
      setPriceText("");
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
  const currency: "EUR" | "USD" =
    parseResult.kind === "ok" && parseResult.region === "US" ? "USD" : "EUR";
  const parsedPrice = useMemo(() => parsePrice(priceText), [priceText]);

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
    !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || parsedPrice === null) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onAdd(url.trim(), productName.trim(), parsedPrice);
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
              Price ({currency})
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
