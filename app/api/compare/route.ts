import { NextResponse } from "next/server";
import { z } from "zod";
import { compare } from "@/lib/orchestrator";

// Playwright + better-sqlite3 require the Node runtime (not edge).
export const runtime = "nodejs";
// Comparisons vary per request body; never cache at the route layer.
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  urls: z
    .array(z.string().trim().min(1).max(2048))
    .min(1)
    .max(20),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Per-URL errors are captured inside the orchestrator and surfaced in
  // `items[].status`. An exception escaping here means something unusual.
  const result = await compare(parsed.data);
  return NextResponse.json(result);
}
