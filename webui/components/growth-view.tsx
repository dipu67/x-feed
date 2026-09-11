"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Flame,
  Minus,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  fetchGrowth,
  type GrowthChange,
  type GrowthRange,
  type GrowthResponse,
  type GrowthUser,
} from "@/lib/api";
import { formatCount, formatRelativeTime } from "@/lib/format";

type SortOrder = "asc" | "desc";

const RANGES: { key: GrowthRange; label: string; description: string }[] = [
  { key: "1h", label: "1 hour", description: "Last 60 minutes" },
  { key: "12h", label: "12 hours", description: "Last 12 hours" },
  { key: "24h", label: "24 hours", description: "Last day" },
  { key: "7d", label: "7 days", description: "Last week" },
  { key: "all", label: "All time", description: "Since first snapshot" },
];

const FIELD_LABELS: Record<string, string> = {
  username: "Handle",
  name: "Display name",
  bio: "Bio",
  avatar: "Avatar",
  location: "Location",
  verified: "Blue check",
  status: "Status",
  followers: "Followers",
  following: "Following",
  tweets: "Tweets",
};

function rangeLabel(range: GrowthRange): string {
  return RANGES.find((r) => r.key === range)?.label ?? range;
}

function formatDelta(value: number): {
  text: string;
  tone: "up" | "down" | "flat";
} {
  if (Number.isNaN(value)) return { text: "—", tone: "flat" };
  if (value === 0) return { text: "0", tone: "flat" };
  const sign = value > 0 ? "+" : "";
  return {
    text: `${sign}${formatCount(value)}`,
    tone: value > 0 ? "up" : "down",
  };
}

function deltaClasses(tone: "up" | "down" | "flat"): string {
  if (tone === "up") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "down") return "text-rose-600 dark:text-rose-400";
  return "text-muted-foreground";
}

function changeBadge(change: GrowthChange): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (change.field === "status") {
    return {
      label: `Status: ${change.oldValue ?? "?"} → ${change.newValue ?? "?"}`,
      variant: change.newValue === "suspended" ? "destructive" : "secondary",
    };
  }
  if (change.field === "verified") {
    return {
      label: change.newValue === "true" ? "Got blue check" : "Lost blue check",
      variant: change.newValue === "true" ? "default" : "outline",
    };
  }
  const label = FIELD_LABELS[change.field] ?? change.field;
  return { label, variant: "secondary" };
}

