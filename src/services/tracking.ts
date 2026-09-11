import { prisma } from "../db/prisma.js";
import type { UserData } from "../TwitterClient/types.js";

export type ProjectStatus = "active" | "suspended" | "unavailable" | "not_found";

/**
 * Consecutive cycles a user may miss before we call them suspended. At the
 * default 60s poll cycle, 3 misses (~3 min) absorbs a flaky lookup or
 * rate-limited batch without marking healthy accounts.
 */
export const SUSPEND_AFTER_MISSES = 3;

export type ProjectSnapshotInput = {
  userId: string;
  username: string;
  twitterName: string | null;
  twitterBio: string | null;
  location: string | null;
  isBlueVerified: boolean;
  profileImageUrl: string | null;
  website: string | null;
  followers: number;
  following: number;
  tweets: number;
  status: string;
  missedChecks: number;
};

export type FieldChange = {
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function boolAsText(value: boolean): string {
  return value ? "true" : "false";
}

function detectProfileChanges(
  project: ProjectSnapshotInput,
  user: UserData,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const fields: Array<[string, string | null, string | null]> = [
    ["username", project.username, user.username],
    ["name", trimOrNull(project.twitterName), trimOrNull(user.name)],
    [
      "bio",
      trimOrNull(project.twitterBio),
      trimOrNull(user.description),
    ],
    [
      "avatar",
      trimOrNull(project.profileImageUrl),
      trimOrNull(user.profileImageUrl),
    ],
    ["location", trimOrNull(project.location), trimOrNull(user.location)],
    [
      "verified",
      boolAsText(project.isBlueVerified),
      boolAsText(user.isBlueVerified ?? false),
    ],
  ];
  for (const [field, oldValue, newValue] of fields) {
    if (oldValue !== newValue) {
      changes.push({ field, oldValue, newValue });
    }
  }
  return changes;
}

function detectMetricChanges(
  project: ProjectSnapshotInput,
  user: UserData,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const metrics: Array<[string, number, number]> = [
    ["followers", project.followers, user.followersCount ?? project.followers],
    ["following", project.following, user.followingCount ?? project.following],
    ["tweets", project.tweets, user.tweetCount ?? project.tweets],
  ];
  for (const [field, oldValue, newValue] of metrics) {
    if (oldValue !== newValue) {
      changes.push({
        field,
        oldValue: String(oldValue),
        newValue: String(newValue),
      });
    }
  }
  return changes;
}

function detectStatusChange(
  oldStatus: string,
  newStatus: ProjectStatus,
): FieldChange | null {
  if (oldStatus === newStatus) return null;
  return { field: "status", oldValue: oldStatus, newValue: newStatus };
}

export type PresenceResult = {
  changes: FieldChange[];
  statusChanged: boolean;
};

/**
 * Apply a fresh X user payload to the project row:
 *   - persist metric + profile fields
 *   - emit a ProjectChange row for each field that moved (metric rows are
 *     coalesced inside a 10-min window so an account gaining 100s of
 *     followers per hour doesn't blow up the table)
 *   - write a ProjectSnapshot only when a metric or status moved (so idle
 *     accounts don't bloat the table)
 *   - reset missedChecks (the user is visible to X)
 */
export async function applyUserPresence(
  project: ProjectSnapshotInput,
  user: UserData,
): Promise<PresenceResult> {
  const profileChanges = detectProfileChanges(project, user);
  const metricChanges = detectMetricChanges(project, user);
  const nextStatus: ProjectStatus = "active";
  const statusChange = detectStatusChange(project.status, nextStatus);
  const statusChanged = Boolean(statusChange);

  const now = new Date();

  await prisma.project.update({
    where: { userId: project.userId },
    data: {
      username: user.username,
      twitterName: trimOrNull(user.name),
      twitterBio: trimOrNull(user.description),
      location: trimOrNull(user.location),
      isBlueVerified: user.isBlueVerified ?? false,
      profileImageUrl: user.profileImageUrl ?? project.profileImageUrl,
      followers: user.followersCount ?? project.followers,
      following: user.followingCount ?? project.following,
      tweets: user.tweetCount ?? project.tweets,
      lastSeenAt: now,
      missedChecks: 0,
      ...(statusChanged
        ? {
            status: nextStatus,
            statusReason: null,
            statusChangedAt: now,
          }
        : {}),
    },
  });

  // Snapshot when a metric actually moved or status flipped. Sparse writes
  // keep the table small for idle accounts while still giving the growth
  // route a reference value at any window start.
  const metricMoved = metricChanges.length > 0;
  if (metricMoved || statusChanged) {
    await prisma.projectSnapshot.create({
      data: {
        projectId: project.userId,
        followers: user.followersCount ?? project.followers,
        following: user.followingCount ?? project.following,
        tweets: user.tweetCount ?? project.tweets,
        status: statusChanged ? nextStatus : project.status,
        capturedAt: now,
      },
    });
  }

  // Profile field rows are distinct events — append directly.
  // Metric rows are coalesced into the prior row if it's inside the
  // 10-minute window so a 24h window doesn't carry thousands of small
  // badges for the same field.
  const insertedChanges: FieldChange[] = [...profileChanges];
  for (const change of metricChanges) {
    const field = change.field as "followers" | "following" | "tweets";
    const oldValue = Number(change.oldValue ?? 0);
    const newValue = Number(change.newValue ?? 0);
    if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) continue;
    const { coalesced } = await upsertMetricChange(
      project.userId,
      field,
      oldValue,
      newValue,
      now,
    );
    // Always report the move to the caller (so logs and socket emit it),
    // but only surface it in the consolidated list as one entry per field
    // per cycle — coalesced rows are still a real change.
    void coalesced;
    insertedChanges.push(change);
  }
  if (statusChange) insertedChanges.push(statusChange);

  if (insertedChanges.length > 0) {
    // Profile + status rows go straight in (one per event). Metric rows
    // were already upserted above; don't double-insert.
    const nonMetricRows = insertedChanges.filter(
      (c) =>
        c.field !== "followers" &&
        c.field !== "following" &&
        c.field !== "tweets",
    );
    if (nonMetricRows.length > 0) {
      await prisma.projectChange.createMany({
        data: nonMetricRows.map((c) => ({
          projectId: project.userId,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          changedAt: now,
        })),
      });
    }
  }

  return { changes: insertedChanges, statusChanged };
}

