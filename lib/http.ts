import { NextResponse } from "next/server";
import { webhookSecret } from "./auth";
import { ReplicateNotConfiguredError } from "./replicate";

export function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const status = e instanceof ReplicateNotConfiguredError ? 503 : 500;
  console.error(e);
  return NextResponse.json({ error: message }, { status });
}

/** Replicate needs a public https URL; on localhost we skip it and rely on polling instead. */
export async function webhookUrl(request: Request, kind: string, id: string) {
  const base = process.env.APP_URL || new URL(request.url).origin;
  if (!base.startsWith("https://") || base.includes("localhost")) return undefined;
  const secret = await webhookSecret();
  return `${base}/api/webhook?kind=${kind}&id=${id}&secret=${secret}`;
}
