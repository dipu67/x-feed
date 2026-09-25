import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "xfeed_session";

// Pages reachable while logged out: the sign-in form itself and the
// invite-acceptance flow (which creates the account and auto-logs in).
const PUBLIC_PATHS = ["/login", "/invite"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  // Cookie presence is the only check here — a stale cookie still passes,
  // which is why /login must stay reachable so the user can re-authenticate.
  if (!hasSession && !isPublic(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Guard pages, but not the API proxy (the backend enforces auth itself),
  // Next.js internals, or static assets from /public.
  matcher: [
    "/((?!api|_next|favicon.ico|sw.js|manifest.json|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|webmanifest)$).*)",
  ],
};
