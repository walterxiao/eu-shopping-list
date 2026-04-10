"use client";

import { useState } from "react";

export function LegalDisclaimerBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <span className="font-semibold">Educational demo.</span>
        <span className="flex-1">
          Prices shown here may be inaccurate, delayed, or missing. You are
          responsible for complying with each retailer&apos;s Terms of
          Service. Not affiliated with Lidl, Carrefour, or Albert Heijn.
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
        Educational demo. Not affiliated with any retailer. No data is
        redistributed — results are shown only to the user who initiated the
        query. Single-user by design; do not use for commercial price
        monitoring.
      </div>
    </footer>
  );
}
