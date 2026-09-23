import { describe, it, expect } from "vitest";
import { decidePoll } from "./poll-scheduler.js";

describe("decidePoll", () => {
  it("polls active accounts immediately", () => {
    const recent = new Date();
    const d = decidePoll({ lastTweetAt: recent });
    expect(d.pollNow).toBe(true);
  });

  it("skips accounts with no tweets in the last 7 days, returning nextCheckAfterMs >= 1 minute", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const d = decidePoll({ lastTweetAt: eightDaysAgo });
    expect(d.pollNow).toBe(false);
    if (!d.pollNow) {
      expect(d.nextCheckAfterMs).toBeGreaterThanOrEqual(60_000);
    }
  });

  it("polls accounts with no tweet history immediately", () => {
    const d = decidePoll({ lastTweetAt: null });
    expect(d.pollNow).toBe(true);
  });

  it("respects injected `now` for deterministic thresholds", () => {
    const sevenDaysAgoMs = 7 * 24 * 60 * 60 * 1000;
    const now = 10_000_000_000;
    const lastTweetAt = new Date(now - sevenDaysAgoMs);
    // Exactly at the threshold is treated as inactive (strict <).
    const d = decidePoll({ lastTweetAt }, now);
    expect(d.pollNow).toBe(false);
  });
});
