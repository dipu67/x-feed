"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Rss } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedItemCard } from "@/components/feed-item-card";
import { useTweetNotifications } from "@/hooks/use-tweet-notifications";
import { useUser } from "@/hooks/useUser";
import { deleteFeedItem, deleteProject, fetchFeed } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { toast } from "sonner";
import type { FeedItem } from "@/lib/types";

const PAGE_SIZE = 20;

export function FeedView() {
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

  const notifications = useTweetNotifications();
  const { user, loading: userLoading } = useUser();
  // The toggle manages the web-push subscription; notifications themselves
  // come solely from the service worker. The socket only updates the list.
  const seenRef = useRef<Set<string>>(new Set());
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const pageRef = useRef(1);

  const loadPage = useCallback(
    async (targetPage: number) => {
      const data = await fetchFeed({
        limit: PAGE_SIZE,
        offset: (targetPage - 1) * PAGE_SIZE,
        filter: user ? "mine" : undefined,
      });
      const rows = data.items ?? [];
      rows.forEach((row) => seenRef.current.add(row.id));
      setItems(rows);
      setHasMore(data.hasMore);
    },
    [user],
  );

  useEffect(() => {
    // Wait for the auth check so the first fetch already carries the
    // session — /feed requires a login and the "mine" filter personalizes it.
    if (userLoading) return;
    let cancelled = false;
    setLoading(true);
    loadPage(page)
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
  }, [userLoading, user, page, loadPage]);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    // The singleton may already be connected when this page mounts — the
    // "connect" event won't fire again, so seed the badge from live state.
    setConnected(socket.connected);

    const onConnect = () => {
      setConnected(true);
      // After a reconnect, re-fetch the current page to catch items missed
      // while offline.
      loadPage(pageRef.current).catch(() => {});
    };
    const onDisconnect = () => setConnected(false);
    const onFeedNew = (item: FeedItem) => {
      // The poller re-emits items it re-upserts, so drop repeats before they
      // reach the list. Notifications come solely from the service worker.
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

  const liveLabel = useMemo(
    () => (connected ? "Live" : "Offline"),
    [connected],
  );

  async function handleDeletePost(item: FeedItem) {
    try {
      await deleteFeedItem(item.id);
      setItems((current) =>
        (current ?? []).filter((row) => row.id !== item.id),
      );
      toast.success("Post removed from feed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete post");
    }
  }

  async function handleDeleteProject(item: FeedItem) {
    try {
      await deleteProject(item.project.userId);
      setItems((current) =>
        (current ?? []).filter((row) => row.projectId !== item.projectId),
      );
      toast.success(`Removed @${item.project.username}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete project",
      );
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl overflow-x-clip">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold">Feed</h1>
          <p className="text-sm text-muted-foreground">
            New tweets from tracked projects
          </p>
        </div>
        <div className="flex items-center gap-3">
          {notifications.supported ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    {notifications.enabled ? (
                      <Bell className="size-4" />
                    ) : (
                      <BellOff className="size-4" />
                    )}
                    <Switch
                      checked={notifications.enabled}
                      disabled={notifications.blocked}
                      onCheckedChange={(checked) => {
                        void notifications.toggle(checked);
                      }}
                      aria-label="Notify me when a new tweet arrives"
                    />
                  </label>
                }
              />
              <TooltipContent>
                {notifications.blocked
                  ? "Notifications are blocked in your browser settings"
                  : notifications.enabled
                    ? "Desktop notification + sound on each new tweet"
                    : "Turn on desktop notifications and sound"}
              </TooltipContent>
            </Tooltip>
          ) : null}
          <Badge variant={connected ? "secondary" : "outline"}>
            <span
              className={
                connected
                  ? "mr-1.5 size-1.5 rounded-full bg-emerald-500"
                  : "mr-1.5 size-1.5 rounded-full bg-muted-foreground"
              }
            />
            {liveLabel}
          </Badge>
        </div>
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
              <Rss />
            </EmptyMedia>
            <EmptyTitle>No posts yet</EmptyTitle>
            <EmptyDescription>
              Add a project, then wait for the poller to detect a new tweet.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            New items appear here over Socket.IO as soon as they are found.
          </EmptyContent>
        </Empty>
      ) : (
        <div>
          {items.map((item) => (
            <FeedItemCard
              key={item.id}
              item={item}
              isNew={newIds.has(item.id)}
              onDeletePost={handleDeletePost}
              onDeleteProject={handleDeleteProject}
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
