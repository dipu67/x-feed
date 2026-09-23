export type ScheduleDecision =
  | { pollNow: true }
  | { pollNow: false; reason: "inactive"; nextCheckAfterMs: number };

const ACTIVE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_INTERVAL_MS = 60 * 60 * 1000;
const QUARTER_INTERVAL_MS = BASE_INTERVAL_MS * 4;

export function decidePoll(
  project: { lastTweetAt: Date | null },
  now: number = Date.now(),
): ScheduleDecision {
  if (project.lastTweetAt === null) return { pollNow: true };
  const ageMs = now - project.lastTweetAt.getTime();
  if (ageMs < ACTIVE_THRESHOLD_MS) return { pollNow: true };
  return { pollNow: false, reason: "inactive", nextCheckAfterMs: QUARTER_INTERVAL_MS };
}
