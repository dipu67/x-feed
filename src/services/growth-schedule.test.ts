import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROWTH_INTERVAL_MS,
  isGrowthDue,
  parseGrowthInterval,
  GrowthIntervalError,
} from "./growth-schedule.js";

describe("isGrowthDue", () => {
  const hour = 60 * 60 * 1000;
  const now = new Date("2026-10-09T12:00:00.000Z");

  it("is due when nothing has been recorded", () => {
    expect(isGrowthDue(null, hour, now)).toBe(true);
  });

  it("waits until a full interval has elapsed", () => {
    expect(isGrowthDue(new Date(now.getTime() - hour + 1), hour, now)).toBe(false);
    expect(isGrowthDue(new Date(now.getTime() - hour), hour, now)).toBe(true);
  });
});

describe("parseGrowthInterval", () => {
  it("accepts the default hour and rejects free-form values", () => {
    expect(parseGrowthInterval(DEFAULT_GROWTH_INTERVAL_MS)).toBe(
      DEFAULT_GROWTH_INTERVAL_MS,
    );
    expect(() => parseGrowthInterval(90_000)).toThrow(GrowthIntervalError);
    expect(() => parseGrowthInterval("3600000")).toThrow(GrowthIntervalError);
  });
});
