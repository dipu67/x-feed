/**
 * HTTP client for FxTwitter API v2 (X/Twitter).
 * @see https://docs.fxembed.com/api/twitter/
 */
import type {
  ConversationAPIResponse,
  ConversationQueryOptions,
  CursorPageOptions,
  FxTwitterClientOptions,
  GroupedStatusListAPIResponse,
  ProfileAboutAPIResponse,
  ProfileQueryOptions,
  ProfileStatusesOptions,
  ProfileTimelineOptions,
  SearchOptions,
  StatusAPIResponse,
  StatusListAPIResponse,
  StatusQueryOptions,
  ThreadAPIResponse,
  TrendsOptions,
  APITrendsResponse,
  APITypeaheadResponse,
  TypeaheadOptions,
  UserAPIResponse,
  UserListAPIResponse,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.fxtwitter.com';

export class FxTwitterError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown, code?: number) {
    super(message);
    this.name = 'FxTwitterError';
    this.status = status;
    this.body = body;
    if (code !== undefined) this.code = code;
  }
}

function truthyFlag(value: boolean | undefined): string | undefined {
  return value ? '1' : undefined;
}

function appendQuery(
  params: URLSearchParams,
  entries: Record<string, string | number | boolean | undefined | null>
): void {
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'boolean') {
      if (value) params.set(key, '1');
      continue;
    }
    params.set(key, String(value));
  }
}

