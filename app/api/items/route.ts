import { NextResponse } from "next/server";
import { z } from "zod";
import { createItem, listItems } from "@/lib/items-store";
import { ProductUrlParseError } from "@/lib/product-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NewItemSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  productName: z.string().trim().min(1).max(128),
  priceRaw: z.number().positive().max(1_000_000),
});

export async function GET() {
  return NextResponse.json({ items: listItems() });
}

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

  const parsed = NewItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const item = createItem(parsed.data);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof ProductUrlParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
