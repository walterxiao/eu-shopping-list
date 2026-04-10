import { NextResponse } from "next/server";
import { getUsdToEurRate } from "@/lib/fx";
import type { FxResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { rate, source } = await getUsdToEurRate();
  const body: FxResponse = {
    rate,
    source,
    fetchedAt: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
