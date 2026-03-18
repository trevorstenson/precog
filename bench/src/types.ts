export interface TopologyConfig {
  archetype: 'docs' | 'ecommerce' | 'news'
  pageCount: number
  linksPerPage: [number, number]
  sections: number
}

export interface TrafficConfig {
  sessionLengthMean: number
  zipfExponent: number
  returnVisitorRate: number
  sectionStickiness: number
}

export interface Page {
  id: string
  section: number
  links: string[]
  type: 'root' | 'section' | 'leaf' | 'utility'
}

export interface Site {
  pages: Record<string, Page>
  root: string
}

export interface TrafficMatrix {
  /** For each page, a map of link -> click probability */
  probabilities: Record<string, Record<string, number>>
}

export type StrategyId = 'navbandit' | 'navbandit-ts' | 'prefetch-all' | 'static-top-k' | 'random-k' | 'no-prefetch'

export interface Strategy {
  id: StrategyId
  onNavigate(currentPage: string, availableLinks: string[]): string[]
  onReveal(destination: string): void
  reset(): void
}

export interface NavigationStep {
  currentPage: string
  destination: string
  isSessionBoundary: boolean
}

export interface TrialResult {
  strategy: StrategyId
  hitRate: number
  efficiency: number
  totalPrefetches: number
  hits: number
  wastedPrefetches: number
  bandwidthKB: number
  convergenceNav: number | null
  hitRateOverTime: number[]
  // Latency metrics (present when network config provided)
  expectedLatencyMs?: number
  p50LatencyMs?: number
  p95LatencyMs?: number
  instantNavRate?: number
}

export interface StrategyStats {
  mean: Record<string, number>
  ci95: Record<string, [number, number]>
}

export interface BenchmarkResult {
  topology: TopologyConfig
  traffic: TrafficConfig
  trials: number
  navigationsPerTrial: number
  strategies: Record<StrategyId, StrategyStats>
  metadata: { timestamp: string; seed: number }
}

export interface NetworkConfig {
  label: string
  bandwidthMbps: number
  rttMs: number
  maxParallelConnections: number
}

export interface PageWeightConfig {
  label: string
  pageSizeKB: number
}

export interface ScenarioConfig {
  network: NetworkConfig
  pageWeight: PageWeightConfig
}

export interface NavLatencyResult {
  actualLatencyMs: number
  isHit: boolean
  isInstant: boolean
  contentionFactor: number
}

export interface RunnerConfig {
  site: Site
  trafficMatrix: TrafficMatrix
  navigations: NavigationStep[]
  k: number
  alpha: number
  network?: NetworkConfig
  pageWeight?: PageWeightConfig
}

export interface BenchConfig {
  topology: TopologyConfig
  traffic: TrafficConfig
  trials: number
  navigationsPerTrial: number
  k: number
  alpha: number
  seed: number
  network?: NetworkConfig
  pageWeight?: PageWeightConfig
}

export interface SweepResult {
  topology: TopologyConfig
  traffic: TrafficConfig
  trials: number
  navigationsPerTrial: number
  scenarios: Array<{
    scenario: ScenarioConfig
    strategies: Record<StrategyId, StrategyStats>
  }>
  metadata: { timestamp: string; seed: number }
}
