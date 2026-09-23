import { CircuitBreaker } from "../twitter/circuit-breaker.js";

export type CircuitSkipped = { skipped: true; reason: "circuit_open" };

export async function withCircuitBreaker<T>(
  breaker: CircuitBreaker,
  fn: () => Promise<T>,
): Promise<T | CircuitSkipped> {
  if (breaker.getState() === "open") {
    return { skipped: true, reason: "circuit_open" };
  }
  try {
    const result = await fn();
    breaker.recordSuccess();
    return result;
  } catch (err) {
    breaker.recordFailure(err);
    throw err;
  }
}
