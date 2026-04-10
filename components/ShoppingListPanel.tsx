"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { parseProductUrl, ProductUrlParseError } from "@/lib/product-url";
import { formatPricePreview, parsePrice } from "@/lib/price-parse";
import type { TrackedItem } from "@/lib/types";

interface Props {
  items: TrackedItem[];
  onAdd: (url: string, productName: string, priceRaw: number) => Promise<void>;
  onUpdate: (
    id: string,
    patch: { productName?: string; priceRaw?: number },
  ) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  busy: boolean;
}

type ParseResult =
  | { kind: "empty" }
  | {
      kind: "ok";
      host: string;
      productCode: string;
      region: "EU" | "US";
      country?: string;
      vatRate?: number;
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
      vatRate: p.euVatRate,
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

function AddForm({
  items,
  onAdd,
  busy,
}: {
  items: TrackedItem[];
  onAdd: Props["onAdd"];
  busy: boolean;
}) {
  const [url, setUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [priceText, setPriceText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const parseResult = useMemo(() => parseForBadge(url), [url]);

  const currency: "EUR" | "USD" =
    parseResult.kind === "ok" && parseResult.region === "US" ? "USD" : "EUR";

  const parsedPrice = useMemo(() => parsePrice(priceText), [priceText]);

  // Auto-suggest the product name when the pasted URL's host +
  // product-code combo already exists in the store (typically because
  // the user just added the other region for the same product).
  // Pairing by (host, productCode) avoids cross-brand collisions.
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
    // Functional setter: only fill if currently empty — this keeps the
    // dependency array minimal (no productName dep needed) and avoids
    // overwriting whatever the user has typed.
    setProductName((current) =>
      current.trim() === "" ? suggestedName : current,
    );
  }, [suggestedName]);

  const canSubmit =
    parseResult.kind === "ok" &&
    productName.trim().length > 0 &&
    parsedPrice !== null &&
    !busy &&
    !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || parsedPrice === null) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onAdd(url.trim(), productName.trim(), parsedPrice);
      setUrl("");
      setProductName("");
      setPriceText("");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Product URL
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.rimowa.com/eu/en/.../92552634.html"
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          aria-label="Product URL"
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
            {parseResult.vatRate !== undefined && (
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-700">
                {Math.round(parseResult.vatRate * 100)}% VAT
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
              Open page to read price ↗
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
          placeholder="Original Cabin — Black"
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

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        {submitting ? "Saving…" : "Save item"}
      </button>
    </form>
  );
}

function ItemRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: TrackedItem;
  onUpdate: Props["onUpdate"];
  onRemove: Props["onRemove"];
}) {
  const [editing, setEditing] = useState(false);
  const [priceText, setPriceText] = useState(String(item.priceRaw));
  const [busy, setBusy] = useState(false);

  const parsedEditPrice = useMemo(() => parsePrice(priceText), [priceText]);

  async function handleSave() {
    if (parsedEditPrice === null) return;
    setBusy(true);
    try {
      await onUpdate(item.id, { priceRaw: parsedEditPrice });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${item.productName}"?`)) return;
    setBusy(true);
    try {
      await onRemove(item.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-2">
        <span
          className="truncate rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800"
          title={item.host}
        >
          {shortHost(item.host)}
        </span>
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-700">
          {item.region}
          {item.sourceCountry ? ` · ${item.sourceCountry.toUpperCase()}` : ""}
        </span>
        <span className="flex-1 truncate text-sm font-medium">
          {item.productName}
        </span>
        <button
          onClick={handleDelete}
          disabled={busy}
          className="rounded px-2 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-50"
          aria-label={`Delete ${item.productName}`}
        >
          ×
        </button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        {editing ? (
          <>
            <input
              type="text"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              className="w-28 rounded border border-neutral-300 px-2 py-1 text-sm"
              aria-label="New price"
            />
            <span className="text-xs text-neutral-500">{item.currency}</span>
            <button
              onClick={handleSave}
              disabled={busy || parsedEditPrice === null}
              className="rounded bg-neutral-900 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setPriceText(String(item.priceRaw));
              }}
              className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
            >
              Cancel
            </button>
            {priceText.trim() !== "" && parsedEditPrice === null && (
              <span className="text-xs text-red-600">invalid</span>
            )}
            {parsedEditPrice !== null && parsedEditPrice !== item.priceRaw && (
              <span className="text-xs text-neutral-500">
                = {formatPricePreview(parsedEditPrice, item.currency)}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="font-semibold">
              {item.priceRaw} {item.currency}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-blue-600 underline"
            >
              Edit
            </button>
            <span className="ml-auto text-xs text-neutral-500">
              {relativeTime(item.updatedAt)}
            </span>
          </>
        )}
      </div>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate text-xs text-blue-600 underline"
        title={item.url}
      >
        {item.url}
      </a>
    </li>
  );
}

export default function ShoppingListPanel({
  items,
  onAdd,
  onUpdate,
  onRemove,
  busy,
}: Props) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">Tracked items</h2>

      <AddForm items={items} onAdd={onAdd} busy={busy} />

      {items.length > 0 && (
        <>
          <hr className="my-4 border-neutral-200" />
          <ul className="divide-y divide-neutral-200">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onUpdate={onUpdate}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
