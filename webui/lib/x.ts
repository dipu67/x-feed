import type { FeedPayload, FeedQuote, FeedQuotedStatus } from "@/lib/types";

const X_ORIGIN = "https://x.com";

function handleOf(screenName?: string | null): string {
  return (screenName ?? "").replace(/^@/, "").trim();
}

/** Profile page on x.com, e.g. `vercel` -> https://x.com/vercel */
export function profileUrl(screenName?: string | null): string | null {
  const handle = handleOf(screenName);
  return handle ? `${X_ORIGIN}/${handle}` : null;
}

/** Single tweet on x.com. Falls back to the handle-less `/i/status/` permalink. */
export function statusUrl(
  screenName?: string | null,
  statusId?: string | null,
): string | null {
  if (!statusId) return null;
  return `${X_ORIGIN}/${handleOf(screenName) || "i"}/status/${statusId}`;
}

export type PostKind = "repost" | "quote" | "reply";

/** Every relation the item carries — a tweet can be a reply *and* a quote. */
export function postKinds(payload: FeedPayload | null | undefined): PostKind[] {
  const kinds: PostKind[] = [];
  if (payload?.reposted_by) kinds.push("repost");
  if (payload?.quote) kinds.push("quote");
  if (payload?.replying_to) kinds.push("reply");
  return kinds;
}

export function isQuotedStatus(quote: FeedQuote): quote is FeedQuotedStatus {
  return quote.type === "status";
}

/** fxTwitter sends a unix timestamp plus a Twitter-formatted date; prefer the former. */
export function quotedPostedAt(quote: FeedQuotedStatus): string {
  return quote.created_timestamp
    ? new Date(quote.created_timestamp * 1000).toISOString()
    : (quote.created_at ?? "");
}
