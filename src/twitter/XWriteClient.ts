import { CircuitBreaker } from "./circuit-breaker.js";

export type XAuthTokenInput = { authToken: string; ct0: string; username: string };

export type WriteResult =
  | { ok: true; tweetId: string; url: string }
  | {
      ok: false;
      error: "rate_limited" | "auth_invalid" | "network" | "unknown";
      retryAfterMs?: number;
      message: string;
    };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const GRAPHQL_POST = "https://x.com/i/api/graphql/xc8f1g7BYqr6VTzTbvNlGw/CreateTweet";
const GRAPHQL_LIKE = "https://x.com/i/api/graphql/lI07N6OggvJTwH1iQ7M_qA/favoriteTweet";
const GRAPHQL_RETWEET = "https://x.com/i/api/graphql/ojPOGdwB5dKnM7wy3wM7nQ/CreateRetweet";

export class XWriteClient {
  private readonly breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 15 * 60 * 1000 });
  private readonly fetcher: Fetcher;

  constructor(private readonly token: XAuthTokenInput, opts: { fetcher?: Fetcher } = {}) {
    this.fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  }

  getCircuitState() {
    return this.breaker.getState();
  }

  async post(text: string, replyToTweetId?: string): Promise<WriteResult> {
    return this.runMutation(GRAPHQL_POST, {
      variables: {
        tweet_text: text,
        ...(replyToTweetId ? { reply: { in_reply_to_tweet_id: replyToTweetId } } : {}),
      },
      features: {},
    });
  }

  async reply(tweetId: string, text: string): Promise<WriteResult> {
    return this.post(text, tweetId);
  }

  async like(tweetId: string): Promise<WriteResult> {
    return this.runMutation(GRAPHQL_LIKE, { variables: { tweet_id: tweetId } });
  }

  async retweet(tweetId: string): Promise<WriteResult> {
    return this.runMutation(GRAPHQL_RETWEET, { variables: { tweet_id: tweetId, dark_request: false } });
  }

  private async runMutation(url: string, body: unknown): Promise<WriteResult> {
    if (this.breaker.getState() === "open") {
      return { ok: false, error: "rate_limited", message: "circuit open" };
    }
    try {
      const res = await this.fetcher(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (res.status === 200 || res.status === 201) {
        const json = (await res.json()) as {
          data?: { create_tweet?: { tweet_results?: { result?: { rest_id?: string } } } };
        };
        const id =
          json.data?.create_tweet?.tweet_results?.result?.rest_id ??
          (() => {
            const alt = json as Record<string, unknown>;
            for (const v of Object.values(alt)) {
              if (v && typeof v === "object" && "rest_id" in (v as object)) {
                return (v as { rest_id?: string }).rest_id;
              }
            }
            return undefined;
          })();
        if (!id) {
          this.breaker.recordFailure(new Error("no tweet id in response"));
          return { ok: false, error: "unknown", message: "no tweet id in response" };
        }
        this.breaker.recordSuccess();
        return { ok: true, tweetId: id, url: `https://x.com/i/status/${id}` };
      }
      if (res.status === 429) {
        const j = (await res.json().catch(() => ({}))) as { retry_after_ms?: number };
        this.breaker.recordFailure(new Error("429"));
        const retryAfterMs =
          typeof j.retry_after_ms === "number" ? j.retry_after_ms : undefined;
        return {
          ok: false,
          error: "rate_limited",
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          message: "rate limited",
        };
      }
      if (res.status === 401 || res.status === 403) {
        // Auth failures are a token problem, not a service-rate problem —
        // don't pollute the breaker counter; the operator will re-link the
        // account and writes should resume immediately on the new token.
        return { ok: false, error: "auth_invalid", message: `auth failed: ${res.status}` };
      }
      this.breaker.recordFailure(new Error(String(res.status)));
      return { ok: false, error: "unknown", message: `unexpected status ${res.status}` };
    } catch (err) {
      this.breaker.recordFailure(err);
      return { ok: false, error: "network", message: (err as Error).message };
    }
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token.authToken}`,
      "x-csrf-token": this.token.ct0,
      "content-type": "application/json",
      cookie: `auth_token=${this.token.authToken}; ct0=${this.token.ct0}`,
    };
  }
}
