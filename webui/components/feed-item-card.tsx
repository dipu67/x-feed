import {
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Play,
  Quote as QuoteIcon,
  Repeat2,
  Reply as ReplyIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatCount, formatRelativeTime } from "@/lib/format";
import type {
  FeedItem,
  FeedMedia,
  FeedQuote,
  FeedMediaPhoto,
  FeedMediaVideo,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  isQuotedStatus,
  KIND_LABEL,
  postKinds,
  profileUrl,
  quotedPostedAt,
  resolveAuthor,
  statusUrl,
} from "@/lib/x";

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function mediaOf(media: FeedMedia | undefined) {
  return {
    photos: (media?.photos ?? []) as FeedMediaPhoto[],
    videos: (media?.videos ?? []) as FeedMediaVideo[],
  };
}

function Media({
  media,
  className,
}: {
  media: FeedMedia | undefined;
  className?: string;
}) {
  const { photos, videos } = mediaOf(media);
  if (photos.length > 0) {
    return (
      <div
        className={cn(
          "grid gap-1 overflow-hidden rounded-xl border",
          photos.length === 1 ? "grid-cols-1" : "grid-cols-2",
          className,
        )}
      >
        {photos.slice(0, 4).map((photo) => (
          <img
            key={photo.url}
            src={photo.url}
            alt={photo.altText ?? ""}
            className="max-h-80 w-full object-cover"
          />
        ))}
      </div>
    );
  }
  if (videos[0]) {
    return (
      <video
        className={cn(
          "max-h-80 w-full overflow-hidden rounded-xl border",
          className,
        )}
        src={videos[0].url}
        poster={videos[0].thumbnail_url ?? undefined}
        controls
      />
    );
  }
  return null;
}

/**
 * Media inside a quote card sits within an anchor, so videos render as a
 * still frame — a <video controls> would swallow the click.
 */
