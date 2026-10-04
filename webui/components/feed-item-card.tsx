"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Play,
  Quote as QuoteIcon,
  Repeat2,
  Reply as ReplyIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import Image from "next/image";

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

const URL_PATTERN = /https?:\/\/[^\s<]+/gi;
const TRAILING_URL_PUNCTUATION = /[),.!?:;\]}]+$/;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Highlight configured keyword phrases inside a plain (non-URL) segment. */
function HighlightMatches({
  text,
  phrases,
}: {
  text: string;
  phrases: string[];
}) {
  if (text === "" || phrases.length === 0) return <>{text}</>;
  // Longest-first so "mint live" wins over "mint" at the same position.
  const ordered = [...phrases].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${ordered.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  const parts = text.split(pattern);
  const lowered = phrases.map((phrase) => phrase.toLowerCase());
  return (
    <>
      {parts.map((part, index) =>
        lowered.includes(part.toLowerCase()) ? (
          <mark
            key={index}
            className="rounded-sm bg-amber-500/20 text-inherit dark:bg-amber-400/25"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Render HTTP(S) URLs from tweet text as external links, highlighting
 * configured keyword phrases in the plain segments. */
function LinkifiedText({
  text,
  highlights = [],
}: {
  text: string;
  highlights?: string[];
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const start = match.index ?? cursor;
    const url = rawUrl.replace(TRAILING_URL_PUNCTUATION, "");
    const trailing = rawUrl.slice(url.length);

    if (start > cursor)
      parts.push(<HighlightMatches key={`t-${start}`} text={text.slice(cursor, start)} phrases={highlights} />);
    if (url) {
      parts.push(
        <a
          key={`${start}-${url}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-blue-500 hover:underline hover:underline-offset-2 hover:text-blue-400 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {url}
        </a>,
      );
    }
    if (trailing) parts.push(trailing);
    cursor = start + rawUrl.length;
  }

  if (cursor < text.length)
    parts.push(<HighlightMatches key={`t-end`} text={text.slice(cursor)} phrases={highlights} />);
  return <>{parts}</>;
}

function mediaOf(media: FeedMedia | undefined) {
  return {
    photos: (media?.photos ?? []) as FeedMediaPhoto[],
    videos: (media?.videos ?? []) as FeedMediaVideo[],
  };
}

/**
 * Twimg media is streamed through the app's /api/media proxy — some clients
 * can't reach video.twimg.com directly, the same reason photos go through the
 * Next image optimizer.
 */
function mediaUrl(url: string): string {
  return `/api/media?url=${encodeURIComponent(url)}`;
}

/**
 * Ordered list of source URLs to try: h264 mp4 variants by bitrate (widely
 * playable), then fxTwitter's top-level URL, then hevc mp4s and m3u8 (Safari
 * only) as last resorts.
 */
function videoCandidates(video: FeedMediaVideo): string[] {
  const formats = video.formats ?? [];
  const byContainer = (container: string) =>
    formats
      .filter(
        (format) =>
          (format.container ??
            (/\.mp4($|\?)/.test(format.url) ? "mp4" : undefined)) === container,
      )
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
      .map((format) => format.url);
  const candidates = [
    ...byContainer("mp4").filter(
      (url) => !formats.find((f) => f.url === url)?.codec?.includes("hevc"),
    ),
    video.url,
    ...byContainer("mp4").filter((url) =>
      formats.find((f) => f.url === url)?.codec?.includes("hevc"),
    ),
    ...byContainer("m3u8"),
  ];
  return [...new Set(candidates.filter(Boolean))];
}

/**
 * <video> with automatic source fallback: a failed load (network hiccup,
 * unsupported codec, unreachable host) advances to the next candidate —
 * an errored video element never recovers on its own.
 */
function VideoPlayer({
  video,
  className,
}: {
  video: FeedMediaVideo;
  className?: string;
}) {
  const candidates = useMemo(() => videoCandidates(video), [video]);
  const [index, setIndex] = useState(0);
  const current =
    candidates[Math.min(index, candidates.length - 1)] ?? video.url;
  return (
    <video
      key={current}
      className={className}
      src={mediaUrl(current)}
      poster={video.thumbnail_url ? mediaUrl(video.thumbnail_url) : undefined}
      controls
      playsInline
      preload="metadata"
      onError={() =>
        setIndex((previous) =>
          previous < candidates.length - 1 ? previous + 1 : previous,
        )
      }
    />
  );
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
          <Image
            key={photo.url}
            src={photo.url}
            alt={photo.altText ?? ""}
            className="max-h-80 w-full object-cover"
            loading="eager"
            width={photo.width}
            height={photo.height}
          />
        ))}
      </div>
    );
  }
  if (videos[0]) {
    return (
      <VideoPlayer
        video={videos[0]}
        className={cn(
          "max-h-80 w-full overflow-hidden rounded-xl border",
          className,
        )}
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
          <Image
            key={photo.url}
            src={photo.url}
            alt={photo.altText ?? ""}
            className="max-h-56 w-full object-cover"
            loading="eager"
            width={photo.width}
            height={photo.height}
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
        <Image
          src={video.thumbnail_url}
          alt=""
          className="max-h-56 w-full object-cover"
          loading="eager"
          width={video.width}
          height={video.height}
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
        <p className="mt-1 wrap-break-word whitespace-pre-wrap text-sm leading-6">
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
  onDeletePost,
  onDeleteProject,
}: {
  item: FeedItem;
  isNew?: boolean;
  /** Removes this feed item from the feed. Omit to hide the menu action. */
  onDeletePost?: (item: FeedItem) => Promise<void> | void;
  /** Deletes the whole project the item belongs to (cascades its feed items). */
  onDeleteProject?: (item: FeedItem) => Promise<void> | void;
}) {
  const [projectConfirmOpen, setProjectConfirmOpen] = useState(false);
  const payload = item.payload;
  // const author = payload?.author;
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
            {(item.matchedKeywords ?? []).map((matched) => (
              <Badge
                key={matched.phrase}
                className="border-amber-500/40 bg-amber-500/15 font-normal text-amber-700 dark:text-amber-300"
              >
                {matched.tag ?? matched.phrase}
              </Badge>
            ))}
            {item.project.chain ? (
              <Badge variant="secondary" className="font-normal">
                {item.project.chain}
              </Badge>
            ) : null}
            {onDeletePost || onDeleteProject ? (
              <div className="ml-auto shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" />}
                  >
                    <MoreHorizontal />
                    <span className="sr-only">Open post menu</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {onDeletePost ? (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void onDeletePost(item)}
                      >
                        Delete post
                      </DropdownMenuItem>
                    ) : null}
                    {onDeleteProject ? (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setProjectConfirmOpen(true)}
                      >
                        Delete project
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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
          <p className="mt-1 wrap-break-word whitespace-pre-wrap text-sm leading-6">
            <LinkifiedText
              text={item.text}
              highlights={(item.matchedKeywords ?? []).map(
                (matched) => matched.phrase,
              )}
            />
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
      <AlertDialog
        open={projectConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setProjectConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              Stop tracking @{item.project.username}. All feed items from this
              project are removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setProjectConfirmOpen(false);
                void onDeleteProject?.(item);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
