import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteItem, updateItem } from "@/lib/items-store";
import { ProductUrlParseError } from "@/lib/product-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    productName: z.string().trim().min(1).max(128).optional(),
    priceRaw: z.number().positive().max(1_000_000_000).optional(),
    salesTaxRate: z.number().min(0).max(1).optional(),
    euRefundRate: z.number().min(0).max(1).optional(),
    jpTaxFreeRate: z.number().min(0).max(1).optional(),
  })
  .refine(
    (v) =>
      v.productName !== undefined ||
      v.priceRaw !== undefined ||
      v.salesTaxRate !== undefined ||
      v.euRefundRate !== undefined ||
      v.jpTaxFreeRate !== undefined,
    {
      message:
        "At least one of productName, priceRaw, salesTaxRate, euRefundRate, jpTaxFreeRate is required",
    },
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const item = updateItem(id, parsed.data);
    if (!item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ProductUrlParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const ok = deleteItem(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
