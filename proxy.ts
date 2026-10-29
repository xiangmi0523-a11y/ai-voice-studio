import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isAuthorized } from "./lib/auth";

export async function proxy(request: NextRequest) {
  if (await isAuthorized(request.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "请先输入访问密码" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Login, the Replicate webhook (checked by its own secret) and PWA assets stay open.
  matcher: [
    "/((?!login|api/login|api/webhook|_next/|manifest.webmanifest|icon|apple-icon|favicon).*)",
  ],
};
