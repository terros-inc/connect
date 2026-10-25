// AccuLynx allows 10 requests per second per API key. Keys are created per AccuLynx location, so each key
// gets its own limiter and one busy location never slows down another.
export const requestsPerSecond = 10
const windowMs = 1000

export type Clock = {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export class RateLimiter {
  private readonly sent: number[] = []
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly limit: number = requestsPerSecond,
    private readonly clock: Clock = systemClock
  ) {}

  // Resolves when one more request fits in the sliding one-second window. Callers are served in order.
  acquire(): Promise<void> {
    const turn = this.queue.then(() => this.waitForSlot())
    this.queue = turn.catch(() => undefined)
    return turn
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = this.clock.now()
      while (this.sent.length && this.sent[0]! <= now - windowMs) this.sent.shift()

      if (this.sent.length < this.limit) {
        this.sent.push(now)
        return
      }

      await this.clock.sleep(this.sent[0]! + windowMs - now)
    }
  }
}

const limiters = new Map<string, RateLimiter>()

// Limiters live for the lifetime of the runtime, so calls made by later runs in the same runtime share them.
export function limiterForKey(apiKey: string): RateLimiter {
  let limiter = limiters.get(apiKey)
  if (!limiter) {
    limiter = new RateLimiter()
    limiters.set(apiKey, limiter)
  }
  return limiter
}
