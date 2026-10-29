import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { remove } from "@/lib/store";

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await remove("covers", (await ctx.params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
