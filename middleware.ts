import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "cdm_session";
const SESSION_VALUE = "authenticated";

// Paths that require authentication
const PROTECTED_PATHS = ["/dashboard", "/leads", "/conversations", "/settings"];

// API paths that should NOT require auth (webhooks, public APIs)
const PUBLIC_API_PATHS = ["/api/webhook", "/api/auth"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public API paths (webhooks, auth)
  if (PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check if path requires auth
  const isProtected =
    PROTECTED_PATHS.some((p) => pathname.startsWith(p)) ||
    (pathname.startsWith("/api/") && !PUBLIC_API_PATHS.some((p) => pathname.startsWith(p)));

  if (!isProtected) {
    return NextResponse.next();
  }

  // Check session cookie
  const session = req.cookies.get(SESSION_COOKIE);
  if (session?.value === SESSION_VALUE) {
    return NextResponse.next();
  }

  // For API routes, return 401
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For pages, redirect to login
  const loginUrl = new URL("/login", req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Match all paths except static files and _next
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
