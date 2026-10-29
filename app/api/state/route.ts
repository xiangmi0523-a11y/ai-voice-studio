import { NextResponse } from "next/server";
import { configStatus } from "@/lib/config";
import { errorResponse } from "@/lib/http";
import { listCovers, listVoices } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const config = configStatus();
  if (!config.blob) return NextResponse.json({ config, voices: [], covers: [] });
  try {
    const [voices, covers] = await Promise.all([listVoices(), listCovers()]);
    return NextResponse.json({ config, voices, covers });
  } catch (e) {
    return errorResponse(e);
  }
}