function Delta({ value }: { value: number }) {
  const { text, tone } = formatDelta(value);
  const Icon =
    tone === "up" ? ArrowUp : tone === "down" ? ArrowDown : Minus;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${deltaClasses(tone)}`}
    >
      <Icon className="size-3" aria-hidden />
      {text}
    </span>
  );
}

function StatusBadge({ user }: { user: GrowthUser }) {
  if (user.status === "active") return null;
  const variant: "destructive" | "secondary" | "outline" =
    user.status === "suspended"
      ? "destructive"
      : user.status === "not_found"
        ? "outline"
        : "secondary";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant={variant} className="text-[10px] uppercase" />
        }
      >
        {user.status}
      </TooltipTrigger>
      <TooltipContent>
        {user.statusReason ?? `No X response in last ${user.missedChecks} cycle(s)`}
      </TooltipContent>
    </Tooltip>
  );
}

function ChangeBadges({ changes }: { changes: GrowthChange[] }) {
  if (changes.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const visible = changes.slice(-3);
  const overflow = changes.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((c, i) => {
        const { label, variant } = changeBadge(c);
        return (
          <Badge key={`${c.field}-${i}`} variant={variant} className="text-[10px]">
            {label}
          </Badge>
        );
      })}
      {overflow > 0 && (
        <Badge variant="outline" className="text-[10px]">
          +{overflow} more
        </Badge>
      )}
    </div>
  );
}

/**
 * Aggregate a user's changes for table-row display. The poller coalesces
 * metric changes into one row per 10-minute window, but a 24h window can
 * still hold hundreds of rows for hot accounts. Summarize those into
 * per-field totals so the row stays a few chips.
 */
function summarizeChanges(
  changes: GrowthChange[],
): Array<{ field: string; label: string; variant: "default" | "secondary" | "destructive" | "outline"; count: number; totalDelta: number }> {
  if (changes.length === 0) return [];
  const byField = new Map<
    string,
    { count: number; totalDelta: number; sample: GrowthChange }
  >();
  for (const c of changes) {
    const isMetric =
      c.field === "followers" || c.field === "following" || c.field === "tweets";
    const slot = byField.get(c.field) ?? {
      count: 0,
      totalDelta: 0,
      sample: c,
    };
    slot.count += 1;
    if (isMetric) {
      const next = Number(c.newValue ?? 0);
      const prev = Number(c.oldValue ?? 0);
      if (Number.isFinite(next) && Number.isFinite(prev)) {
        slot.totalDelta += next - prev;
      }
    }
    byField.set(c.field, slot);
  }
  const out: Array<{
    field: string;
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    count: number;
    totalDelta: number;
  }> = [];
  for (const [field, { count, totalDelta, sample }] of byField) {
    const isMetric =
      field === "followers" || field === "following" || field === "tweets";
    if (isMetric) {
      const sign = totalDelta >= 0 ? "+" : "";
      const baseLabel = FIELD_LABELS[field] ?? field;
      out.push({
        field,
        label: `${baseLabel} ${sign}${formatCount(totalDelta)}`,
        variant: totalDelta >= 0 ? "default" : "destructive",
        count,
        totalDelta,
      });
    } else {
      const { label, variant } = changeBadge(sample);
      out.push({ field, label, variant, count, totalDelta: 0 });
    }
  }
  // Most recent sample last.
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

function ChangesSummary({ changes }: { changes: GrowthChange[] }) {
  const summary = summarizeChanges(changes);
  if (summary.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {summary.map((s) => (
        <Tooltip key={s.field}>
          <TooltipTrigger
            render={
              <Badge variant={s.variant} className="text-[10px]" />
            }
          >
            {s.label}
          </TooltipTrigger>
          <TooltipContent>
            {s.count === 1
              ? "1 change in window"
              : `${s.count} changes in window`}
            {s.totalDelta !== 0 && (
              <>
                {" · "}net {formatDelta(s.totalDelta).text}
              </>
            )}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function LatestTweetCell({ user }: { user: GrowthUser }) {
  const tweet = user.latestTweet;
  if (!tweet) {
    return <span className="text-xs text-muted-foreground">No tweets yet</span>;
  }
  return (
    <a
      href={tweet.tweetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex max-w-[260px] flex-col gap-0.5 text-xs"
    >
      <span className="line-clamp-2 text-foreground group-hover:underline">
        {tweet.text}
      </span>
      <span className="inline-flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{formatRelativeTime(tweet.postedAt)}</span>
        <span>·</span>
        <span>♥ {formatCount(tweet.likes)}</span>
        <span>↻ {formatCount(tweet.reposts)}</span>
        <span>↩ {formatCount(tweet.replies)}</span>
        <ExternalLink className="size-3" aria-hidden />
      </span>
    </a>
  );
}

type DetailState = {
  user: GrowthUser;
  range: GrowthRange;
};

export function GrowthView() {
  const [range, setRange] = useState<GrowthRange>("24h");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [data, setData] = useState<GrowthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const result = await fetchGrowth({
          range,
          sortBy: "userId",
          sortOrder,
        });
        setData(result);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load growth data",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [range, sortOrder],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  const users = useMemo(() => data?.users ?? [], [data]);

  const totals = useMemo(() => {
    const seedFollowers = users.reduce(
      (acc, u) => acc + u.followersDelta,
      0,
    );
    const followingDelta = users.reduce(
      (acc, u) => acc + u.followingDelta,
      0,
    );
    const tweetsDelta = users.reduce(
      (acc, u) => acc + u.tweetsDelta,
      0,
    );
    const suspended = users.filter((u) => u.status === "suspended").length;
    const withChanges = users.filter((u) => u.changes.length > 0).length;
    return {
      seedFollowers,
      followingDelta,
      tweetsDelta,
      suspended,
      withChanges,
    };
  }, [users]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Growth</h1>
          <p className="text-sm text-muted-foreground">
            Track follower, following, and tweet growth across your tracked
            accounts. Default sort is by user ID.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            value={sortOrder}
            onValueChange={(v: string) => setSortOrder(v as SortOrder)}
          >
            <TabsList variant="line" className="h-8">
              <TabsTrigger value="asc">Asc</TabsTrigger>
              <TabsTrigger value="desc">Desc</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load("refresh")}
            disabled={refreshing || loading}
          >
            <RefreshCw
              className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden
            />
            Refresh
          </Button>
        </div>
      </header>

      <Tabs
        value={range}
        onValueChange={(v: string) => setRange(v as GrowthRange)}
      >
        <TabsList>
          {RANGES.map((r) => (
            <TabsTrigger key={r.key} value={r.key}>
              {r.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="New followers"
          icon={<TrendingUp className="size-4" />}
          value={totals.seedFollowers}
          loading={loading}
        />
        <SummaryCard
          title="New tweets"
          icon={<Flame className="size-4" />}
          value={totals.tweetsDelta}
          loading={loading}
        />
        <SummaryCard
          title="Accounts with changes"
          icon={<RefreshCw className="size-4" />}
          value={totals.withChanges}
          loading={loading}
          disableFormat
        />
        <SummaryCard
          title="Suspended"
          icon={
            <span className="text-base font-semibold text-destructive">!</span>
          }
          value={totals.suspended}
          loading={loading}
          disableFormat
          danger={totals.suspended > 0}
        />
      </section>

      <Card className="min-h-0 flex-1">
        <CardHeader className="border-b">
          <CardTitle>Projects · {rangeLabel(range)}</CardTitle>
          <CardDescription>
            Click any row to see the full change log. Deltas are computed
            against the newest snapshot at or before the window start.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !data ? (
            <GrowthSkeleton />
          ) : users.length === 0 ? (
            <Empty className="m-6 border border-dashed">
              <EmptyHeader>
                <EmptyMedia>
                  <TrendingUp className="size-6 text-muted-foreground" />
                </EmptyMedia>
                <EmptyTitle>No tracked projects</EmptyTitle>
                <EmptyDescription>
                  Add a Twitter account on the Projects page to start
                  tracking its growth.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <GrowthTable
              users={users}
              onOpen={(user) => setDetail({ user, range })}
            />
          )}
        </CardContent>
      </Card>

      <GrowthDetailDialog
        detail={detail}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  loading,
  disableFormat,
  danger,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  loading: boolean;
  disableFormat?: boolean;
  danger?: boolean;
}) {
  const tone =
    value > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : value < 0
        ? "text-rose-600 dark:text-rose-400"
        : "text-foreground";
  return (
    <Card size="sm">
      <CardHeader className="border-b-0 pb-1">
        <CardDescription className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide">
          {icon}
          {title}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p
            className={`text-2xl font-semibold tabular-nums ${danger ? "text-destructive" : tone}`}
          >
            {disableFormat ? value : formatDelta(value).text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function GrowthTable({
  users,
  onOpen,
}: {
  users: GrowthUser[];
  onOpen: (user: GrowthUser) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[260px]">Project</TableHead>
          <TableHead className="text-right">
            <span className="inline-flex items-center gap-1">Followers</span>
          </TableHead>
          <TableHead className="text-right">Following</TableHead>
          <TableHead className="text-right">Tweets</TableHead>
          <TableHead className="hidden text-right md:table-cell">In window</TableHead>
          <TableHead className="hidden lg:table-cell">Latest tweet</TableHead>
          <TableHead className="hidden md:table-cell">Changes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow
            key={user.userId}
            className="cursor-pointer"
            onClick={() => onOpen(user)}
          >
            <TableCell className="font-medium">
              <div className="flex items-center gap-3">
                <Avatar size="sm">
                  {user.profileImageUrl ? (
                    <AvatarImage
                      src={user.profileImageUrl}
                      alt={user.username}
                    />
                  ) : null}
                  <AvatarFallback>
                    {(user.twitterName ?? user.username).slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="truncate">
                      {user.twitterName ?? user.username}
                    </span>
                    <StatusBadge user={user} />
                  </div>
                  <span className="block text-xs text-muted-foreground">
                    @{user.username} · id {user.userId}
                  </span>
                </div>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <div className="flex flex-col items-end">
                <span>{formatCount(user.followers)}</span>
                <Delta value={user.followersDelta} />
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <div className="flex flex-col items-end">
                <span>{formatCount(user.following)}</span>
                <Delta value={user.followingDelta} />
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <div className="flex flex-col items-end">
                <span>{formatCount(user.tweets)}</span>
                <Delta value={user.tweetsDelta} />
              </div>
            </TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">
              {user.tweetsInWindow}
            </TableCell>
            <TableCell className="hidden lg:table-cell">
              <LatestTweetCell user={user} />
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <ChangesSummary changes={user.changes} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function GrowthSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function GrowthDetailDialog({
  detail,
  onClose,
}: {
  detail: DetailState | null;
  onClose: () => void;
}) {
  const open = detail !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        {detail ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <Avatar>
                  {detail.user.profileImageUrl ? (
                    <AvatarImage
                      src={detail.user.profileImageUrl}
                      alt={detail.user.username}
                    />
                  ) : null}
                  <AvatarFallback>
                    {(detail.user.twitterName ?? detail.user.username).slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <DialogTitle>
                    {detail.user.twitterName ?? detail.user.username}
                  </DialogTitle>
                  <DialogDescription>
                    @{detail.user.username} · id {detail.user.userId} ·{" "}
                    {rangeLabel(detail.range)}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-3">
              <DetailMetric label="Followers" user={detail.user} field="followers" />
              <DetailMetric label="Following" user={detail.user} field="following" />
              <DetailMetric label="Tweets" user={detail.user} field="tweets" />
            </div>

            {detail.user.status !== "active" && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive">
                  Account is {detail.user.status}
                </p>
                <p className="text-muted-foreground">
                  {detail.user.statusReason ?? "Account is not responding."}
                  {detail.user.missedChecks > 0 && (
                    <>
                      {" "}
                      Missed {detail.user.missedChecks} consecutive cycle
                      {detail.user.missedChecks === 1 ? "" : "s"}.
                    </>
                  )}
                </p>
              </div>
            )}

            <div>
              <h3 className="text-sm font-medium">
                Changes in this window ({detail.user.changes.length})
              </h3>
              {detail.user.changes.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No profile or metric changes recorded.
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {detail.user.changes.map((c, i) => {
                    const { label, variant } = changeBadge(c);
                    return (
                      <li
                        key={`${c.field}-${i}`}
                        className="flex items-start gap-2 text-xs"
                      >
                        <Badge variant={variant} className="shrink-0 text-[10px]">
                          {label}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {c.field === "status" ? null : (
                            <>
                              <span className="line-through">
                                {c.oldValue ?? "—"}
                              </span>
                              {" → "}
                              <span className="text-foreground">
                                {c.newValue ?? "—"}
                              </span>
                            </>
                          )}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatRelativeTime(c.changedAt)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailMetric({
  label,
  user,
  field,
}: {
  label: string;
  user: GrowthUser;
  field: "followers" | "following" | "tweets";
}) {
  const value = user[field];
  const delta =
    field === "followers"
      ? user.followersDelta
      : field === "following"
        ? user.followingDelta
        : user.tweetsDelta;
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{formatCount(value)}</p>
      <Delta value={delta} />
    </div>
  );
}
