"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  DEFAULT_EU_REFUND_RATE,
  DEFAULT_JP_TAX_FREE_RATE,
  DEFAULT_US_SALES_TAX_RATE,
} from "@/lib/compute";
import { fetchPriceFromUrl } from "@/lib/fetch-price-client";
import { parseProductUrl, ProductUrlParseError } from "@/lib/product-url";
import { formatPricePreview, parsePrice } from "@/lib/price-parse";
import type { Currency, Region, TrackedItem } from "@/lib/types";

const DEFAULT_US_SALES_TAX_TEXT = String(DEFAULT_US_SALES_TAX_RATE * 100);
const DEFAULT_EU_REFUND_TEXT = String(DEFAULT_EU_REFUND_RATE * 100);
const DEFAULT_JP_TAX_FREE_TEXT = String(DEFAULT_JP_TAX_FREE_RATE * 100);

interface Props {
  open: boolean;
  onClose: () => void;
  items: TrackedItem[];
  onAdd: (
    url: string,
    productName: string,
    priceRaw: number,
    salesTaxRate?: number,
    euRefundRate?: number,
    jpTaxFreeRate?: number,
  ) => Promise<void>;
}

type ParseResult =
  | { kind: "empty" }
  | {
      kind: "ok";
      host: string;
      productCode: string;
      region: Region;
      country?: string;
      refundRate?: number;
      jpTaxFreeRate?: number;
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
      jpTaxFreeRate: p.jpTaxFreeRate,
    };
  } catch (err) {
    const reason =
      err instanceof ProductUrlParseError ? err.message : String(err);
    return { kind: "error", reason };
  }
}

