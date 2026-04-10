"use client";

import { useState } from "react";

export function LegalDisclaimerBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <span className="font-semibold">Manual entry.</span>
        <span className="flex-1">
          Prices are typed in by you after visiting rimowa.com yourself.
          This app never fetches rimowa.com — it only does the currency
          and VAT math. Not affiliated with Rimowa.
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="rounded px-2 text-amber-900 hover:bg-amber-200"
          aria-label="Dismiss notice"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function LegalDisclaimerFooter() {
  return (
    <footer className="mt-12 border-t border-neutral-200 bg-white px-4 py-4 text-xs text-neutral-600">
      <div className="mx-auto max-w-6xl">
        Prices are user-entered from your own manual visits to rimowa.com.
        Customs duties, import VAT, warranty differences, and shipping
        are not modeled. Not affiliated with any retailer.
      </div>
    </footer>
  );
}
