import { prisma } from "../db/prisma.js";

/** One settings row. The growth page edits it; the feed worker reads it. */
const SETTINGS_ID = "default";

export const GROWTH_INTERVAL_PRESETS = [
  { ms: 60_000, label: "1 minute" },
  { ms: 15 * 60_000, label: "15 minutes" },
  { ms: 30 * 60_000, label: "30 minutes" },
  { ms: 60 * 60_000, label: "1 hour" },
  { ms: 3 * 60 * 60_000, label: "3 hours" },
  { ms: 6 * 60 * 60_000, label: "6 hours" },
  { ms: 12 * 60 * 60_000, label: "12 hours" },
  { ms: 24 * 60 * 60_000, label: "24 hours" },
] as const;

export const DEFAULT_GROWTH_INTERVAL_MS = 60 * 60_000;

export class GrowthIntervalError extends Error {
  constructor() {
    super(
      `growthIntervalMs must be one of: ${GROWTH_INTERVAL_PRESETS.map((preset) => preset.ms).join(", ")}`,
    );
    this.name = "GrowthIntervalError";
  }
}

export type GrowthSchedule = {
  growthIntervalMs: number;
  growthRecordedAt: Date | null;
  due: boolean;
};

export function isGrowthIntervalPreset(ms: number): boolean {
  return GROWTH_INTERVAL_PRESETS.some((preset) => preset.ms === ms);
}

export function parseGrowthInterval(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || !isGrowthIntervalPreset(raw)) {
    throw new GrowthIntervalError();
  }
  return raw;
}

/**
 * True when no snapshot has been stored yet, or the last one is at least
 * `intervalMs` old. Equal to the interval counts as due.
 */
export function isGrowthDue(
  recordedAt: Date | null,
  intervalMs: number,
  now: Date,
): boolean {
  if (recordedAt === null) return true;
  return now.getTime() - recordedAt.getTime() >= intervalMs;
}

function normalizeInterval(ms: number): number {
  return isGrowthIntervalPreset(ms) ? ms : DEFAULT_GROWTH_INTERVAL_MS;
}

function toSchedule(
  row: { growthIntervalMs: number; growthRecordedAt: Date | null },
  now: Date,
): GrowthSchedule {
  const growthIntervalMs = normalizeInterval(row.growthIntervalMs);
  return {
    growthIntervalMs,
    growthRecordedAt: row.growthRecordedAt,
    due: isGrowthDue(row.growthRecordedAt, growthIntervalMs, now),
  };
}

async function ensureSettings() {
  const existing = await prisma.trackerSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (existing) return existing;
  try {
    return await prisma.trackerSettings.create({
      data: { id: SETTINGS_ID, growthIntervalMs: DEFAULT_GROWTH_INTERVAL_MS },
    });
  } catch (error) {
    const again = await prisma.trackerSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (again) return again;
    throw error;
  }
}

export async function getGrowthSchedule(now = new Date()): Promise<GrowthSchedule> {
  return toSchedule(await ensureSettings(), now);
}

export async function setGrowthInterval(
  ms: number,
  now = new Date(),
): Promise<GrowthSchedule> {
  const growthIntervalMs = parseGrowthInterval(ms);
  const row = await prisma.trackerSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, growthIntervalMs },
    update: { growthIntervalMs },
  });
  return toSchedule(row, now);
}

export async function markGrowthRecorded(now = new Date()): Promise<void> {
  await prisma.trackerSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      growthIntervalMs: DEFAULT_GROWTH_INTERVAL_MS,
      growthRecordedAt: now,
    },
    update: { growthRecordedAt: now },
  });
}

export function serializeGrowthSettings(schedule: GrowthSchedule) {
  const nextGrowthAt = schedule.growthRecordedAt
    ? new Date(schedule.growthRecordedAt.getTime() + schedule.growthIntervalMs)
    : null;
  return {
    growthIntervalMs: schedule.growthIntervalMs,
    growthRecordedAt: schedule.growthRecordedAt?.toISOString() ?? null,
    nextGrowthAt: nextGrowthAt?.toISOString() ?? null,
    due: schedule.due,
    presets: GROWTH_INTERVAL_PRESETS.map((preset) => ({
      ms: preset.ms,
      label: preset.label,
    })),
  };
}

export function formatGrowthInterval(ms: number): string {
  const preset = GROWTH_INTERVAL_PRESETS.find((item) => item.ms === ms);
  return preset?.label ?? `${Math.round(ms / 60_000)}m`;
}
