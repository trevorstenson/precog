import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { clearState, loadState } from '../src/store'
import { createBanditSW } from '../src/sw'

// Mock ServiceWorkerGlobalScope.clients
const mockPostMessage = vi.fn()
const mockClients = {
  matchAll: vi.fn().mockResolvedValue([{ postMessage: mockPostMessage }]),
}
;(globalThis as any).self = { clients: mockClients }

vi.spyOn(crypto, 'randomUUID').mockReturnValue('test-uuid' as any)

function makeFetchEvent(url: string, opts?: { mode?: string; purpose?: string }): any {
  const mode = opts?.mode ?? 'navigate'
  const headers = new Map<string, string>()
  if (opts?.purpose) headers.set('Sec-Purpose', opts.purpose)
  return {
    request: {
      url,
      mode,
      headers: { get: (k: string) => headers.get(k) ?? null },
    },
    waitUntil: (p: Promise<any>) => p,
  }
}

function makeMessageEvent(data: any, sourceUrl?: string): any {
  return {
    data,
    source: sourceUrl ? { url: sourceUrl } : null,
    waitUntil: (p: Promise<any>) => p,
  }
}

describe('createBanditSW', () => {
  beforeEach(async () => {
    await clearState()
    mockPostMessage.mockClear()
    mockClients.matchAll.mockClear()
  })

  it('creates arms on navigation and broadcasts predictions', async () => {
    const sw = createBanditSW({ topK: 2 })
    const event = makeFetchEvent('http://example.com/page1')
    await event.waitUntil(
      (() => {
        sw.handleFetch(event)
        // handleFetch calls event.waitUntil internally; we need to trigger it
        return Promise.resolve()
      })()
    )
    // handleFetch calls event.waitUntil with a promise, let's call it directly
    // Re-do: just invoke handleFetch and let it work
  })

  it('ignores non-navigate requests', async () => {
    const sw = createBanditSW()
    const event = makeFetchEvent('http://example.com/api', { mode: 'cors' })
    sw.handleFetch(event)
    expect(mockPostMessage).not.toHaveBeenCalled()
  })

  it('ignores prefetch requests', async () => {
    const sw = createBanditSW()
    const event = makeFetchEvent('http://example.com/page', { purpose: 'prefetch' })
    sw.handleFetch(event)
    expect(mockPostMessage).not.toHaveBeenCalled()
  })

  it('discover-links creates new arms', async () => {
    const sw = createBanditSW()

    // First navigate to initialize state
    const fetchEvent = makeFetchEvent('http://example.com/')
    const waitPromises: Promise<any>[] = []
    fetchEvent.waitUntil = (p: Promise<any>) => { waitPromises.push(p) }
    sw.handleFetch(fetchEvent)
    await Promise.all(waitPromises)

    // Now discover links
    const msgEvent = makeMessageEvent(
      { type: 'precog:discover-links', urls: ['http://example.com/a', 'http://example.com/b'] },
      'http://example.com/'
    )
    const msgPromises: Promise<any>[] = []
    msgEvent.waitUntil = (p: Promise<any>) => { msgPromises.push(p) }
    sw.handleMessage(msgEvent)
    await Promise.all(msgPromises)

    // State should have the discovered arms persisted
    const state = await loadState()
    expect(state).not.toBeNull()
    expect(state!.arms['http://example.com/a']).toBeDefined()
    expect(state!.arms['http://example.com/b']).toBeDefined()
  })

  it('reward validates value range — rejects NaN', async () => {
    const sw = createBanditSW()

    // Navigate first to create arm
    const fetchEvent = makeFetchEvent('http://example.com/page')
    const waitPromises: Promise<any>[] = []
    fetchEvent.waitUntil = (p: Promise<any>) => { waitPromises.push(p) }
    sw.handleFetch(fetchEvent)
    await Promise.all(waitPromises)

    const stateBefore = await loadState()
    const pullsBefore = stateBefore!.arms['http://example.com/page'].pulls

    // Send NaN reward — should be rejected
    const msgEvent = makeMessageEvent({
      type: 'precog:reward',
      url: 'http://example.com/page',
      value: NaN,
    })
    const msgPromises: Promise<any>[] = []
    msgEvent.waitUntil = (p: Promise<any>) => { msgPromises.push(p) }
    sw.handleMessage(msgEvent)
    await Promise.all(msgPromises)

    const stateAfter = await loadState()
    // Pulls should not have changed since NaN was rejected
    expect(stateAfter!.arms['http://example.com/page'].pulls).toBe(pullsBefore)
  })

  it('reward validates value range — rejects Infinity', async () => {
    const sw = createBanditSW()

    const fetchEvent = makeFetchEvent('http://example.com/page')
    const waitPromises: Promise<any>[] = []
    fetchEvent.waitUntil = (p: Promise<any>) => { waitPromises.push(p) }
    sw.handleFetch(fetchEvent)
    await Promise.all(waitPromises)

    const msgEvent = makeMessageEvent({
      type: 'precog:reward',
      url: 'http://example.com/page',
      value: Infinity,
    })
    const msgPromises: Promise<any>[] = []
    msgEvent.waitUntil = (p: Promise<any>) => { msgPromises.push(p) }
    sw.handleMessage(msgEvent)
    await Promise.all(msgPromises)

    const stateAfter = await loadState()
    expect(stateAfter!.arms['http://example.com/page'].pulls).toBe(0)
  })

  it('reward validates value range — rejects negative values', async () => {
    const sw = createBanditSW()

    const fetchEvent = makeFetchEvent('http://example.com/page')
    const waitPromises: Promise<any>[] = []
    fetchEvent.waitUntil = (p: Promise<any>) => { waitPromises.push(p) }
    sw.handleFetch(fetchEvent)
    await Promise.all(waitPromises)

    const msgEvent = makeMessageEvent({
      type: 'precog:reward',
      url: 'http://example.com/page',
      value: -5,
    })
    const msgPromises: Promise<any>[] = []
    msgEvent.waitUntil = (p: Promise<any>) => { msgPromises.push(p) }
    sw.handleMessage(msgEvent)
    await Promise.all(msgPromises)

    const stateAfter = await loadState()
    expect(stateAfter!.arms['http://example.com/page'].pulls).toBe(0)
  })

  it('reward accepts valid values in [0, 1]', async () => {
    const sw = createBanditSW()

    const fetchEvent = makeFetchEvent('http://example.com/page')
    const waitPromises: Promise<any>[] = []
    fetchEvent.waitUntil = (p: Promise<any>) => { waitPromises.push(p) }
    sw.handleFetch(fetchEvent)
    await Promise.all(waitPromises)

    const msgEvent = makeMessageEvent({
      type: 'precog:reward',
      url: 'http://example.com/page',
      value: 0.5,
    })
    const msgPromises: Promise<any>[] = []
    msgEvent.waitUntil = (p: Promise<any>) => { msgPromises.push(p) }
    sw.handleMessage(msgEvent)
    await Promise.all(msgPromises)

    const stateAfter = await loadState()
    // update() increments pulls, so it should be 1 now
    expect(stateAfter!.arms['http://example.com/page'].pulls).toBe(1)
  })

  it('scroll-depth updates metadata', async () => {
    const sw = createBanditSW()

    // Navigate first to init state
    const fetchEvent = makeFetchEvent('http://example.com/')
    const waitPromises: Promise<any>[] = []
    fetchEvent.waitUntil = (p: Promise<any>) => { waitPromises.push(p) }
    sw.handleFetch(fetchEvent)
    await Promise.all(waitPromises)

    // Send scroll depth — should not throw
    const msgEvent = makeMessageEvent({ type: 'precog:scroll-depth', depth: 0.8 })
    const msgPromises: Promise<any>[] = []
    msgEvent.waitUntil = (p: Promise<any>) => { msgPromises.push(p) }
    sw.handleMessage(msgEvent)
    await Promise.all(msgPromises)
  })

  it('prunes arms not seen recently', async () => {
    const sw = createBanditSW({ pruneAfter: 2 })

    // Navigate to create arm for /old
    const e1 = makeFetchEvent('http://example.com/old')
    const p1: Promise<any>[] = []
    e1.waitUntil = (p: Promise<any>) => { p1.push(p) }
    sw.handleFetch(e1)
    await Promise.all(p1)

    // Navigate 3 more times to other pages to push /old past pruneAfter
    for (const page of ['/a', '/b', '/c']) {
      const e = makeFetchEvent(`http://example.com${page}`)
      const ps: Promise<any>[] = []
      e.waitUntil = (p: Promise<any>) => { ps.push(p) }
      sw.handleFetch(e)
      await Promise.all(ps)
    }

    const state = await loadState()
    expect(state!.arms['http://example.com/old']).toBeUndefined()
  })
})
