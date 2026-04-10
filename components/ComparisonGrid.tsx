"use client";

import type { CompareResponse, ComparisonItem } from "@/lib/types";
import type { Region } from "@/lib/scrapers/types";

interface Props {
  comparing: boolean;
  pendingCount: number;
  result: CompareResponse | null;
  error: string | null;
}

function eur(n: number): string {
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

function regionLabel(r: Region): string {
  return r === "EU" ? "EU (rimowa.com/eu)" : "US (rimowa.com/us-en)";
}

function ItemCard({ item }: { item: ComparisonItem }) {
  if (item.status === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
        <p className="mb-1 font-semibold text-red-800">Could not compare</p>
        <p className="mb-1 break-all text-xs text-red-700">{item.input}</p>
        <p className="text-red-700">{item.reason}</p>
      </div>
    );
  }

  if (item.status === "not_found") {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        <p className="mb-1 font-semibold">
          {item.productName ?? "Unknown product"}{" "}
          {item.productCode && (
            <span className="text-xs font-normal text-neutral-500">
              #{item.productCode}
            </span>
          )}
        </p>
        <p className="text-neutral-600">
          Not found on either rimowa.com region.
        </p>
      </div>
    );
  }

  if (item.status === "partial") {
    const found = item.eu ?? item.us;
    const missing: Region = item.eu ? "US" : "EU";
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
        <p className="mb-1 font-semibold">
          {found?.productName ?? "Unknown product"}{" "}
          {item.productCode && (
            <span className="text-xs font-normal text-neutral-500">
              #{item.productCode}
            </span>
          )}
        </p>
        <p className="text-amber-800">
          Only available on the {item.eu ? "EU" : "US"} site. No comparison
          available (missing {missing}).
        </p>
        {found && (
          <p className="mt-2">
            <span className="font-medium">Price:</span>{" "}
            {found.currency === "EUR"
              ? eur(found.priceRaw)
              : usd(found.priceRaw)}
          </p>
        )}
      </div>
    );
  }

  // status === "ok" — full comparison
  const { eu, us, analysis, productName, productCode } = item;
  if (!eu || !us || !analysis) return null;

  const cheaperRawClass = (r: Region) =>
    analysis.cheaperRaw === r ? "bg-emerald-50" : "";
  const cheaperNetClass = (r: Region) =>
    analysis.cheaperNormalized === r ? "bg-emerald-50" : "";

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{productName}</h3>
        <span className="text-xs text-neutral-500">#{productCode}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        {/* EU column */}
        <div className="rounded border border-neutral-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {regionLabel("EU")}
          </p>
          <div className={`mb-2 rounded p-2 ${cheaperRawClass("EU")}`}>
            <p className="text-xs text-neutral-600">Raw (incl. VAT)</p>
            <p className="text-base font-semibold">{eur(eu.priceRaw)}</p>
          </div>
          <div className={`rounded p-2 ${cheaperNetClass("EU")}`}>
            <p className="text-xs text-neutral-600">Pre-tax</p>
            <p className="text-base font-semibold">
              {eur(analysis.euNetEur)}
            </p>
          </div>
          <a
            href={eu.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block truncate text-xs text-blue-600 underline"
          >
            View on rimowa.com/eu
          </a>
        </div>

        {/* US column */}
        <div className="rounded border border-neutral-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {regionLabel("US")}
          </p>
          <div className={`mb-2 rounded p-2 ${cheaperRawClass("US")}`}>
            <p className="text-xs text-neutral-600">
              Raw (pre-sales-tax) · {usd(us.priceRaw)}
            </p>
            <p className="text-base font-semibold">
              {eur(analysis.usRawEur)}
            </p>
          </div>
          <div className={`rounded p-2 ${cheaperNetClass("US")}`}>
            <p className="text-xs text-neutral-600">Pre-tax</p>
            <p className="text-base font-semibold">
              {eur(analysis.usNetEur)}
            </p>
          </div>
          <a
            href={us.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block truncate text-xs text-blue-600 underline"
          >
            View on rimowa.com/us-en
          </a>
        </div>
      </div>

      <div className="mt-3 space-y-1 border-t border-neutral-200 pt-3 text-sm">
        <p>
          <span className="font-medium">Raw winner:</span>{" "}
          <span className="font-semibold text-emerald-700">
            {analysis.cheaperRaw}
          </span>{" "}
          is {eur(analysis.savingsRawEur)} cheaper (
          {analysis.savingsRawPercent}%)
        </p>
        <p>
          <span className="font-medium">Normalized (pre-tax) winner:</span>{" "}
          <span className="font-semibold text-emerald-700">
            {analysis.cheaperNormalized}
          </span>{" "}
          is {eur(analysis.savingsNormalizedEur)} cheaper (
          {analysis.savingsNormalizedPercent}%)
        </p>
      </div>
    </div>
  );
}

export default function ComparisonGrid({
  comparing,
  pendingCount,
  result,
  error,
}: Props) {
  if (error) {
    return (
      <section className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        <h2 className="mb-2 text-lg font-semibold">Something went wrong</h2>
        <p>{error}</p>
      </section>
    );
  }

  if (!result && !comparing) {
    return (
      <section className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
        <p className="mb-1 text-lg font-medium">Ready when you are.</p>
        <p className="text-sm">
          Paste Rimowa product URLs on the left, then click{" "}
          <span className="font-semibold">Compare EU vs US</span>.
        </p>
      </section>
    );
  }

  if (comparing && !result) {
    return (
      <section className="space-y-3">
        {Array.from({ length: Math.max(1, pendingCount) }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-3 h-5 w-2/3 rounded bg-neutral-200" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-20 rounded bg-neutral-100" />
              <div className="h-20 rounded bg-neutral-100" />
            </div>
          </div>
        ))}
      </section>
    );
  }

  if (!result) return null;

  return (
    <section className="space-y-4">
      {result.usdToEurRate && (
        <p className="text-xs text-neutral-500">
          USD → EUR rate:{" "}
          <span className="font-medium">
            {result.usdToEurRate.toFixed(4)}
          </span>{" "}
          · generated {new Date(result.generatedAt).toLocaleString()}
        </p>
      )}
      <div className="space-y-3">
        {result.items.map((item, i) => (
          <ItemCard key={`${item.input}-${i}`} item={item} />
        ))}
      </div>
      {result.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="mb-1 font-semibold">Notes</p>
          <ul className="list-disc pl-5">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-neutral-500">
        EU prices include 19% VAT; US prices exclude state/local sales tax.
        The &ldquo;pre-tax&rdquo; columns strip EU VAT for an
        apples-to-apples comparison.
      </p>
    </section>
  );
}
