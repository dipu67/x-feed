"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Bell, BellOff, Rss } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { SOCKET_URL, fetchFeed } from "@/lib/api";
import type { FeedItem } from "@/lib/types";

export function FeedView() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const notifications = useTweetNotifications();
  // Kept in refs so the socket effect can stay mounted once, without
  // resubscribing whenever the toggle or the item list changes.
  const notifyRef = useRef(notifications.notify);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    notifyRef.current = notifications.notify;
  }, [notifications.notify]);

  useEffect(() => {
    let cancelled = false;
    fetchFeed()
      .then((data) => {
        if (cancelled) return;
        const rows = data.items ?? [];
        rows.forEach((row) => seenRef.current.add(row.id));
        // A socket item can land before this resolves — keep it on top
        // instead of letting the initial page overwrite it.
        setItems((current) => {
          const fetched = new Set(rows.map((row) => row.id));
          const live = (current ?? []).filter((row) => !fetched.has(row.id));
          return [...live, ...rows];
        });
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
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("feed:new", (item: FeedItem) => {
      // The poller re-emits items it re-upserts, so drop repeats before they
      // reach the list or fire a notification.
      if (seenRef.current.has(item.id)) return;
      seenRef.current.add(item.id);

      setItems((current) => [item, ...(current ?? [])]);
      setNewIds((current) => {
        const next = new Set(current);
        next.add(item.id);
        return next;
      });
      notifyRef.current(item);
      window.setTimeout(() => {
        setNewIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }, 4000);
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  const liveLabel = useMemo(
    () => (connected ? "Live" : "Offline"),
    [connected],
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
