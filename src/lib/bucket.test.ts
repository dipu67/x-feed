import { describe, it, expect } from "vitest";
import {
  hourBucketStart,
  dayBucketStart,
  trendWindow,
  parseTrendRange,
  ROLLUP_RETENTION_MS,
} from "./bucket.js";

describe("hourBucketStart", () => {
  it("truncates minutes/seconds/millis", () => {
    expect(
      hourBucketStart(new Date("2026-09-28T07:22:08.500Z")).toISOString(),
    ).toBe("2026-09-28T07:00:00.000Z");
  });
  it("is exact on the hour", () => {
    expect(
      hourBucketStart(new Date("2026-09-28T07:00:00.000Z")).toISOString(),
    ).toBe("2026-09-28T07:00:00.000Z");
  });
});

describe("dayBucketStart", () => {
  it("truncates to UTC midnight", () => {
    expect(
      dayBucketStart(new Date("2026-09-28T07:22:08.500Z")).toISOString(),
    ).toBe("2026-09-28T00:00:00.000Z");
  });
  it("UTC day edge: 23:59 is day N, 00:00 is day N+1", () => {
    expect(
      dayBucketStart(new Date("2026-09-28T23:59:59.999Z")).toISOString(),
    ).toBe("2026-09-28T00:00:00.000Z");
    expect(
      dayBucketStart(new Date("2026-09-29T00:00:00.000Z")).toISOString(),
    ).toBe("2026-09-29T00:00:00.000Z");
  });
});

describe("trendWindow", () => {
  it("24h and 7d use hourly buckets", () => {
    expect(trendWindow("24h", 0).granularity).toBe("hour");
    expect(trendWindow("7d", 0).granularity).toBe("hour");
  });
  it("30d uses daily buckets", () => {
    expect(trendWindow("30d", 0).granularity).toBe("day");
  });
  it("since is exactly the range back from now", () => {
    const now = Date.parse("2026-09-28T12:00:00.000Z");
    expect(trendWindow("24h", now).since.toISOString()).toBe(
      "2026-09-27T12:00:00.000Z",
    );
    expect(trendWindow("7d", now).since.toISOString()).toBe(
      "2026-09-21T12:00:00.000Z",
    );
    expect(trendWindow("30d", now).since.toISOString()).toBe(
      "2026-08-29T12:00:00.000Z",
    );
  });
});

describe("parseTrendRange", () => {
  it("defaults to 24h on garbage", () => {
    expect(parseTrendRange(undefined)).toBe("24h");
    expect(parseTrendRange("1h")).toBe("24h");
  });
  it("accepts the three valid ranges", () => {
    expect(parseTrendRange("24h")).toBe("24h");
    expect(parseTrendRange("7d")).toBe("7d");
    expect(parseTrendRange("30d")).toBe("30d");
  });
});

describe("ROLLUP_RETENTION_MS", () => {
  it("is 30 days", () => {
    expect(ROLLUP_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
