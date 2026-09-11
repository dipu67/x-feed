import type {
  AuthToken,
  AuthTokenInput,
  FeedItem,
  Project,
  ProjectInput,
  WebhookInfo,
} from "@/lib/types";

export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:5500";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `API at /api${path} did not return JSON. Is the x-feed backend running on ${SOCKET_URL}?`,
    );
  }
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function fetchProjects() {
  const data = await request<{ projects?: Project[] }>("/projects");
  return { projects: Array.isArray(data.projects) ? data.projects : [] };
}

export function fetchProject(userId: string) {
  return request<{ project: Project }>(`/projects/${userId}`);
}

export function createProject(input: ProjectInput) {
  return request<{ project: Project }>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProject(userId: string, input: ProjectInput) {
  return request<{ project: Project }>(`/projects/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteProject(userId: string) {
  return request<{ deleted: boolean; userId: string }>(`/projects/${userId}`, {
    method: "DELETE",
  });
}

export async function fetchFeed(limit = 80) {
  const data = await request<{ items?: FeedItem[] }>(`/feed?limit=${limit}`);
  return { items: Array.isArray(data.items) ? data.items : [] };
}

export async function fetchAuthTokens() {
  const data = await request<{ tokens?: AuthToken[] }>("/auth-tokens");
  return { tokens: Array.isArray(data.tokens) ? data.tokens : [] };
}

export function createAuthToken(input: AuthTokenInput) {
  return request<{ token: AuthToken }>("/auth-tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAuthToken(id: string, input: AuthTokenInput) {
  return request<{ token: AuthToken }>(`/auth-tokens/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAuthToken(id: string) {
  return request<{ deleted: boolean; id: string }>(`/auth-tokens/${id}`, {
    method: "DELETE",
  });
}

export function fetchWebhookInfo() {
  return request<WebhookInfo>("/webhooks");
}

export function sendWebhookProject(input: ProjectInput, secret?: string) {
  return request<{ project: Project }>("/webhooks/projects", {
    method: "POST",
    headers: secret ? { "X-Webhook-Secret": secret } : {},
    body: JSON.stringify(input),
  });
}

// ── Growth ────────────────────────────────────────────────────────────────

export type GrowthChange = {
  /** username | name | bio | avatar | location | verified | status */
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
};

export type GrowthLatestTweet = {
  id: string;
  text: string;
  tweetUrl: string;
  postedAt: string;
  likes: number;
  reposts: number;
  replies: number;
};

export type GrowthUser = {
  userId: string;
  username: string;
  twitterName: string | null;
  twitterBio: string | null;
  location: string | null;
  isBlueVerified: boolean;
  followers: number;
  following: number;
  tweets: number;
  description: string | null;
  website: string | null;
  github: string | null;
  chain: string | null;
  tokenAddress: string | null;
  profileImageUrl: string | null;
  status: string;
  statusReason: string | null;
  statusChangedAt: string | null;
  lastSeenAt: string | null;
  missedChecks: number;
  lastFetchedAt: string | null;
  /**
   * Net change inside the selected window, summed from the
   * `ProjectChange` log (every metric move in the window contributes its
   * new−old delta). Always a number; `0` means no movement in the window.
   */
  followersDelta: number;
  followingDelta: number;
  tweetsDelta: number;
  changes: GrowthChange[];
  tweetsInWindow: number;
  latestTweet: GrowthLatestTweet | null;
};

export type GrowthRange = "1h" | "12h" | "24h" | "7d" | "all";

export type GrowthResponse = {
  range: GrowthRange;
  /** Lower bound of the window. `undefined` when `range = "all"`. */
  since: string | undefined;
  generatedAt: string;
  count: number;
  users: GrowthUser[];
};

export async function fetchGrowth(params: {
  range?: GrowthRange;
  sortBy?: "userId" | "growth";
  sortOrder?: "asc" | "desc";
  userId?: string;
}) {
  const q = new URLSearchParams();
  if (params.range) q.set("range", params.range);
  if (params.sortBy) q.set("sortBy", params.sortBy);
  if (params.sortOrder) q.set("sortOrder", params.sortOrder);
  if (params.userId) q.set("userId", params.userId);
  return request<GrowthResponse>(`/growth?${q.toString()}`);
}
