"use client";

import { useCallback, useEffect, useState } from "react";
import type { CompareResponse } from "@/lib/types";
import ShoppingListPanel from "./ShoppingListPanel";
import ComparisonGrid from "./ComparisonGrid";
import {
  LegalDisclaimerBanner,
  LegalDisclaimerFooter,
} from "./LegalDisclaimer";

const STORAGE_KEY = "rimowa-compare:urls";

type Status = "idle" | "comparing" | "done" | "error";

function loadFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export default function ShoppingListApp() {
  const [urls, setUrls] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    setUrls(loadFromStorage());
  }, []);

  // Persist on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(urls));
  }, [urls]);

  const onAdd = useCallback((url: string) => {
    setUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));
  }, []);

  const onRemove = useCallback((index: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const onCompare = useCallback(async () => {
    if (urls.length === 0) return;
    setStatus("comparing");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`HTTP ${res.status}: ${msg}`);
      }
      const data = (await res.json()) as CompareResponse;
      setResult(data);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [urls]);

  return (
    <div className="min-h-screen bg-neutral-50">
      <LegalDisclaimerBanner />
      <header className="border-b border-neutral-200 bg-white px-4 py-4">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-xl font-bold">Rimowa — EU vs US price check</h1>
          <p className="text-sm text-neutral-600">
            Paste product URLs from rimowa.com and see side-by-side prices
            in both regions, with live FX and VAT normalization.
          </p>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <ShoppingListPanel
            urls={urls}
            onAdd={onAdd}
            onRemove={onRemove}
            onCompare={onCompare}
            comparing={status === "comparing"}
          />
        </div>
        <div className="lg:col-span-8">
          <ComparisonGrid
            comparing={status === "comparing"}
            pendingCount={urls.length}
            result={result}
            error={error}
          />
        </div>
      </main>
      <LegalDisclaimerFooter />
    </div>
  );
}
