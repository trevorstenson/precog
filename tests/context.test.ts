import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildContext, type ContextMetadata } from '../src/context'

describe('buildContext', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a vector of length 8', () => {
    const ctx = buildContext('http://localhost/about')
    expect(ctx).toHaveLength(8)
  })

  it('all values are in [0, 1]', () => {
    const meta: ContextMetadata = {
      scrollDepth: 0.5,
      sessionDepth: 10,
      visitedUrls: new Set(['http://localhost/about']),
      lastNavTime: Date.now() - 5000,
    }
    const ctx = buildContext('http://localhost/about', meta)
    for (const v of ctx) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('same URL produces same route hash', () => {
    const ctx1 = buildContext('http://localhost/page')
    const ctx2 = buildContext('http://localhost/page')
    expect(ctx1[0]).toBe(ctx2[0])
  })

  it('different URLs produce different route hashes', () => {
    const ctx1 = buildContext('http://localhost/page-a')
    const ctx2 = buildContext('http://localhost/page-b')
    expect(ctx1[0]).not.toBe(ctx2[0])
  })

  it('sessionDepth is capped at 20 and normalized', () => {
    const ctx = buildContext('http://localhost/', { sessionDepth: 100 })
    expect(ctx[2]).toBe(1) // 100 capped to 20, 20/20 = 1
  })

  it('sessionDepth 0 gives 0', () => {
    const ctx = buildContext('http://localhost/', { sessionDepth: 0 })
    expect(ctx[2]).toBe(0)
  })

  it('isReturn is 1 when URL is in visitedUrls', () => {
    const url = 'http://localhost/visited'
    const ctx = buildContext(url, { visitedUrls: new Set([url]) })
    expect(ctx[4]).toBe(1)
  })

  it('isReturn is 0 when URL is not in visitedUrls', () => {
    const ctx = buildContext('http://localhost/new', { visitedUrls: new Set() })
    expect(ctx[4]).toBe(0)
  })

  it('timeSinceLastNav defaults to 0.5 when no lastNavTime', () => {
    const ctx = buildContext('http://localhost/')
    expect(ctx[5]).toBe(0.5)
  })

  it('timeSinceLastNav is capped at 1 for very old navigations', () => {
    const ctx = buildContext('http://localhost/', {
      lastNavTime: Date.now() - 600_000, // 10 minutes ago, well past 300s cap
    })
    expect(ctx[5]).toBe(1)
  })

  it('scrollDepth is passed through from metadata', () => {
    const ctx = buildContext('http://localhost/', { scrollDepth: 0.75 })
    expect(ctx[6]).toBe(0.75)
  })

  it('scrollDepth defaults to 0 when not provided', () => {
    const ctx = buildContext('http://localhost/')
    expect(ctx[6]).toBe(0)
  })

  it('referrerType is always 0.5 (default)', () => {
    const ctx = buildContext('http://localhost/')
    expect(ctx[7]).toBe(0.5)
  })

  it('hour feature is normalized to [0, 1)', () => {
    const ctx = buildContext('http://localhost/')
    expect(ctx[1]).toBeGreaterThanOrEqual(0)
    expect(ctx[1]).toBeLessThan(1)
  })
})
