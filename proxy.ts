import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/crypto-utils";

const SESSION_COOKIE = "cdm_session";

// Public API paths — no session required.
// Webhook has its own security via Z-API origin, cron via CRON_SECRET, auth is the login endpoint.
const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/webhook",
  "/api/cron",
];

// Protected dashboard pages
const PROTECTED_PAGE_PREFIXES = [
  "/dashboard",
  "/leads",
  "/conversations",
  "/settings",
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // All /api/* except public ones require session
  const isApi = pathname.startsWith("/api/");
  const requiresAuth =
    (isApi && !isPublicApi(pathname)) || isProtectedPage(pathname);

  if (!requiresAuth) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // Fail closed: if secret not configured, nothing can be accessed
    if (isApi) {
      return NextResponse.json(
        { error: "server_misconfigured" },
        { status: 500 }
      );
    }
    return NextResponse.redirect(new URL("/login?error=config", req.url));
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token, secret).catch(() => null) : null;

  if (!session) {
    if (isApi) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/leads/:path*",
    "/conversations/:path*",
    "/settings/:path*",
    "/api/:path*",
  ],
};
