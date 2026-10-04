"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedItemCard } from "@/components/feed-item-card";
import { getSocket } from "@/lib/socket";
import { fetchFeed } from "@/lib/api";
import type { FeedItem } from "@/lib/types";

const PAGE_SIZE = 20;

export function AlphaView() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  // New socket posts seen while reading a page deeper than 1; they are only
  // counted there so visible page content never shifts mid-read.
  const [pendingNew, setPendingNew] = useState(0);

  const seenRef = useRef<Set<string>>(new Set());
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const pageRef = useRef(1);

  const loadPage = useCallback(async (targetPage: number) => {
    const data = await fetchFeed({
      matched: true,
      limit: PAGE_SIZE,
      offset: (targetPage - 1) * PAGE_SIZE,
    });
    const rows = data.items ?? [];
    rows.forEach((row) => seenRef.current.add(row.id));
    setItems(rows);
    setHasMore(data.hasMore);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPage(page)
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load feed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, loadPage]);

  useEffect(() => {
    // Singleton socket shared with the feed view; the server joins per-user
    // rooms on the handshake, so live matches require being logged in.
    const socket = getSocket();
    socketRef.current = socket;
    // The singleton may already be connected when this page mounts — the
    // "connect" event won't fire again, so seed the badge from live state.
    setConnected(socket.connected);

    const onConnect = () => {
      setConnected(true);
      // After a reconnect, re-fetch the current page to catch matched items
      // missed offline.
      loadPage(pageRef.current).catch(() => {});
    };
    const onDisconnect = () => setConnected(false);
    const onFeedNew = (item: FeedItem) => {
      // Non-matching items must never enter the alpha list.
      if (!item.matchedKeywords || item.matchedKeywords.length === 0) return;
      if (seenRef.current.has(item.id)) return;
      seenRef.current.add(item.id);

      if (pageRef.current !== 1) {
        setPendingNew((current) => current + 1);
        return;
      }
      setItems((current) => [item, ...(current ?? [])]);
      setNewIds((current) => {
        const next = new Set(current);
        next.add(item.id);
        return next;
      });
      window.setTimeout(() => {
        setNewIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }, 4000);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("feed:new", onFeedNew);
    // The socket is a session-wide singleton (see getSocket) — detach only
    // this page's listeners, never disconnect the shared instance.
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("feed:new", onFeedNew);
    };
  }, [loadPage]);

  function gotoPage(next: number) {
    pageRef.current = next;
    setPage(next);
    setPendingNew(0);
    window.scrollTo({ top: 0 });
  }

  // Android Chrome freezes background tabs — reconnect when the user returns.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const socket = socketRef.current;
        if (socket && !socket.connected) {
          socket.connect();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl overflow-x-clip">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold">Alpha</h1>
          <p className="text-sm text-muted-foreground">
            Posts matching your keywords
          </p>
        </div>
        <Badge variant={connected ? "secondary" : "outline"}>
          <span
            className={
              connected
                ? "mr-1.5 size-1.5 rounded-full bg-emerald-500"
                : "mr-1.5 size-1.5 rounded-full bg-muted-foreground"
            }
          />
          {connected ? "Live" : "Offline"}
        </Badge>
      </div>

      {loading ? (
        <div className="space-y-4 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="p-6 text-sm text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Zap />
            </EmptyMedia>
            <EmptyTitle>No matches yet</EmptyTitle>
            <EmptyDescription>
              Add keywords and matching posts will collect here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            Manage phrases on the Keywords page; matches appear here live.
          </EmptyContent>
        </Empty>
      ) : (
        <div>
          {items.map((item) => (
            <FeedItemCard
              key={item.id}
              item={item}
              isNew={newIds.has(item.id)}
            />
          ))}
        </div>
      )}

      {!loading && (page > 1 || hasMore) ? (
        <Pagination className="border-t py-4">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (page > 1) gotoPage(page - 1);
                }}
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink
                href="#"
                isActive
                onClick={(event) => event.preventDefault()}
              >
                {page}
              </PaginationLink>
            </PaginationItem>
            {pendingNew > 0 ? (
              <PaginationItem>
                <button
                  type="button"
                  onClick={() => gotoPage(1)}
                  className="px-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {pendingNew} new post{pendingNew === 1 ? "" : "s"} — back to
                  page 1
                </button>
              </PaginationItem>
            ) : null}
            <PaginationItem>
              <PaginationNext
                href="#"
                aria-disabled={!hasMore}
                className={!hasMore ? "pointer-events-none opacity-50" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (hasMore) gotoPage(page + 1);
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}
