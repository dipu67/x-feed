"use client";

import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { Rss } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { SOCKET_URL, fetchFeed } from "@/lib/api";
import type { FeedItem } from "@/lib/types";

export function FeedView() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFeed()
      .then((data) => {
        if (!cancelled) setItems(data.items ?? []);
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
      setItems((current) => {
        const rows = current ?? [];
        if (rows.some((row) => row.id === item.id)) return rows;
        return [item, ...rows];
      });
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
