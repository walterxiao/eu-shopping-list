"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { groupAndAnalyze } from "@/lib/compute";
import type {
  FxResponse,
  ListItemsResponse,
  TrackedItem,
} from "@/lib/types";
import ShoppingListPanel from "./ShoppingListPanel";
import ComparisonGrid from "./ComparisonGrid";
import {
  LegalDisclaimerBanner,
  LegalDisclaimerFooter,
} from "./LegalDisclaimer";

async function fetchItems(): Promise<TrackedItem[]> {
  const res = await fetch("/api/items");
  if (!res.ok) throw new Error(`GET /api/items → HTTP ${res.status}`);
  const data = (await res.json()) as ListItemsResponse;
  return data.items;
}

async function fetchFx(): Promise<FxResponse> {
  const res = await fetch("/api/fx");
  if (!res.ok) throw new Error(`GET /api/fx → HTTP ${res.status}`);
  return (await res.json()) as FxResponse;
}

export default function ShoppingListApp() {
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [fx, setFx] = useState<FxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fxError, setFxError] = useState<string | null>(null);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [loadedItems, loadedFx] = await Promise.all([
          fetchItems(),
          fetchFx().catch((err: Error) => {
            if (!cancelled) setFxError(err.message);
            return null;
          }),
        ]);
        if (cancelled) return;
        setItems(loadedItems);
        if (loadedFx) setFx(loadedFx);
      } catch (err) {
        if (!cancelled) {
          setFxError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onAdd = useCallback(
    async (url: string, productName: string, priceRaw: number) => {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, productName, priceRaw }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ?? `POST /api/items → HTTP ${res.status}`,
        );
      }
      const { item } = (await res.json()) as { item: TrackedItem };
      setItems((prev) => [item, ...prev]);
    },
    [],
  );

  const onUpdate = useCallback(
    async (
      id: string,
      patch: { productName?: string; priceRaw?: number },
    ) => {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ?? `PATCH /api/items/${id} → HTTP ${res.status}`,
        );
      }
      const { item } = (await res.json()) as { item: TrackedItem };
      setItems((prev) => prev.map((it) => (it.id === id ? item : it)));
    },
    [],
  );

  const onRemove = useCallback(async (id: string) => {
    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      throw new Error(`DELETE /api/items/${id} → HTTP ${res.status}`);
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const comparison = useMemo(
    () => groupAndAnalyze(items, fx?.rate ?? null),
    [items, fx],
  );

  return (
    <div className="min-h-screen bg-neutral-50">
      <LegalDisclaimerBanner />
      <header className="border-b border-neutral-200 bg-white px-4 py-4">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-xl font-bold">Rimowa — EU vs US price check</h1>
          <p className="text-sm text-neutral-600">
            Track prices you&apos;ve seen on rimowa.com, compare US and EU
            side-by-side with VAT normalization and live FX.
          </p>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <ShoppingListPanel
            items={items}
            onAdd={onAdd}
            onUpdate={onUpdate}
            onRemove={onRemove}
            busy={loading}
          />
        </div>
        <div className="lg:col-span-7">
          <ComparisonGrid
            loading={loading}
            items={comparison}
            fxRate={fx?.rate ?? null}
            fxSource={fx?.source ?? null}
            fxError={fxError}
          />
        </div>
      </main>
      <LegalDisclaimerFooter />
    </div>
  );
}
