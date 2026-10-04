import { NextRequest } from "next/server";

// Hosts the app may stream media from. Everything else is rejected so the
// route can't act as an open proxy. Videos (and posters) are streamed through
// here because some clients can't reach Twimg directly — the same reason
// photos go through the Next image optimizer.
const ALLOWED_HOSTS = new Set([
  "video.twimg.com",
  "pbs.twimg.com",
  "ton.twimg.com",
]);

export async function GET(req: NextRequest) {
  if (!req.cookies.get("xfeed_session")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    return new Response("Host not allowed", { status: 403 });
  }

  const upstreamHeaders: Record<string, string> = {};
  const range = req.headers.get("range");
  if (range) upstreamHeaders.Range = range;

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers: upstreamHeaders });
  } catch {
    return new Response("Upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok) {
    return new Response("Upstream error", { status: 502 });
  }

  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "public, max-age=3600");

  // Body streams through, so 206 partial responses keep video seeking working.
  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
