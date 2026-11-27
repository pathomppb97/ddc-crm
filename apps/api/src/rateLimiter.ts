export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/** In-memory sliding-window rate limiter (Edge isolate / single-process guard). */
export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  check(
    key: string,
    limit: number,
    windowMs = 60_000,
    nowMs = Date.now(),
  ): RateLimitDecision {
    const cutoff = nowMs - windowMs;
    const recent = (this.buckets.get(key) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= limit) {
      const oldest = recent[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + windowMs - nowMs) / 1000),
      );
      this.buckets.set(key, recent);
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    recent.push(nowMs);
    this.buckets.set(key, recent);
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - recent.length),
      retryAfterSeconds: 0,
    };
  }
}
