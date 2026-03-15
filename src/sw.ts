import type { BanditConfig, BanditState, ClientMessage, Prediction } from './types'
import { createArm, selectTopK, update } from './linucb'
import { buildContext, type ContextMetadata } from './context'
import { loadState, saveState } from './store'

declare const self: ServiceWorkerGlobalScope

const DEFAULTS: BanditConfig = {
  alpha: 1.0,
  discount: 0.95,
  dimensions: 8,
  topK: 3,
  pruneAfter: 50,
}

export function createBanditSW(userConfig?: Partial<BanditConfig>) {
  const config = { ...DEFAULTS, ...userConfig }
  const { dimensions: d, alpha, discount, topK, pruneAfter } = config

  let state: BanditState | null = null
  let lastPredictions: Prediction[] = []
  const meta: ContextMetadata = {
    sessionDepth: 0,
    visitedUrls: new Set(),
    lastNavTime: undefined,
    scrollDepth: 0,
  }

  async function ensureState(): Promise<BanditState> {
    if (!state) {
      state = await loadState()
      if (!state) {
        state = {
          arms: {},
          totalPulls: 0,
          sessionId: crypto.randomUUID(),
        }
      }
      // Restore visitedUrls set from arm keys
      for (const url of Object.keys(state.arms)) {
        meta.visitedUrls!.add(url)
      }
    }
    return state
  }

  function pruneArms(s: BanditState): void {
    for (const url in s.arms) {
      if (s.totalPulls - s.arms[url].lastSeen > pruneAfter) {
        delete s.arms[url]
      }
    }
  }

  async function broadcastPredictions(predictions: Prediction[]): Promise<void> {
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) {
      client.postMessage({ type: 'precog:predictions', predictions })
    }
  }

  function handleFetch(event: FetchEvent): void {
    // Only intercept navigation requests
    if (event.request.mode !== 'navigate') return

    // Skip prefetch requests (don't count them as real navigations)
    const purpose = event.request.headers.get('Sec-Purpose') || event.request.headers.get('Purpose')
    if (purpose === 'prefetch') return

    const url = event.request.url

    event.waitUntil(
      (async () => {
        const s = await ensureState()

        // Record reward for any matching prediction
        for (const pred of lastPredictions) {
          if (pred.url === url) {
            const arm = s.arms[pred.url]
            if (arm) {
              const ctx = buildContext(pred.url, meta)
              update(arm, ctx, 1.0, discount)
            }
            break
          }
        }

        // Update metadata
        meta.sessionDepth = (meta.sessionDepth ?? 0) + 1
        meta.visitedUrls!.add(url)
        meta.lastNavTime = Date.now()
        meta.scrollDepth = 0
        s.totalPulls++

        // Ensure navigated URL is an arm
        if (!s.arms[url]) {
          s.arms[url] = createArm(d)
        }
        s.arms[url].lastSeen = s.totalPulls

        // Prune old arms
        pruneArms(s)

        // Generate predictions
        const ctx = buildContext(url, meta)
        lastPredictions = selectTopK(s.arms, ctx, topK, alpha)

        // Broadcast to clients
        await broadcastPredictions(lastPredictions)

        // Persist
        await saveState(s)
      })()
    )
  }

  function handleMessage(event: ExtendableMessageEvent): void {
    const msg = event.data as ClientMessage
    if (!msg?.type) return

    event.waitUntil(
      (async () => {
        const s = await ensureState()

        switch (msg.type) {
          case 'precog:discover-links': {
            for (const url of msg.urls) {
              if (!s.arms[url]) {
                s.arms[url] = createArm(d)
                s.arms[url].lastSeen = s.totalPulls
              }
            }
            // Re-score with new arms and broadcast
            if (meta.lastNavTime) {
              const ctx = buildContext(
                (event.source as WindowClient | null)?.url ?? '',
                meta
              )
              lastPredictions = selectTopK(s.arms, ctx, topK, alpha)
              await broadcastPredictions(lastPredictions)
            }
            await saveState(s)
            break
          }
          case 'precog:reward': {
            const value = msg.value
            if (!Number.isFinite(value) || value < 0 || value > 1) break
            const arm = s.arms[msg.url]
            if (arm) {
              const ctx = buildContext(msg.url, meta)
              update(arm, ctx, value, discount)
              await saveState(s)
            }
            break
          }
          case 'precog:scroll-depth': {
            meta.scrollDepth = msg.depth
            break
          }
        }
      })()
    )
  }

  return { handleFetch, handleMessage }
}
