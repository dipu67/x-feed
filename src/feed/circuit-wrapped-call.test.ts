import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "../twitter/circuit-breaker.js";
import { withCircuitBreaker } from "./circuit-wrapped-call.js";

describe("withCircuitBreaker (read-path integration)", () => {
  it("returns { skipped: true } when breaker is open", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    breaker.recordFailure(new Error("429"));
    expect(breaker.getState()).toBe("open");

    const result = await withCircuitBreaker(breaker, async () => "ok");
    expect(result).toEqual({ skipped: true, reason: "circuit_open" });
  });

  it("records success on a successful call", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
    const result = await withCircuitBreaker(breaker, async () => "ok");
    expect(result).toEqual("ok");
    expect(breaker.getState()).toBe("closed");
  });

  it("records failure and rethrows when the call rejects", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
    const failing = vi.fn().mockRejectedValue(new Error("429"));
    await expect(withCircuitBreaker(breaker, failing)).rejects.toThrow("429");
    expect(breaker.getState()).toBe("closed");
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("trips the breaker after the configured threshold", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
    const failing = vi.fn().mockRejectedValue(new Error("429"));
    for (let i = 0; i < 3; i++) {
      await expect(withCircuitBreaker(breaker, failing)).rejects.toThrow();
    }
    expect(breaker.getState()).toBe("open");
  });
});
