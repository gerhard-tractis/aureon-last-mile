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
    if (this.state === 'open' && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.options.recoveryTimeout) {
        this.state = 'half-open';
      }
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.openedAt = null;
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