/**
 * Coalesce high-frequency metric changes for a single project. If the
 * most recent change row for a metric field is younger than
 * COALESCE_WINDOW_MS, fold the new delta into it instead of appending a
 * new row. Non-metric fields (username, bio, status, …) are always
 * appended because the UI must show them distinctly.
 *
 * Without coalescing, a project gaining 3k followers/day produces 3k
 * rows in `project_changes`, the `/growth` route pulls them all, and the
 * UI shows a log of thousands of badges per account. Coalescing keeps
 * the table proportional to the number of distinct *events*, not the
 * poll cadence.
 */
const COALESCE_WINDOW_MS = 10 * 60 * 1000;

export async function upsertMetricChange(
  projectId: string,
  field: "followers" | "following" | "tweets",
  oldValue: number,
  newValue: number,
  now: Date = new Date(),
): Promise<{ coalesced: boolean }> {
  if (oldValue === newValue) return { coalesced: false };
  const cutoff = new Date(now.getTime() - COALESCE_WINDOW_MS);
  const existing = await prisma.projectChange.findFirst({
    where: {
      projectId,
      field,
      changedAt: { gte: cutoff },
    },
    orderBy: { changedAt: "desc" },
  });
  if (existing) {
    await prisma.projectChange.update({
      where: { id: existing.id },
      data: {
        // Keep the original oldest oldValue as the new oldValue (so the
        // displayed diff still spans the whole coalesced window), update
        // newValue + changedAt to "now".
        oldValue: existing.oldValue ?? String(oldValue),
        newValue: String(newValue),
        changedAt: now,
      },
    });
    return { coalesced: true };
  }
  await prisma.projectChange.create({
    data: {
      projectId,
      field,
      oldValue: String(oldValue),
      newValue: String(newValue),
      changedAt: now,
    },
  });
  return { coalesced: false };
}

export type AbsenceResult = {
  missedChecks: number;
  newStatus: ProjectStatus;
  statusChanged: boolean;
};

/**
 * Handle a user that X did not return for this batch. Increment
 * missedChecks, debounce suspension after SUSPEND_AFTER_MISSES misses, and
 * log a status transition when the threshold is crossed.
 *
 * A single missed batch (rate limit, transient miss) doesn't change status.
 */
export async function applyUserAbsence(
  project: ProjectSnapshotInput,
): Promise<AbsenceResult> {
  const missedChecks = project.missedChecks + 1;
  const crossedThreshold =
    missedChecks >= SUSPEND_AFTER_MISSES && project.status !== "suspended";

  const newStatus: ProjectStatus = crossedThreshold
    ? "suspended"
    : (project.status as ProjectStatus);
  const reason = crossedThreshold
    ? `missing from getUsersByIds for ${missedChecks} consecutive cycles`
    : project.status === "suspended"
      ? "still missing"
      : null;

  const now = new Date();

  await prisma.project.update({
    where: { userId: project.userId },
    data: {
      missedChecks,
      ...(crossedThreshold
        ? {
            status: newStatus,
            statusReason: reason,
            statusChangedAt: now,
          }
        : {}),
    },
  });

  if (crossedThreshold) {
    await prisma.projectChange.create({
      data: {
        projectId: project.userId,
        field: "status",
        oldValue: project.status,
        newValue: newStatus,
        changedAt: now,
      },
    });

    await prisma.projectSnapshot.create({
      data: {
        projectId: project.userId,
        followers: project.followers,
        following: project.following,
        tweets: project.tweets,
        status: newStatus,
        capturedAt: now,
      },
    });
  }

  return { missedChecks, newStatus, statusChanged: crossedThreshold };
}
