import { RNG } from './rng.js'
import type {
  Site,
  TrafficMatrix,
  NavigationStep,
  Strategy,
  TrialResult,
  RunnerConfig,
} from './types.js'
import {
  NavBanditStrategy,
  NavBanditTSStrategy,
  PrefetchAllStrategy,
  StaticTopKStrategy,
  RandomKStrategy,
  NoPrefetchStrategy,
} from './strategies.js'
import { simulateNavLatency } from './latency.js'

const SLIDING_WINDOW = 50
const THINK_TIME_MEAN_MS = 3000

export function createStrategies(
  matrix: TrafficMatrix,
  k: number,
  alpha: number,
  rng: RNG
): Strategy[] {
  return [
    new NavBanditStrategy(k, alpha),
    new NavBanditTSStrategy(k),
    new PrefetchAllStrategy(),
    new StaticTopKStrategy(matrix, k),
    new RandomKStrategy(k, rng),
    new NoPrefetchStrategy(),
  ]
}

function sampleThinkTime(mean: number, rng: RNG): number {
  // Geometric distribution: mean = 1/p, sample via log
  const p = 1 / mean
  return Math.max(500, Math.floor(Math.log(1 - rng.random()) / Math.log(1 - p)))
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor(p * (sorted.length - 1))
  return sorted[idx]
}

export function runTrial(config: RunnerConfig, rng: RNG): TrialResult[] {
  const { site, trafficMatrix, navigations, k, alpha, network, pageWeight } = config
  const strategies = createStrategies(trafficMatrix, k, alpha, rng)
  const hasLatency = !!(network && pageWeight)

  // Per-strategy tracking
  const tracking = strategies.map(() => ({
    hits: 0,
    totalPrefetches: 0,
    hitWindow: [] as boolean[],
    hitRateOverTime: [] as number[],
    latencies: [] as number[],
    instantNavs: 0,
  }))

  // Find oracle's sliding window hit rates for convergence calculation
  const oracleIdx = strategies.findIndex(s => s.id === 'static-top-k')

  for (let step = 0; step < navigations.length; step++) {
    const nav = navigations[step]
    const page = site.pages[nav.currentPage]
    if (!page) continue

    const availableLinks = page.links
    const thinkTimeMs = hasLatency ? sampleThinkTime(THINK_TIME_MEAN_MS, rng) : 0

    for (let si = 0; si < strategies.length; si++) {
      const strategy = strategies[si]
      const track = tracking[si]

      // Get prefetch predictions
      const prefetched = strategy.onNavigate(nav.currentPage, availableLinks)
      track.totalPrefetches += prefetched.length

      // Check hit (skip at session boundaries)
      if (!nav.isSessionBoundary) {
        const isHit = prefetched.includes(nav.destination)
        if (isHit) track.hits++

        // Sliding window
        track.hitWindow.push(isHit)
        if (track.hitWindow.length > SLIDING_WINDOW) track.hitWindow.shift()

        // Latency simulation
        if (hasLatency) {
          const latResult = simulateNavLatency(
            prefetched,
            nav.destination,
            network!,
            pageWeight!.pageSizeKB,
            thinkTimeMs
          )
          track.latencies.push(latResult.actualLatencyMs)
          if (latResult.isInstant) track.instantNavs++
        }
      }

      // Record sliding window hit rate
      const windowHits = track.hitWindow.filter(Boolean).length
      const windowRate = track.hitWindow.length > 0 ? windowHits / track.hitWindow.length : 0
      track.hitRateOverTime.push(windowRate)

      // Reveal actual destination
      strategy.onReveal(nav.destination)
    }
  }

  // Compute convergence for bandit strategies
  function computeConvergence(banditSi: number): number | null {
    if (oracleIdx < 0) return null
    const banditRates = tracking[banditSi].hitRateOverTime
    const oracleRates = tracking[oracleIdx].hitRateOverTime
    const sustainedSteps = 10

    for (let i = SLIDING_WINDOW; i < banditRates.length - sustainedSteps; i++) {
      const oracleRate = oracleRates[i]
      if (oracleRate === 0) continue

      let sustained = true
      for (let j = 0; j < sustainedSteps; j++) {
        if (banditRates[i + j] < oracleRates[i + j] * 0.9) {
          sustained = false
          break
        }
      }
      if (sustained) return i
    }
    return null
  }

  const banditStrategies = new Set(['navbandit', 'navbandit-ts'])

  return strategies.map((strategy, si) => {
    const track = tracking[si]
    const nonBoundarySteps = navigations.filter(n => !n.isSessionBoundary).length
    const hitRate = nonBoundarySteps > 0 ? track.hits / nonBoundarySteps : 0
    const efficiency = track.totalPrefetches > 0 ? track.hits / track.totalPrefetches : 0
    const pageSizeKB = pageWeight?.pageSizeKB ?? 200

    const result: TrialResult = {
      strategy: strategy.id,
      hitRate,
      efficiency,
      totalPrefetches: track.totalPrefetches,
      hits: track.hits,
      wastedPrefetches: track.totalPrefetches - track.hits,
      bandwidthKB: track.totalPrefetches * pageSizeKB,
      convergenceNav: banditStrategies.has(strategy.id) ? computeConvergence(si) : null,
      hitRateOverTime: track.hitRateOverTime,
    }

    // Add latency metrics if computed
    if (hasLatency && track.latencies.length > 0) {
      const sorted = [...track.latencies].sort((a, b) => a - b)
      const total = track.latencies.reduce((a, b) => a + b, 0)
      result.expectedLatencyMs = total / track.latencies.length
      result.p50LatencyMs = percentile(sorted, 0.5)
      result.p95LatencyMs = percentile(sorted, 0.95)
      result.instantNavRate = track.instantNavs / track.latencies.length
    }

    return result
  })
}