/** Map a parsed region to its native currency for display purposes. */
function regionToCurrency(region: Region): Currency {
  switch (region) {
    case "US":
      return "USD";
    case "JP":
      return "JPY";
    case "HK":
      return "HKD";
    case "SA":
      return "SAR";
    case "EU":
      return "EUR";
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
  /**
   * Percent string for the EU tourist refund rate. Auto-populated
   * when the pasted URL resolves to a country — e.g. "12" for Italy,
   * "11" for Germany — but the user can override.
   */
  const [refundText, setRefundText] = useState(DEFAULT_EU_REFUND_TEXT);
  /**
   * Percent string for the JP tourist tax-free rate. Defaults to 10%
   * (the full consumption tax) for any Japanese URL; user can
   * override (e.g. set to 0 if shopping at a non-tax-free retailer).
   */
  const [jpTaxFreeText, setJpTaxFreeText] = useState(
    DEFAULT_JP_TAX_FREE_TEXT,
  );
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  /**
   * State for the "Fetch price from page" button. `fetching` toggles
   * the button label; `fetchError` is shown inline below the price
   * field when extraction fails (bot block, no price found, currency
   * mismatch, etc.).
   */
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset form state every time the modal closes.
  useEffect(() => {
    if (!open) {
      setUrl("");
      setProductName("");
      setPriceText("");
      setSalesTaxText(DEFAULT_US_SALES_TAX_TEXT);
      setRefundText(DEFAULT_EU_REFUND_TEXT);
      setJpTaxFreeText(DEFAULT_JP_TAX_FREE_TEXT);
      setServerError(null);
      setSubmitting(false);
      setFetching(false);
      setFetchError(null);
    }
  }, [open]);

  // Whenever the URL changes, clear any stale fetch error so it
  // doesn't linger after the user pastes a different URL.
  useEffect(() => {
    setFetchError(null);
  }, [url]);

  /**
   * "Fetch from page" button handler. Calls /api/extract-price with
   * the current URL and populates priceText with the extracted number
   * on success. The extractor only supports EUR/USD JSON-LD, so for
   * JP and HK URLs (JPY/HKD) we don't even bother making the request
   * — those retailers' prices have to be entered manually.
   */
  async function handleFetchPrice() {
    if (parseResult.kind !== "ok") return;
    if (isJp || isHk || isSa) {
      setFetchError(
        "Auto-fetch only supports EUR/USD pages — paste the price manually",
      );
      return;
    }
    setFetching(true);
    setFetchError(null);
    try {
      const fetched = await fetchPriceFromUrl(url.trim());
      const expected = isUs ? "USD" : "EUR";
      if (fetched.currency !== expected) {
        throw new Error(
          `Page returned ${fetched.currency} but this is a ${parseResult.region} URL — paste manually`,
        );
      }
      setPriceText(String(fetched.priceRaw));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

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
  const isEu = parseResult.kind === "ok" && parseResult.region === "EU";
  const isJp = parseResult.kind === "ok" && parseResult.region === "JP";
  const isHk = parseResult.kind === "ok" && parseResult.region === "HK";
  const isSa = parseResult.kind === "ok" && parseResult.region === "SA";
  const currency: Currency =
    parseResult.kind === "ok" ? regionToCurrency(parseResult.region) : "EUR";
  const parsedPrice = useMemo(() => parsePrice(priceText), [priceText]);

  /**
   * Parse the user's percent string ("8.25") into a fraction (0.0825).
   * Empty / whitespace → 0%. Returns null on garbage so we can show
   * an inline error.
   */
  function parsePercentFraction(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === "") return 0;
    const n = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n >= 100) return null;
    return n / 100;
  }
  const parsedSalesTaxFraction = useMemo<number | null>(
    () => parsePercentFraction(salesTaxText),
    [salesTaxText],
  );
  const parsedRefundFraction = useMemo<number | null>(
    () => parsePercentFraction(refundText),
    [refundText],
  );
  const parsedJpTaxFreeFraction = useMemo<number | null>(
    () => parsePercentFraction(jpTaxFreeText),
    [jpTaxFreeText],
  );

  /**
   * Auto-populate the refund % field from the URL's country code
   * whenever the URL parses as EU. E.g. Italian URLs pre-fill "12",
   * German URLs pre-fill "11". The user can still override the
   * number manually after the auto-fill.
   */
  useEffect(() => {
    if (parseResult.kind !== "ok") return;
    if (parseResult.region !== "EU") return;
    const rate = parseResult.refundRate ?? DEFAULT_EU_REFUND_RATE;
    setRefundText(String(Math.round(rate * 100 * 100) / 100));
  }, [parseResult]);

  /**
   * Auto-populate the JP tax-free % field from the URL whenever it
   * resolves to Japan. The default is 10% (DEFAULT_JP_TAX_FREE_RATE);
   * the user can override per item.
   */
  useEffect(() => {
    if (parseResult.kind !== "ok") return;
    if (parseResult.region !== "JP") return;
    const rate = parseResult.jpTaxFreeRate ?? DEFAULT_JP_TAX_FREE_RATE;
    setJpTaxFreeText(String(Math.round(rate * 100 * 100) / 100));
  }, [parseResult]);

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
    (!isUs || parsedSalesTaxFraction !== null) &&
    (!isEu || parsedRefundFraction !== null) &&
    (!isJp || parsedJpTaxFreeFraction !== null) &&
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
        // Per-region rate fields. Each is sent only when the URL
        // matches the relevant region — the server gates them too
        // but no point round-tripping irrelevant noise.
        isUs ? (parsedSalesTaxFraction ?? 0) : undefined,
        isEu ? (parsedRefundFraction ?? 0) : undefined,
        isJp ? (parsedJpTaxFreeFraction ?? 0) : undefined,
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
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {isUs
                  ? "Sticker (USD, pre-tax)"
                  : isJp
                    ? "Sticker (JPY, tax-included)"
                    : isHk
                      ? "Sticker (HKD)"
                      : isSa
                        ? "Sticker (SAR)"
                        : `Price (${currency})`}
              </label>
              <button
                type="button"
                onClick={handleFetchPrice}
                disabled={
                  parseResult.kind !== "ok" || fetching || isJp || isHk || isSa
                }
                title={
                  parseResult.kind !== "ok"
                    ? "Paste a valid product URL first"
                    : isJp || isHk || isSa
                      ? "Auto-fetch supports EUR/USD only — paste manually"
                      : "Fetch the price from the retailer page"
                }
                className="text-xs font-medium text-blue-600 underline hover:text-blue-800 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:no-underline"
              >
                {fetching ? "Fetching…" : "↻ Fetch from page"}
              </button>
            </div>
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
                      : currency === "SAR"
                        ? "SAR 1,500.00"
                        : "HK$9,500"
              }
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
              aria-label="Price"
            />
            {fetchError && (
              <p className="mt-1 text-xs text-red-600">{fetchError}</p>
            )}
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

          {isEu && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Tourist refund %
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={refundText}
                  onChange={(e) => setRefundText(e.target.value)}
                  placeholder={DEFAULT_EU_REFUND_TEXT}
                  className="w-24 rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
                  aria-label="Tourist refund percent"
                />
                <span className="text-sm text-neutral-500">%</span>
                {parsedRefundFraction === null ? (
                  <span className="text-xs text-red-600">
                    Enter a number 0–100 (try 12)
                  </span>
                ) : parsedPrice !== null && parsedRefundFraction > 0 ? (
                  <span className="text-xs text-neutral-500">
                    after-refund ≈{" "}
                    {formatPricePreview(
                      parsedPrice * (1 - parsedRefundFraction),
                      "EUR",
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-neutral-500">
                    Auto-filled from the URL&apos;s country. Override if
                    your refund operator differs.
                  </span>
                )}
              </div>
            </div>
          )}

          {isJp && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Tourist tax-free % (免税)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={jpTaxFreeText}
                  onChange={(e) => setJpTaxFreeText(e.target.value)}
                  placeholder={DEFAULT_JP_TAX_FREE_TEXT}
                  className="w-24 rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
                  aria-label="Japanese tax-free percent"
                />
                <span className="text-sm text-neutral-500">%</span>
                {parsedJpTaxFreeFraction === null ? (
                  <span className="text-xs text-red-600">
                    Enter a number 0–100 (try 10)
                  </span>
                ) : parsedPrice !== null && parsedJpTaxFreeFraction > 0 ? (
                  <span className="text-xs text-neutral-500">
                    after tax-free ≈{" "}
                    {formatPricePreview(
                      parsedPrice * (1 - parsedJpTaxFreeFraction),
                      "JPY",
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-neutral-500">
                    Default {DEFAULT_JP_TAX_FREE_TEXT}% (full consumption
                    tax exemption at checkout). Set to 0 if you can&apos;t
                    claim it.
                  </span>
                )}
              </div>
            </div>
          )}

          {isHk && (
            <p className="text-xs text-neutral-500">
              Hong Kong has no VAT or sales tax — sticker IS the net price.
            </p>
          )}

          {isSa && (
            <p className="text-xs text-neutral-500">
              Saudi Arabia — no tourist refund modeled. VAT is included in
              the sticker price.
            </p>
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