export class FxTwitterClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number | undefined;

  constructor(options: FxTwitterClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = { Accept: 'application/json', ...options.headers };
    this.timeoutMs = options.timeoutMs;
  }

  // ── Status ───────────────────────────────────────────────────────────────

  /** `GET /2/status/{id}` — single post by snowflake ID. */
  getStatus(id: string, options: StatusQueryOptions = {}): Promise<StatusAPIResponse> {
    return this.requestJson<StatusAPIResponse>(`/2/status/${encodeURIComponent(id)}`, {
      about_account: truthyFlag(options.aboutAccount),
      lang: options.lang
    });
  }

  /** `GET /2/status/{id}/reposts` — users who reposted the post. */
  getStatusReposts(
    id: string,
    options: CursorPageOptions = {}
  ): Promise<UserListAPIResponse> {
    return this.requestJson<UserListAPIResponse>(
      `/2/status/${encodeURIComponent(id)}/reposts`,
      {
        count: options.count,
        cursor: options.cursor
      }
    );
  }

  /** `GET /2/status/{id}/quotes` — quote posts of the status. */
  getStatusQuotes(
    id: string,
    options: CursorPageOptions & { lang?: string } = {}
  ): Promise<StatusListAPIResponse> {
    return this.requestJson<StatusListAPIResponse>(
      `/2/status/${encodeURIComponent(id)}/quotes`,
      {
        count: options.count,
        cursor: options.cursor,
        lang: options.lang
      }
    );
  }

  // ── Thread / conversation ────────────────────────────────────────────────

  /** `GET /2/thread/{id}` — unrolled author thread for a post. */
  getThread(id: string, options: StatusQueryOptions = {}): Promise<ThreadAPIResponse> {
    return this.requestJson<ThreadAPIResponse>(`/2/thread/${encodeURIComponent(id)}`, {
      about_account: truthyFlag(options.aboutAccount),
      lang: options.lang
    });
  }

  /**
   * `GET /2/conversation/{id}` — post, ancestor chain, and ranked replies.
   * Paginate replies with `cursor` from the prior response (`cursor.bottom`).
   */
  getConversation(
    id: string,
    options: ConversationQueryOptions = {}
  ): Promise<ConversationAPIResponse> {
    return this.requestJson<ConversationAPIResponse>(
      `/2/conversation/${encodeURIComponent(id)}`,
      {
        ranking_mode: options.rankingMode,
        cursor: options.cursor,
        about_account: truthyFlag(options.aboutAccount),
        lang: options.lang
      }
    );
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  /**
   * `GET /2/profile/{handle}` — user profile.
   * `handle` is username without @, or `id:<rest_id>`.
   */
  getProfile(handle: string, options: ProfileQueryOptions = {}): Promise<UserAPIResponse> {
    return this.requestJson<UserAPIResponse>(
      `/2/profile/${encodeURIComponent(handle)}`,
      {
        about_account: truthyFlag(options.aboutAccount)
      }
    );
  }

  /** `GET /2/profile/{handle}/about` — “About this account” metadata only. */
  getProfileAbout(handle: string): Promise<ProfileAboutAPIResponse> {
    return this.requestJson<ProfileAboutAPIResponse>(
      `/2/profile/${encodeURIComponent(handle)}/about`
    );
  }

  /**
   * `GET /2/profile/{handle}/statuses` — user timeline.
   * With `since` and no `cursor`, may return `null` on HTTP 204 (nothing newer).
   * With `groupThreads: true`, results are mixed status/thread entries.
   */
  getProfileStatuses(
    handle: string,
    options: ProfileStatusesOptions & { groupThreads: true }
  ): Promise<GroupedStatusListAPIResponse | null>;
  getProfileStatuses(
    handle: string,
    options?: ProfileStatusesOptions
  ): Promise<StatusListAPIResponse | null>;
  getProfileStatuses(
    handle: string,
    options: ProfileStatusesOptions = {}
  ): Promise<StatusListAPIResponse | GroupedStatusListAPIResponse | null> {
    return this.requestJsonAllow204(`/2/profile/${encodeURIComponent(handle)}/statuses`, {
      count: options.count,
      cursor: options.cursor,
      since: options.since,
      with_replies: truthyFlag(options.withReplies),
      groupthreads: truthyFlag(options.groupThreads),
      lang: options.lang
    });
  }

  /** `GET /2/profile/{handle}/articles` — user article posts. */
  getProfileArticles(
    handle: string,
    options: ProfileTimelineOptions = {}
  ): Promise<StatusListAPIResponse> {
    return this.requestJson<StatusListAPIResponse>(
      `/2/profile/${encodeURIComponent(handle)}/articles`,
      {
        count: options.count,
        cursor: options.cursor,
        lang: options.lang
      }
    );
  }

  /** `GET /2/profile/{handle}/media` — user media posts. */
  getProfileMedia(
    handle: string,
    options: ProfileTimelineOptions = {}
  ): Promise<StatusListAPIResponse> {
    return this.requestJson<StatusListAPIResponse>(
      `/2/profile/${encodeURIComponent(handle)}/media`,
      {
        count: options.count,
        cursor: options.cursor,
        lang: options.lang
      }
    );
  }

  /** `GET /2/profile/{handle}/followers` */
  getProfileFollowers(
    handle: string,
    options: CursorPageOptions = {}
  ): Promise<UserListAPIResponse> {
    return this.requestJson<UserListAPIResponse>(
      `/2/profile/${encodeURIComponent(handle)}/followers`,
      {
        count: options.count,
        cursor: options.cursor
      }
    );
  }

  /** `GET /2/profile/{handle}/following` */
  getProfileFollowing(
    handle: string,
    options: CursorPageOptions = {}
  ): Promise<UserListAPIResponse> {
    return this.requestJson<UserListAPIResponse>(
      `/2/profile/${encodeURIComponent(handle)}/following`,
      {
        count: options.count,
        cursor: options.cursor
      }
    );
  }

  // ── Search / explore ─────────────────────────────────────────────────────

  /** `GET /2/search` — search posts (`feed`: latest | top | media). */
  search(options: SearchOptions): Promise<StatusListAPIResponse> {
    return this.requestJson<StatusListAPIResponse>('/2/search', {
      q: options.q,
      feed: options.feed,
      count: options.count,
      cursor: options.cursor,
      lang: options.lang
    });
  }

  /** `GET /2/typeahead` — autocomplete users / topics / events. */
  typeahead(options: TypeaheadOptions): Promise<APITypeaheadResponse> {
    return this.requestJson<APITypeaheadResponse>('/2/typeahead', {
      q: options.q,
      result_type: options.resultType,
      src: options.src
    });
  }

  /** `GET /2/trends` — trending topics. */
  trends(options: TrendsOptions = {}): Promise<APITrendsResponse> {
    return this.requestJson<APITrendsResponse>('/2/trends', {
      type: options.type,
      count: options.count
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>
  ): string {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`);
    if (query) appendQuery(url.searchParams, query);
    return url.toString();
  }

  private async requestJson<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>
  ): Promise<T> {
    const result = await this.requestJsonAllow204<T>(path, query);
    if (result === null) {
      throw new FxTwitterError('Unexpected empty response (204)', 204, null);
    }
    return result;
  }

  /**
   * Like {@link requestJson}, but returns `null` on HTTP 204
   * (e.g. profile statuses with `since` and nothing newer).
   */
  private async requestJsonAllow204<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>
  ): Promise<T | null> {
    const url = this.buildUrl(path, query);
    const controller = this.timeoutMs !== undefined ? new AbortController() : undefined;
    const timer =
      controller && this.timeoutMs !== undefined
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined;

    try {
      const init: RequestInit = {
        method: 'GET',
        headers: this.defaultHeaders
      };
      if (controller) init.signal = controller.signal;

      const res = await this.fetchImpl(url, init);

      if (res.status === 204) return null;

      const text = await res.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = text;
        }
      }

      if (!res.ok) {
        const code =
          body &&
          typeof body === 'object' &&
          body !== null &&
          'code' in body &&
          typeof (body as { code: unknown }).code === 'number'
            ? (body as { code: number }).code
            : undefined;
        const message =
          body &&
          typeof body === 'object' &&
          body !== null &&
          'message' in body &&
          typeof (body as { message: unknown }).message === 'string'
            ? (body as { message: string }).message
            : `FxTwitter HTTP ${res.status}`;
        throw new FxTwitterError(message, res.status, body, code);
      }

      return body as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}