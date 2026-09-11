// src/providers/circuit-breaker.ts — Generic circuit breaker for async functions

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  recoveryTimeout: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  recoveryTimeout: 30000,
};

export class CircuitBreaker<T> {
  private state: CircuitBreakerState = 'closed';
  private failureCount = 0;
  private openedAt: number | null = null;
  // Set only by trip(). A normal failure-threshold open re-arms after
  // options.recoveryTimeout; an explicit trip re-arms after its own finite
  // latch instead, which is deliberately independent of recoveryTimeout —
  // see trip()'s doc comment.
  private tripLatchUntil: number | null = null;
  private readonly options: CircuitBreakerOptions;

  constructor(
    private readonly fn: (...args: unknown[]) => Promise<T>,
    options?: Partial<CircuitBreakerOptions>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  getState(): CircuitBreakerState {
    this.checkRecovery();
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Open the circuit immediately, independent of failureCount/failureThreshold,
   * and re-arm to half-open after exactly `latchMs` — not `recoveryTimeout`,
   * and not "until restart". Callers use this for failures that are known-bad
   * rather than merely repeated (e.g. a refused API credential): the normal
   * threshold-based open is a guess that the provider is unwell; trip() is a
   * certainty that this exact cause will not clear on its own before `latchMs`
   * has passed. A latch that never re-armed would turn a transient cause
   * (credential rotated, quota reset) into a permanently dead provider.
   */
  trip(latchMs: number): void {
    this.state = 'open';
    this.openedAt = Date.now();
    this.tripLatchUntil = Date.now() + latchMs;
  }

  async execute(...args: unknown[]): Promise<T> {
    this.checkRecovery();

    if (this.state === 'open') {
      throw new Error('Circuit breaker is open');
    }

    try {
      const result = await this.fn(...args);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private checkRecovery(): void {
    if (this.state !== 'open') return;

    if (this.tripLatchUntil !== null) {
      if (Date.now() >= this.tripLatchUntil) {
        this.state = 'half-open';
        this.tripLatchUntil = null;
      }
      return;
    }

    if (this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.options.recoveryTimeout) {
        this.state = 'half-open';
      }
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.openedAt = null;
    this.tripLatchUntil = null;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failureCount += 1;
    if (this.state === 'half-open' || this.failureCount >= this.options.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
}
