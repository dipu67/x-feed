import { fxTwitter } from "./client.js";
import type { APITwitterStatus, StatusListAPIResponse } from "./types.js";

export type StatusesPage = {
  statuses: APITwitterStatus[];
  cursorTop: string | null;
};

function isStatus(item: StatusListAPIResponse["results"][number]): item is APITwitterStatus {
  return item.type === "status";
}

/**
 * Timeline page from fxTwitter.
 * Passing the previous `cursor.top` returns only tweets newer than that cursor.
 * No newer tweets → `results: []` (or HTTP 204 / null).
 */
export async function fetchProfileStatusesPage(
  username: string,
  cursorTop?: string | null,
): Promise<StatusesPage> {
  const options = cursorTop ? { cursor: cursorTop } : {};
  const response = await fxTwitter.getProfileStatuses(username, options);
  if (!response) {
    return { statuses: [], cursorTop: cursorTop ?? null };
  }
  return {
    statuses: response.results.filter(isStatus),
    cursorTop: response.cursor.top ?? cursorTop ?? null,
  };
}

/** Baseline `cursor.top` so later polls only see tweets newer than this. */
export async function seedStatusesCursorTop(
  username: string,
): Promise<string | null> {
  try {
    const page = await fetchProfileStatusesPage(username);
    return page.cursorTop;
  } catch (error) {
    console.warn(
      `[feed] could not seed cursor.top for @${username}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
