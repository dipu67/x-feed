import { describe, it, expect } from "vitest";
import { CircuitBreaker, nextBackoffMs } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("starts closed", () => {
    expect(new CircuitBreaker().getState()).toBe("closed");
  });

  it("opens after threshold failures", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure(new Error("x"));
    cb.recordFailure(new Error("x"));
    expect(cb.getState()).toBe("closed");
    cb.recordFailure(new Error("x"));
    expect(cb.getState()).toBe("open");
  });

  it("recordSuccess resets the counter", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure(new Error("x"));
    cb.recordFailure(new Error("x"));
    cb.recordSuccess();
    cb.recordFailure(new Error("x"));
    expect(cb.getState()).toBe("closed");
  });

  it("moves to half-open after cooldown", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10 });
    cb.recordFailure(new Error("x"));
    expect(cb.getState()).toBe("open");
    await new Promise((r) => setTimeout(r, 20));
    expect(cb.getState()).toBe("half-open");
  });
});

describe("nextBackoffMs", () => {
  it("grows exponentially with jitter in [-25%, +25%]", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const expectedBase = 1000 * 2 ** attempt;
      for (let i = 0; i < 20; i++) {
        const v = nextBackoffMs(attempt, 1000);
        expect(v).toBeGreaterThanOrEqual(expectedBase * 0.75);
        expect(v).toBeLessThanOrEqual(expectedBase * 1.25);
      }
    }
  });
});
