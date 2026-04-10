"use client";

import { useState, type FormEvent } from "react";

interface Props {
  urls: string[];
  onAdd: (url: string) => void;
  onRemove: (index: number) => void;
  onCompare: () => void;
  comparing: boolean;
}

const PLACEHOLDER =
  "https://www.rimowa.com/eu/en/luggage/cabin/original-cabin/.../92552634.html";

export default function ShoppingListPanel({
  urls,
  onAdd,
  onRemove,
  onCompare,
  comparing,
}: Props) {
  const [input, setInput] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Support pasting multiple lines at once.
    const lines = input
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const line of lines) onAdd(line);
    setInput("");
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">Rimowa product URLs</h2>

      <form onSubmit={handleSubmit} className="mb-4 flex flex-col gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={3}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          aria-label="Rimowa product URL"
        />
        <button
          type="submit"
          className="self-end rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
          disabled={input.trim().length === 0}
        >
          Add to list
        </button>
      </form>

      {urls.length === 0 ? (
        <p className="mb-4 text-sm text-neutral-500">
          Paste a Rimowa product URL from either{" "}
          <code className="rounded bg-neutral-100 px-1">rimowa.com/eu</code>{" "}
          or{" "}
          <code className="rounded bg-neutral-100 px-1">
            rimowa.com/us-en
          </code>
          . We&apos;ll look up the matching product on the other site.
        </p>
      ) : (
        <ul className="mb-4 divide-y divide-neutral-200">
          {urls.map((url, i) => (
            <li key={`${url}-${i}`} className="flex items-start gap-2 py-2">
              <span
                className="flex-1 break-all text-xs text-neutral-700"
                title={url}
              >
                {url}
              </span>
              <button
                onClick={() => onRemove(i)}
                className="rounded px-2 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-red-600"
                aria-label={`Remove URL ${i + 1}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={onCompare}
        disabled={urls.length === 0 || comparing}
        className="w-full rounded bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        {comparing ? "Comparing…" : "Compare EU vs US"}
      </button>
    </section>
  );
}
