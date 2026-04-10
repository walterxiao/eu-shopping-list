"use client";

import type { ComparisonItem, Region } from "@/lib/types";

interface Props {
  loading: boolean;
  items: ComparisonItem[];
  fxRate: number | null;
  fxSource: string | null;
  fxError: string | null;
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

function shortHost(host: string): string {
  return host.replace(/^www\./, "");
}

function SingleSideCard({ item }: { item: ComparisonItem }) {
  const side = item.eu ?? item.us;
  if (!side) return null;
  const missing: Region = item.eu ? "US" : "EU";
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
      <p className="mb-1 font-semibold">
        {item.productName}{" "}
        <span className="text-xs font-normal text-neutral-500">
          #{item.productCode}
        </span>
      </p>
      <p className="mb-2 text-amber-800">
        Only the {item.eu ? "EU" : "US"} side is entered. Add the{" "}
        {missing} side to see a comparison.
      </p>
      <p>
        <span className="font-medium">Price:</span>{" "}
        {side.currency === "EUR" ? eur(side.priceRaw) : usd(side.priceRaw)}
      </p>
    </div>
  );
}

function PairedCard({ item }: { item: ComparisonItem }) {
  const { eu, us, analysis, productName, productCode } = item;
  if (!eu || !us) return null;

  const cheaperRawClass = (r: Region) =>
    analysis?.cheaperRaw === r ? "bg-emerald-50" : "";
  const cheaperNetClass = (r: Region) =>
    analysis?.cheaperNormalized === r ? "bg-emerald-50" : "";

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{productName}</h3>
        <span className="text-xs text-neutral-500">#{productCode}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        {/* EU column */}
        <div className="rounded border border-neutral-200 p-3">
          <p className="mb-2 truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">
            EU · {shortHost(eu.host)}
            {eu.sourceCountry ? ` · ${eu.sourceCountry.toUpperCase()}` : ""}
          </p>
          <div className={`mb-2 rounded p-2 ${cheaperRawClass("EU")}`}>
            <p className="text-xs text-neutral-600">Raw (incl. VAT)</p>
            <p className="text-base font-semibold">{eur(eu.priceRaw)}</p>
          </div>
          {analysis && (
            <div className={`rounded p-2 ${cheaperNetClass("EU")}`}>
              <p className="text-xs text-neutral-600">
                Pre-tax (minus{" "}
                {Math.round(analysis.euVatRateApplied * 100)}% VAT)
              </p>
              <p className="text-base font-semibold">
                {eur(analysis.euNetEur)}
              </p>
            </div>
          )}
          <a
            href={eu.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block truncate text-xs text-blue-600 underline"
          >
            View on {shortHost(eu.host)}
          </a>
        </div>

        {/* US column */}
        <div className="rounded border border-neutral-200 p-3">
          <p className="mb-2 truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">
            US · {shortHost(us.host)}
          </p>
          <div className={`mb-2 rounded p-2 ${cheaperRawClass("US")}`}>
            <p className="text-xs text-neutral-600">
              Raw (pre-sales-tax) · {usd(us.priceRaw)}
            </p>
            {analysis && (
              <p className="text-base font-semibold">
                {eur(analysis.usRawEur)}
              </p>
            )}
          </div>
          {analysis && (
            <div className={`rounded p-2 ${cheaperNetClass("US")}`}>
              <p className="text-xs text-neutral-600">Pre-tax</p>
              <p className="text-base font-semibold">
                {eur(analysis.usNetEur)}
              </p>
            </div>
          )}
          <a
            href={us.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block truncate text-xs text-blue-600 underline"
          >
            View on {shortHost(us.host)}
          </a>
        </div>
      </div>

      {analysis && (
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
      )}

      {!analysis && (
        <p className="mt-3 border-t border-neutral-200 pt-3 text-xs text-amber-800">
          FX rate unavailable — showing raw prices only.
        </p>
      )}
    </div>
  );
}

export default function ComparisonGrid({
  loading,
  items,
  fxRate,
  fxSource,
  fxError,
}: Props) {
  if (loading) {
    return (
      <section className="space-y-3">
        {[0, 1].map((i) => (
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

  if (items.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
        <p className="mb-1 text-lg font-medium">No items yet.</p>
        <p className="text-sm">
          Paste a Rimowa product URL on the left, click the{" "}
          <span className="font-semibold">Open page</span> link to read the
          current price, then fill in the name + price and save.
        </p>
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
      <div className="space-y-3">
        {items.map((item) =>
          item.status === "ok" ? (
            <PairedCard key={item.productCode} item={item} />
          ) : (
            <SingleSideCard key={item.productCode} item={item} />
          ),
        )}
      </div>
      <p className="text-xs text-neutral-500">
        EU prices include national VAT (19–25% depending on country); US
        prices exclude state/local sales tax. The &ldquo;pre-tax&rdquo;
        columns strip the EU item&apos;s VAT for an apples-to-apples
        comparison.
      </p>
    </section>
  );
}
