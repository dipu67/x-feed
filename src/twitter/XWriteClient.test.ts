import { describe, it, expect, vi } from "vitest";
import { XWriteClient } from "./XWriteClient.js";

describe("XWriteClient", () => {
  it("maps a 429 to a rate_limited result and does not yet trip the breaker", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ status: 429, json: async () => ({ retry_after_ms: 1000 }) });
    const client = new XWriteClient(
      { authToken: "x", ct0: "y", username: "u" },
      { fetcher: fakeFetch },
    );
    const res = await client.like("123");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("rate_limited");
      expect(res.retryAfterMs).toBe(1000);
    }
    expect(client.getCircuitState()).toBe("closed"); // 1 failure, threshold is 3
  });

  it("maps a 401 to auth_invalid", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ status: 401, json: async () => ({}) });
    const client = new XWriteClient(
      { authToken: "x", ct0: "y", username: "u" },
      { fetcher: fakeFetch },
    );
    const res = await client.post("hi");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("auth_invalid");
  });

  it("does not count 401/403 toward the breaker threshold", async () => {
    // Auth failures are a token problem, not a service-rate problem — they
    // shouldn't pollute the breaker state. After N auth errors the breaker
    // must still be closed (operator will re-link the account, then writes
    // can resume immediately).
    const fakeFetch = vi.fn().mockResolvedValue({ status: 401, json: async () => ({}) });
    const client = new XWriteClient(
      { authToken: "x", ct0: "y", username: "u" },
      { fetcher: fakeFetch },
    );
    for (let i = 0; i < 10; i++) {
      const res = await client.post(`try-${i}`);
      expect(res.ok).toBe(false);
    }
    expect(client.getCircuitState()).toBe("closed");
  });

  it("returns ok=true on a 200 with a tweet id", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ data: { create_tweet: { tweet_results: { result: { rest_id: "999" } } } } }),
    });
    const client = new XWriteClient(
      { authToken: "x", ct0: "y", username: "u" },
      { fetcher: fakeFetch },
    );
    const res = await client.post("hi");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tweetId).toBe("999");
      expect(res.url).toContain("999");
    }
  });

  it("two XWriteClients with different tokens have isolated breakers (Review Focus #5)", async () => {
    const failingFetch = vi.fn().mockResolvedValue({
      status: 429,
      json: async () => ({ retry_after_ms: 1000 }),
    });
    const goodFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ data: { create_tweet: { tweet_results: { result: { rest_id: "1" } } } } }),
    });
    const bad = new XWriteClient(
      { authToken: "x", ct0: "y", username: "bad" },
      { fetcher: failingFetch },
    );
    const good = new XWriteClient(
      { authToken: "x2", ct0: "y2", username: "good" },
      { fetcher: goodFetch },
    );

    for (let i = 0; i < 3; i++) {
      await bad.like(`t${i}`);
    }
    expect(bad.getCircuitState()).toBe("open");

    expect(good.getCircuitState()).toBe("closed");
    const ok = await good.post("hi");
    expect(ok.ok).toBe(true);
    expect(good.getCircuitState()).toBe("closed");
  });
});
