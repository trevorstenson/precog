// ← Change this import to './ucb1' to switch algorithms
import { strategy } from './thompson'
import { checkBandwidth } from './bandwidth'
import { prefetch, discoverLinks } from './prefetch'

const STORAGE_KEY = 'navbandit'
const SESSION_KEY = 'navbandit:last'
const DEFAULT_TOP_K = 3
const PRUNE_AFTER = 50
const STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

interface StoredEnvelope<T> {
  version: number
  savedAt: number
  data: T
}

interface PageState {
  arms: Record<string, any>
  totalPulls: number
}

interface StandaloneState {
  pages: Record<string, PageState>
  totalNavigations: number
}

interface SessionData {
  fromPath: string
  predictions: string[]
}

/** Detect and migrate v1 UCB1 arm shape { pulls, rewards, lastSeen } → BetaArm */
function migrateArm(arm: any, lastSeen: number): any {
  if (typeof arm.alpha === 'number' && typeof arm.beta === 'number') {
    return arm
  }
  // UCB1 shape: convert rewards/pulls → alpha/beta
  const rewards = typeof arm.rewards === 'number' ? arm.rewards : 0
  const pulls = typeof arm.pulls === 'number' ? arm.pulls : 0
  const failures = pulls - rewards
  return {
    alpha: 1 + Math.max(0, rewards),
    beta: 1 + Math.max(0, failures),
    lastSeen: typeof arm.lastSeen === 'number' ? arm.lastSeen : lastSeen,
  }
}

function isValidArm(arm: unknown): boolean {
  if (typeof arm !== 'object' || arm === null) return false
  const value = arm as any
  // Accept both v2 (BetaArm) and v1 (UCB1 Arm) shapes for migration
  const isBeta =
    typeof value.alpha === 'number' &&
    typeof value.beta === 'number' &&
    typeof value.lastSeen === 'number'
  const isUcb1 =
    typeof value.pulls === 'number' &&
    typeof value.rewards === 'number' &&
    typeof value.lastSeen === 'number'
  return isBeta || isUcb1
}

function isValidPageState(v: unknown): v is PageState {
  if (typeof v !== 'object' || v === null) return false
  const page = v as any
  if (typeof page.totalPulls !== 'number') return false
  if (typeof page.arms !== 'object' || page.arms === null) return false
  return Object.values(page.arms).every(isValidArm)
}

function isValidState(v: unknown): v is StandaloneState {
  if (typeof v !== 'object' || v === null) return false
  const s = v as any
  return (
    typeof s.pages === 'object' &&
    s.pages !== null &&
    typeof s.totalNavigations === 'number' &&
    Object.values(s.pages).every(isValidPageState)
  )
}

function isValidSession(v: unknown): v is SessionData {
  if (typeof v !== 'object' || v === null) return false
  const session = v as any
  return (
    typeof session.fromPath === 'string' &&
    Array.isArray(session.predictions) &&
    session.predictions.every((value: unknown) => typeof value === 'string')
  )
}

function isStoredEnvelope<T>(
  value: unknown,
  validate: (data: unknown) => data is T
): value is StoredEnvelope<T> {
  if (typeof value !== 'object' || value === null) return false
  const stored = value as any
  return (
    typeof stored.version === 'number' &&
    typeof stored.savedAt === 'number' &&
    validate(stored.data)
  )
}

function loadPersisted<T>(
  storage: Storage,
  key: string,
  ttlMs: number,
  validate: (data: unknown) => data is T
): T | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (isStoredEnvelope(parsed, validate)) {
      if (Date.now() - parsed.savedAt > ttlMs) {
        storage.removeItem(key)
        return null
      }
      return parsed.data
    }

    if (validate(parsed)) return parsed
    storage.removeItem(key)
  } catch {
    storage.removeItem(key)
  }
  return null
}

