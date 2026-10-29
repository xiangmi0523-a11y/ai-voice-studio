import { NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

export async function POST(request: Request) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!process.env.APP_PASSWORD || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "密码不对" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authToken(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
