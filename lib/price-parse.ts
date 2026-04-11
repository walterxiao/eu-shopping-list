/**
 * Parse a user-entered price string into a number, handling both US
 * and European number formats transparently.
 *
 * Examples:
 *   "1190"       → 1190
 *   "1190.50"    → 1190.5
 *   "1190,50"    → 1190.5     (EU decimal)
 *   "€1.190,00"  → 1190       (EU thousands dot + comma decimal)
 *   "$1,190.00"  → 1190       (US thousands comma + dot decimal)
 *   "1.190"      → 1190       (EU thousands, no decimals)
 *   "1,190"      → 1190       (US thousands, no decimals)
 *   "1.5"        → 1.5        (US small decimal)
 *   "1.190.500"  → 1190500    (EU thousands with two separators)
 *   "1,190,500"  → 1190500    (US thousands with two separators)
 *   ""           → null
 *   "abc"        → null
 *   "0"          → null       (non-positive rejected)
 */
export function parsePrice(input: string): number | null {
  // Strip everything except digits, dots, and commas. This also removes
  // currency symbols (€, $, £), whitespace, NBSPs, etc.
  const cleaned = input.trim().replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const dotCount = (cleaned.match(/\./g) ?? []).length;

  let normalized: string;

  if (commaCount > 0 && dotCount > 0) {
    // Both separators present — whichever appears LAST is the decimal
    // separator, the other one is a thousands separator.
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      // EU style, e.g. "1.190,00" or "€1.234.567,89"
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // US style, e.g. "1,190.00" or "$1,234,567.89"
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (commaCount > 1) {
    // Multiple commas, no dots — all thousands separators (e.g. "1,190,500")
    normalized = cleaned.replace(/,/g, "");
  } else if (dotCount > 1) {
    // Multiple dots, no commas — all thousands separators (e.g. "1.190.500")
    normalized = cleaned.replace(/\./g, "");
  } else if (commaCount === 1) {
    const [whole, frac] = cleaned.split(",");
    if (frac.length === 3) {
      // "1,190" — thousands separator
      normalized = whole + frac;
    } else {
      // "1190,50" or "5,95" — decimal separator
      normalized = `${whole}.${frac}`;
    }
  } else if (dotCount === 1) {
    const [whole, frac] = cleaned.split(".");
    if (frac.length === 3) {
      // "1.190" — EU thousands separator
      normalized = whole + frac;
    } else {
      // "1190.50" or "1.5" — decimal separator
      normalized = `${whole}.${frac}`;
    }
  } else {
    // No separators at all — pure integer string.
    normalized = cleaned;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Format a parsed price for display as a preview next to the input
 * field (e.g. "= €1,190.00"). Uses the given currency. The output
 * locale is stable (en-IE) regardless of the input's locale; JPY
 * uses an integer format because yen has no fractional units, HKD
 * uses two decimals.
 */
export function formatPricePreview(
  n: number,
  currency: "EUR" | "USD" | "HKD" | "JPY",
): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    // JPY: 0 decimals (¥1,500). EUR/USD/HKD: 2 decimals.
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
    minimumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(n);
}