function QuoteMedia({ media }: { media: FeedMedia | undefined }) {
  const { photos, videos } = mediaOf(media);
  if (photos.length > 0) {
    return (
      <div
        className={cn(
          "mt-2 grid gap-1 overflow-hidden rounded-lg border",
          photos.length === 1 ? "grid-cols-1" : "grid-cols-2",
        )}
      >
        {photos.slice(0, 4).map((photo) => (
          <img
            key={photo.url}
            src={photo.url}
            alt={photo.altText ?? ""}
            className="max-h-56 w-full object-cover"
          />
        ))}
      </div>
    );
  }
  const video = videos[0];
  if (!video) return null;
  return (
    <div className="relative mt-2 overflow-hidden rounded-lg border">
      {video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt=""
          className="max-h-56 w-full object-cover"
        />
      ) : (
        <div className="h-32 w-full bg-muted" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-9 items-center justify-center rounded-full bg-background/80 backdrop-blur">
          <Play className="size-4" />
        </span>
      </span>
    </div>
  );
}

function QuotedTweet({ quote }: { quote: FeedQuote }) {
  if (!isQuotedStatus(quote)) {
    const body = (
      <span className="text-sm text-muted-foreground">
        {quote.message ?? "This post is unavailable"}
      </span>
    );
    return quote.url ? (
      <a
        href={quote.url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 block rounded-xl border border-dashed px-3 py-3 hover:bg-accent/40"
      >
        {body}
      </a>
    ) : (
      <div className="mt-3 rounded-xl border border-dashed px-3 py-3">
        {body}
      </div>
    );
  }

  const handle = quote.author?.screen_name ?? "";
  const name = quote.author?.name ?? handle;
  const href =
    quote.url ?? statusUrl(handle, quote.id) ?? profileUrl(handle) ?? undefined;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-3 block rounded-xl border px-3 py-3 transition-colors hover:bg-accent/40"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Avatar size="sm">
          {quote.author?.avatar_url ? (
            <AvatarImage src={quote.author.avatar_url} alt={name} />
          ) : null}
          <AvatarFallback>{initials(name || "??")}</AvatarFallback>
        </Avatar>
        <span className="truncate text-sm font-semibold">{name}</span>
        {handle ? (
          <span className="truncate text-sm text-muted-foreground">
            @{handle}
          </span>
        ) : null}
        <span className="text-sm text-muted-foreground">
          · {formatRelativeTime(quotedPostedAt(quote))}
        </span>
      </div>
      {quote.text ? (
        <p className="mt-1 break-words whitespace-pre-wrap text-sm leading-6">
          {quote.text}
        </p>
      ) : null}
      <QuoteMedia media={quote.media} />
    </a>
  );
}

export function FeedItemCard({
  item,
  isNew = false,
}: {
  item: FeedItem;
  isNew?: boolean;
}) {
  const payload = item.payload;
  const author = payload?.author;
  const repostedBy = payload?.reposted_by;
  const replyingTo = payload?.replying_to;
  const quote = payload?.quote;
  const kinds = postKinds(payload);

  // On a repost the author is the original poster, so the project's own
  // name/avatar must not stand in for them.
  const { handle, displayName, avatar, profileHref: authorHref } =
    resolveAuthor(item);

  const tweetHref =
    item.tweetUrl ??
    payload?.url ??
    statusUrl(handle, payload?.id ?? item.id) ??
    undefined;
  const replyHref =
    replyingTo?.url ??
    statusUrl(replyingTo?.screen_name, replyingTo?.status) ??
    undefined;

  return (
    <article
      className={cn(
        "border-b px-4 py-4 transition-colors",
        isNew && "bg-accent/40",
      )}
    >
      {repostedBy ? (
        <a
          href={repostedBy.url ?? profileUrl(repostedBy.screen_name) ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="mb-2 ml-13 flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Repeat2 className="size-3.5" />
          <span className="truncate">{repostedBy.name} reposted</span>
        </a>
      ) : null}
      <div className="flex gap-3">
        <a href={authorHref} target="_blank" rel="noreferrer">
          <Avatar size="lg">
            {avatar ? <AvatarImage src={avatar} alt={displayName} /> : null}
            <AvatarFallback>{initials(displayName)}</AvatarFallback>
          </Avatar>
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={authorHref}
              target="_blank"
              rel="noreferrer"
              className="truncate font-semibold hover:underline"
            >
              {displayName}
            </a>
            <a
              href={authorHref}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm text-muted-foreground hover:underline"
            >
              @{handle}
            </a>
            <a
              href={tweetHref}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-muted-foreground hover:underline"
            >
              · {formatRelativeTime(item.postedAt)}
            </a>
            {kinds.map((kind) => (
              <Badge key={kind} variant="outline" className="font-normal">
                {KIND_LABEL[kind]}
              </Badge>
            ))}
            {item.project.chain ? (
              <Badge variant="secondary" className="font-normal">
                {item.project.chain}
              </Badge>
            ) : null}
          </div>
          {replyingTo ? (
            <a
              href={replyHref}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ReplyIcon className="size-3.5" />
              Replying to @{replyingTo.screen_name}
            </a>
          ) : null}
          <p className="mt-1 break-words whitespace-pre-wrap text-sm leading-6">
            {item.text}
          </p>
          <Media media={payload?.media} className="mt-3" />
          {quote ? <QuotedTweet quote={quote} /> : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3.5" />
              {formatCount(item.replies)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Repeat2 className="size-3.5" />
              {formatCount(item.reposts)}
            </span>
            {typeof payload?.quotes === "number" ? (
              <span className="inline-flex items-center gap-1">
                <QuoteIcon className="size-3.5" />
                {formatCount(payload.quotes)}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3.5" />
              {formatCount(item.likes)}
            </span>
            {typeof payload?.views === "number" ? (
              <span className="inline-flex items-center gap-1">
                <Eye className="size-3.5" />
                {formatCount(payload.views)}
              </span>
            ) : null}
            <a
              href={tweetHref}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 hover:text-foreground"
            >
              Open
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
