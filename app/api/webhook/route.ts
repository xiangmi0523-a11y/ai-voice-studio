import { NextResponse } from "next/server";
import { webhookSecret } from "@/lib/auth";
import type { Prediction } from "@/lib/replicate";
import { finalize, type Kind } from "@/lib/store";

export const maxDuration = 300;

/** Replicate calls this when training or a cover finishes. */
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") as Kind | null;
  const id = params.get("id");
  if (params.get("secret") !== (await webhookSecret()) || !id || !/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (kind !== "voices" && kind !== "covers") {
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  }
  const prediction = (await request.json()) as Prediction;
  await finalize(kind, id, prediction);
  return NextResponse.json({ ok: true });
}
