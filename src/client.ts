import type { Prediction, SWMessage } from './types'
import { insertPrefetchLinks, removePrefetchLinks } from './fallback'

export interface ClientOptions {
  /** Throttle interval (ms) for scroll depth reporting. Default: 1000 */
  scrollThrottleMs?: number
}

/** Detect if the browser supports Speculation Rules API */
function supportsSpeculationRules(): boolean {
  return typeof HTMLScriptElement !== 'undefined' &&
    'supports' in HTMLScriptElement &&
    (HTMLScriptElement as any).supports('speculationrules')
}

/** Insert a <script type="speculationrules"> element */
function insertSpeculationRules(predictions: Prediction[]): void {
  // Remove any existing precog speculation rules
  removeSpeculationRules()

  if (predictions.length === 0) return

  // Group by eagerness
  const groups: Record<string, string[]> = { eager: [], moderate: [], conservative: [] }
  for (const p of predictions) {
    groups[p.eagerness].push(p.url)
  }

  const rules: any[] = []
  for (const [eagerness, urls] of Object.entries(groups)) {
    if (urls.length > 0) {
      rules.push({
        source: 'list',
        urls,
        eagerness,
      })
    }
  }

  const script = document.createElement('script')
  script.type = 'speculationrules'
  script.dataset.precog = 'true'
  script.textContent = JSON.stringify({ prefetch: rules })
  document.head.appendChild(script)
}

function removeSpeculationRules(): void {
  const existing = document.querySelectorAll<HTMLScriptElement>('script[data-precog]')
  for (const el of existing) el.remove()
}

/** Discover same-origin <a> links on the page */
function discoverLinks(): string[] {
  const origin = location.origin
  const urls = new Set<string>()
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]')
  for (const a of anchors) {
    try {
      const url = new URL(a.href, origin)
      if (url.origin === origin && url.pathname !== location.pathname) {
        urls.add(url.href)
      }
    } catch {
      // invalid URL, skip
    }
  }
  return Array.from(urls)
}

/** Send a message to the controlling service worker */
function sendToSW(msg: any): void {
  navigator.serviceWorker.controller?.postMessage(msg)
}

/**
 * Create the main-thread bandit client.
 * Listens for predictions from the SW, inserts speculation rules, discovers links, reports rewards.
 * Returns a cleanup function.
 */
export function createBanditClient(options?: ClientOptions): () => void {
  const { scrollThrottleMs = 1000 } = options ?? {}
  const useSpecRules = supportsSpeculationRules()

  // Handle predictions from SW
  function onMessage(event: MessageEvent) {
    const msg = event.data as SWMessage
    if (msg?.type !== 'precog:predictions') return

    if (useSpecRules) {
      insertSpeculationRules(msg.predictions)
    } else {
      insertPrefetchLinks(msg.predictions.map((p) => p.url))
    }
  }

  navigator.serviceWorker.addEventListener('message', onMessage)

  // Discover links once page is loaded
  function onLoad() {
    const urls = discoverLinks()
    if (urls.length > 0) {
      sendToSW({ type: 'precog:discover-links', urls })
    }
  }

  if (document.readyState === 'complete') {
    onLoad()
  } else {
    window.addEventListener('load', onLoad, { once: true })
  }

  // Track scroll depth (throttled)
  let scrollTimer: ReturnType<typeof setTimeout> | null = null
  function onScroll() {
    if (scrollTimer) return
    scrollTimer = setTimeout(() => {
      scrollTimer = null
      const depth = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight || 1)
      sendToSW({ type: 'precog:scroll-depth', depth: Math.min(1, Math.max(0, depth)) })
    }, scrollThrottleMs)
  }

  window.addEventListener('scroll', onScroll, { passive: true })

  // Cleanup
  return () => {
    navigator.serviceWorker.removeEventListener('message', onMessage)
    window.removeEventListener('load', onLoad)
    window.removeEventListener('scroll', onScroll)
    if (scrollTimer) clearTimeout(scrollTimer)
    if (useSpecRules) {
      removeSpeculationRules()
    } else {
      removePrefetchLinks()
    }
  }
}
