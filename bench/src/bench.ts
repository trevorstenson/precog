import { RNG } from './rng.js'
import { generateTopology } from './topology.js'
import { generateTrafficMatrix, generateTrialSequence } from './traffic.js'
import { runTrial } from './runner.js'
import type {
  BenchConfig,
  BenchmarkResult,
  StrategyId,
  TrialResult,
  StrategyStats,
} from './types.js'

const ALL_STRATEGIES: StrategyId[] = [
  'navbandit',
  'navbandit-ts',
  'prefetch-all',
  'static-top-k',
  'random-k',
  'no-prefetch',
]

const BASE_METRICS = [
  'hitRate',
  'efficiency',
  'totalPrefetches',
  'hits',
  'wastedPrefetches',
  'bandwidthKB',
  'convergenceNav',
] as const

const LATENCY_METRICS = [
  'expectedLatencyMs',
  'p50LatencyMs',
  'p95LatencyMs',
  'instantNavRate',
] as const

export function runBenchmark(config: BenchConfig): BenchmarkResult {
  const baseRng = new RNG(config.seed)

  // Generate topology and traffic matrix once (shared across trials)
  const site = generateTopology(config.topology, baseRng)
  const trafficMatrix = generateTrafficMatrix(site, config.traffic, baseRng)

  // Collect all trial results
  const allResults: Record<StrategyId, TrialResult[]> = {} as any
  for (const sid of ALL_STRATEGIES) {
    allResults[sid] = []
  }

  for (let trial = 0; trial < config.trials; trial++) {
    const trialRng = new RNG(config.seed + trial + 1)
    const navigations = generateTrialSequence(
      site,
      trafficMatrix,
      config.traffic,
      config.navigationsPerTrial,
      trialRng
    )

    const runnerRng = new RNG(config.seed + trial + 10000)
    const results = runTrial(
      {
        site,
        trafficMatrix,
        navigations,
        k: config.k,
        alpha: config.alpha,
        network: config.network,
        pageWeight: config.pageWeight,
      },
      runnerRng
    )

    for (const result of results) {
      allResults[result.strategy].push(result)
    }
  }

  // Compute stats with 95% CI
  const strategies: Record<StrategyId, StrategyStats> = {} as any
  for (const sid of ALL_STRATEGIES) {
    const hasLatency = allResults[sid][0]?.expectedLatencyMs !== undefined
    strategies[sid] = computeStats(allResults[sid], hasLatency)
  }

  return {
    topology: config.topology,
    traffic: config.traffic,
    trials: config.trials,
    navigationsPerTrial: config.navigationsPerTrial,
    strategies,
    metadata: {
      timestamp: new Date().toISOString(),
      seed: config.seed,
    },
  }
}

function computeStats(results: TrialResult[], includeLatency: boolean): StrategyStats {
  const n = results.length
  const mean: Record<string, number> = {}
  const ci95: Record<string, [number, number]> = {}

  const metrics = includeLatency
    ? [...BASE_METRICS, ...LATENCY_METRICS]
    : [...BASE_METRICS]

  for (const metric of metrics) {
    const values = results.map(r => {
      const v = (r as any)[metric]
      return v === null || v === undefined ? 0 : v
    })

    const avg = values.reduce((a, b) => a + b, 0) / n
    const variance = n > 1 ? values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (n - 1) : 0
    const stdErr = Math.sqrt(variance / n)
    const margin = 1.96 * stdErr

    mean[metric] = avg
    ci95[metric] = [avg - margin, avg + margin]
  }

  return { mean, ci95 }
}

export function formatResultsTable(result: BenchmarkResult): string {
  const lines: string[] = []
  const pad = (s: string, len: number) => s.padEnd(len)
  const pct = (v: number, ci: [number, number]) => {
    const margin = ((ci[1] - ci[0]) / 2) * 100
    return `${(v * 100).toFixed(1)}% ± ${margin.toFixed(1)}%`
  }
  const mb = (kb: number, ci: [number, number]) => {
    const margin = (ci[1] - ci[0]) / 2 / 1024
    return `${(kb / 1024).toFixed(1)} ± ${margin.toFixed(1)}`
  }
  const ms = (v: number, ci: [number, number]) => {
    const margin = (ci[1] - ci[0]) / 2
    return `${v.toFixed(0)} ± ${margin.toFixed(0)}ms`
  }

  const hasLatency = result.strategies['navbandit'].mean.expectedLatencyMs !== undefined

  let header = `${pad('Strategy', 18)}${pad('Hit Rate', 20)}${pad('Efficiency', 20)}${pad('Bandwidth (MB)', 18)}`
  if (hasLatency) {
    header += `${pad('Avg Latency', 18)}${pad('Instant Nav %', 18)}`
  }
  header += 'Convergence'
  lines.push(header)
  lines.push('-'.repeat(header.length))

  const order: StrategyId[] = ['navbandit', 'navbandit-ts', 'prefetch-all', 'static-top-k', 'random-k', 'no-prefetch']
  const names: Record<StrategyId, string> = {
    'navbandit': 'NavBandit UCB1',
    'navbandit-ts': 'NavBandit TS',
    'prefetch-all': 'Prefetch All',
    'static-top-k': 'Static Top-K',
    'random-k': 'Random K',
    'no-prefetch': 'No Prefetch',
  }

  for (const sid of order) {
    const s = result.strategies[sid]
    const hitRateStr = sid === 'no-prefetch' ? '0.0%' : pct(s.mean.hitRate, s.ci95.hitRate)
    const effStr = sid === 'no-prefetch' ? 'n/a' : pct(s.mean.efficiency, s.ci95.efficiency)
    const bwStr = mb(s.mean.bandwidthKB, s.ci95.bandwidthKB)
    let convStr = 'n/a'
    if (sid === 'navbandit' || sid === 'navbandit-ts') {
      const conv = s.mean.convergenceNav
      convStr = conv > 0 ? `~${Math.round(conv)} navs` : 'not reached'
    } else if (sid === 'static-top-k') {
      convStr = 'oracle'
    }

    let line = `${pad(names[sid], 18)}${pad(hitRateStr, 20)}${pad(effStr, 20)}${pad(bwStr, 18)}`

    if (hasLatency) {
      const latStr = ms(s.mean.expectedLatencyMs, s.ci95.expectedLatencyMs)
      const instantStr = pct(s.mean.instantNavRate, s.ci95.instantNavRate)
      line += `${pad(latStr, 18)}${pad(instantStr, 18)}`
    }

    line += convStr
    lines.push(line)
  }

  return lines.join('\n')
}