function savePersisted<T>(storage: Storage, key: string, data: T): void {
  storage.setItem(
    key,
    JSON.stringify({
      version: 2,
      savedAt: Date.now(),
      data,
    } satisfies StoredEnvelope<T>)
  )
}

function migrateState(state: StandaloneState): StandaloneState {
  for (const path in state.pages) {
    const page = state.pages[path]
    for (const url in page.arms) {
      page.arms[url] = migrateArm(page.arms[url], state.totalNavigations)
    }
  }
  return state
}

function loadState(): StandaloneState {
  const raw = loadPersisted(localStorage, STORAGE_KEY, STORAGE_TTL_MS, isValidState)
  if (!raw) return { pages: {}, totalNavigations: 0 }
  return migrateState(raw)
}

function saveState(state: StandaloneState): void {
  try {
    savePersisted(localStorage, STORAGE_KEY, state)
  } catch {}
}

function loadSession(): SessionData | null {
  return loadPersisted(sessionStorage, SESSION_KEY, SESSION_TTL_MS, isValidSession)
}

function saveSession(data: SessionData): void {
  try {
    savePersisted(sessionStorage, SESSION_KEY, data)
  } catch {}
}

export function clearStandaloneState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(SESSION_KEY)
  } catch {}
}

function ensurePage(state: StandaloneState, path: string): PageState {
  if (!state.pages[path]) {
    state.pages[path] = { arms: {}, totalPulls: 0 }
  }
  return state.pages[path]
}

function pruneArms(page: PageState, currentNav: number): void {
  for (const url in page.arms) {
    if (currentNav - page.arms[url].lastSeen > PRUNE_AFTER) {
      delete page.arms[url]
    }
  }
}

function currentPath(): string {
  return location.pathname
}

function init(): void {
  const bandwidth = checkBandwidth()
  const state = loadState()
  const path = currentPath()
  state.totalNavigations++

  // Record reward from previous navigation (full-information feedback)
  const session = loadSession()
  if (session && session.predictions.length > 0) {
    const fromPage = state.pages[session.fromPath]
    if (fromPage) {
      const fullUrl = location.origin + path

      // Always reward the actual destination — even if it wasn't predicted
      const destArm = fromPage.arms[fullUrl]
      if (destArm) {
        strategy.reward(destArm)
        fromPage.totalPulls++
      }

      // Penalize predictions that weren't followed
      for (const predUrl of session.predictions) {
        if (predUrl !== fullUrl) {
          const arm = fromPage.arms[predUrl]
          if (arm) {
            strategy.penalize(arm)
            fromPage.totalPulls++
          }
        }
      }
    }
  }

  // Persist reward updates immediately so they survive even if DOM never reaches ready
  saveState(state)

  function run() {
    const urls = discoverLinks({ maxLinks: 100 })
    const page = ensurePage(state, path)

    // Ensure arms exist for all discovered links (weak uniform prior)
    const linkCount = urls.length
    for (const url of urls) {
      if (!page.arms[url]) {
        page.arms[url] = strategy.createArm(state.totalNavigations, linkCount)
      }
      page.arms[url].lastSeen = state.totalNavigations
    }

    // Prune stale arms
    pruneArms(page, state.totalNavigations)

    // Select top-K
    const k = bandwidth.shouldPrefetch
      ? Math.min(DEFAULT_TOP_K, bandwidth.maxPrefetches)
      : 0

    let predictions: string[] = []
    if (k > 0 && Object.keys(page.arms).length > 0) {
      predictions = strategy.selectTopK(page.arms, k, page.totalPulls)
      prefetch(predictions)
    }

    // Store predictions for reward on next page load
    saveSession({ fromPath: path, predictions })

    // Persist state on pagehide
    function onPageHide() {
      saveState(state)
    }
    window.addEventListener('pagehide', onPageHide)

    // Also save on visibility change (in case pagehide doesn't fire)
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        saveState(state)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true })
  } else {
    run()
  }
}

init()
