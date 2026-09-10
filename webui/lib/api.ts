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
