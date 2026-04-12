import { NextResponse } from "next/server";
import { getEurFxRates } from "@/lib/fx";
import type { FxResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rates = await getEurFxRates();
  const body: FxResponse = {
    rate: rates.usdToEur,
    hkdRate: rates.hkdToEur,
    jpyRate: rates.jpyToEur,
    sarRate: rates.sarToEur,
    source: rates.source,
    fetchedAt: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
