export type CircuitState = "closed" | "open" | "half-open";

export type CircuitBreakerOpts = {
  failureThreshold?: number;
  cooldownMs?: number;
};

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private failures = 0;
  private openedAt = 0;

  constructor(opts: CircuitBreakerOpts = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 15 * 60 * 1000;
  }

  recordSuccess(): void {
    this.failures = 0;
    if (this.openedAt) this.openedAt = 0;
  }

  recordFailure(_err: unknown): void {
    void _err;
    this.failures += 1;
    if (this.failures >= this.failureThreshold && !this.openedAt) {
      this.openedAt = Date.now();
    }
  }

  getState(): CircuitState {
    if (!this.openedAt) return "closed";
    if (Date.now() - this.openedAt >= this.cooldownMs) return "half-open";
    return "open";
  }

  tryHalfOpenSuccess(): void {
    this.openedAt = 0;
    this.failures = 0;
  }
}

export function nextBackoffMs(attempt: number, baseMs = 1000): number {
  const exp = baseMs * 2 ** Math.min(attempt, 6);
  const jitter = (Math.random() * 0.5 - 0.25) * exp; // ±25%
  return Math.round(exp + jitter);
}
