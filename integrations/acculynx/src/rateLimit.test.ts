import { limiterForKey, RateLimiter } from './rateLimit.ts'
import { fakeAccuLynx, fakeClock } from './fakeAccuLynx.ts'

describe('RateLimiter', () => {
  // Prevents bursting past AccuLynx's 10 requests/second per key, which returns 429s.
  test('lets 10 requests through per second and queues the rest', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter(10, clock)
    const times: number[] = []

    await Promise.all(Array.from({ length: 25 }, () => limiter.acquire().then(() => times.push(clock.now()))))

    expect(times.filter((t) => t === 0)).toHaveLength(10)
    expect(times.filter((t) => t === 1000)).toHaveLength(10)
    expect(times.filter((t) => t === 2000)).toHaveLength(5)
  })

  // Prevents one location's traffic from slowing another location, since each location has its own key.
  test('keeps a separate limit for each API key', () => {
    expect(limiterForKey('location-a')).toBe(limiterForKey('location-a'))
    expect(limiterForKey('location-a')).not.toBe(limiterForKey('location-b'))
  })
})

describe('AccuLynxClient rate-limit replies', () => {
  // Prevents a single 429 from failing a sync, and an endless retry loop from hanging a run.
  test('retries a 429 after Retry-After, then gives up after three attempts', async () => {
    const retried = fakeAccuLynx({
      'POST /contacts': [
        { status: 429, headers: { 'Retry-After': '2' } },
        { status: 201, body: { id: 'contact-1' } },
      ],
    })
    await expect(retried.client.createContact({})).resolves.toEqual({ id: 'contact-1' })
    expect(retried.clock.slept).toContain(2000)

    const limited = fakeAccuLynx({ 'POST /contacts': { status: 429 } })
    await expect(limited.client.createContact({})).rejects.toThrow('429')
    expect(limited.calls).toHaveLength(3)
  })
})
