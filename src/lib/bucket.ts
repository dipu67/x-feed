export type TrendRange = "24h" | "7d" | "30d";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const ROLLUP_RETENTION_MS = 30 * DAY_MS;

export function hourBucketStart(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export function dayBucketStart(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const TREND_RANGES = ["24h", "7d", "30d"] as const;

export function parseTrendRange(raw: unknown): TrendRange {
  if (typeof raw !== "string") return "24h";
  return (TREND_RANGES as readonly string[]).includes(raw)
    ? (raw as TrendRange)
    : "24h";
}

export function trendWindow(
  range: TrendRange,
  now: number = Date.now(),
): { granularity: "hour" | "day"; since: Date } {
  switch (range) {
    case "30d":
      return { granularity: "day", since: new Date(now - 30 * DAY_MS) };
    case "7d":
      return { granularity: "hour", since: new Date(now - 7 * DAY_MS) };
    case "24h":
      return { granularity: "hour", since: new Date(now - DAY_MS) };
  }
}
