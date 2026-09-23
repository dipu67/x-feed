import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "../twitter/circuit-breaker.js";

describe("circuit breaker isolation (Review Focus #5)", () => {
  it("a failing account does not trip a healthy one", async () => {
    const good = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    const bad = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });

    const callFetcher = async (
      fetcher: () => Promise<unknown>,
      cb: CircuitBreaker,
    ): Promise<unknown> => {
      try {
        const result = await fetcher();
        cb.recordSuccess();
        return result;
      } catch (err) {
        cb.recordFailure(err);
        throw err;
      }
    };

    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("429"))
      .mockRejectedValueOnce(new Error("429"))
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValueOnce("ok");

    // bad account trips after 3 failures
    for (let i = 0; i < 3; i++) {
      await expect(callFetcher(fetcher, bad)).rejects.toThrow();
    }
    expect(bad.getState()).toBe("open");

    // good account never fails
    for (let i = 0; i < 5; i++) {
      await expect(callFetcher(async () => "ok", good)).resolves.toBe("ok");
    }
    expect(good.getState()).toBe("closed");
  });
});
