import { createArm, selectTopK } from '../../src/ucb1.js'
import type { Arm } from '../../src/ucb1.js'
import { createBetaArm, selectTopK as tsSelectTopK } from '../../src/thompson.js'
import type { BetaArm } from '../../src/thompson.js'
import { RNG } from './rng.js'
import type { Strategy, StrategyId, TrafficMatrix } from './types.js'

// NavBandit UCB1 strategy — mirrors the real library
export class NavBanditStrategy implements Strategy {
  id: StrategyId = 'navbandit'
  private pageState: Record<string, { arms: Record<string, Arm>; totalPulls: number }> = {}
  private lastPage: string | null = null
  private lastPrefetched: string[] = []
  private navCount = 0

  constructor(
    private k: number,
    private alpha: number
  ) {}

  onNavigate(currentPage: string, availableLinks: string[]): string[] {
    this.navCount++

    // Initialize page state if needed
    if (!this.pageState[currentPage]) {
      this.pageState[currentPage] = { arms: {}, totalPulls: 0 }
    }
    const state = this.pageState[currentPage]

    // Add new arms for links we haven't seen (weak uniform prior)
    const linkCount = availableLinks.length
    for (const link of availableLinks) {
      if (!state.arms[link]) {
        const arm = createArm(this.navCount)
        arm.pulls = 1
        arm.rewards = 1 / linkCount
        state.arms[link] = arm
      }
    }

    // Select top-K using UCB1
    // Only consider currently available links
    const availableArms: Record<string, Arm> = {}
    for (const link of availableLinks) {
      availableArms[link] = state.arms[link]
    }

    const selected = selectTopK(availableArms, Math.max(1, state.totalPulls), this.k, this.alpha)

    this.lastPage = currentPage
    this.lastPrefetched = selected
    return selected
  }

  onReveal(destination: string): void {
    if (!this.lastPage || !this.pageState[this.lastPage]) return

    const state = this.pageState[this.lastPage]

    // Full-information feedback: always reward the actual destination
    const destArm = state.arms[destination]
    if (destArm) {
      destArm.rewards++
      destArm.pulls++
      state.totalPulls++
    }

    // Penalize prefetched arms that weren't clicked
    for (const prefetched of this.lastPrefetched) {
      if (prefetched !== destination && state.arms[prefetched]) {
        state.arms[prefetched].pulls++
        state.totalPulls++
      }
    }
  }

  reset(): void {
    this.pageState = {}
    this.lastPage = null
    this.lastPrefetched = []
    this.navCount = 0
  }
}

// NavBandit Thompson Sampling strategy — Bayesian adaptive prefetching
export class NavBanditTSStrategy implements Strategy {
  id: StrategyId = 'navbandit-ts'
  private pageState: Record<string, { arms: Record<string, BetaArm>; totalPulls: number }> = {}
  private lastPage: string | null = null
  private lastPrefetched: string[] = []
  private navCount = 0

  constructor(private k: number) {}

  onNavigate(currentPage: string, availableLinks: string[]): string[] {
    this.navCount++

    if (!this.pageState[currentPage]) {
      this.pageState[currentPage] = { arms: {}, totalPulls: 0 }
    }
    const state = this.pageState[currentPage]

    // Add new arms with weak uniform prior
    const linkCount = availableLinks.length
    for (const link of availableLinks) {
      if (!state.arms[link]) {
        const arm = createBetaArm(this.navCount)
        arm.alpha = 1 + 1 / linkCount
        state.arms[link] = arm
      }
    }

    // Only consider currently available links
    const availableArms: Record<string, BetaArm> = {}
    for (const link of availableLinks) {
      availableArms[link] = state.arms[link]
    }

    const selected = tsSelectTopK(availableArms, this.k)

    this.lastPage = currentPage
    this.lastPrefetched = selected
    return selected
  }

  onReveal(destination: string): void {
    if (!this.lastPage || !this.pageState[this.lastPage]) return

    const state = this.pageState[this.lastPage]

    // Reward the actual destination (success: alpha++)
    const destArm = state.arms[destination]
    if (destArm) {
      destArm.alpha++
      state.totalPulls++
    }

    // Penalize prefetched arms that weren't clicked (failure: beta++)
    for (const prefetched of this.lastPrefetched) {
      if (prefetched !== destination && state.arms[prefetched]) {
        state.arms[prefetched].beta++
        state.totalPulls++
      }
    }
  }

  reset(): void {
    this.pageState = {}
    this.lastPage = null
    this.lastPrefetched = []
    this.navCount = 0
  }
}

// Prefetch All — instant.page style
export class PrefetchAllStrategy implements Strategy {
  id: StrategyId = 'prefetch-all'

  onNavigate(_currentPage: string, availableLinks: string[]): string[] {
    return [...availableLinks]
  }

  onReveal(_destination: string): void {}
  reset(): void {}
}

// Static Top-K Oracle — knows the true distribution
export class StaticTopKStrategy implements Strategy {
  id: StrategyId = 'static-top-k'

  constructor(
    private matrix: TrafficMatrix,
    private k: number
  ) {}

  onNavigate(currentPage: string, availableLinks: string[]): string[] {
    const probs = this.matrix.probabilities[currentPage] || {}
    return [...availableLinks]
      .sort((a, b) => (probs[b] || 0) - (probs[a] || 0))
      .slice(0, this.k)
  }

  onReveal(_destination: string): void {}
  reset(): void {}
}

// Random K
export class RandomKStrategy implements Strategy {
  id: StrategyId = 'random-k'

  constructor(
    private k: number,
    private rng: RNG
  ) {}

  onNavigate(_currentPage: string, availableLinks: string[]): string[] {
    return this.rng.shuffle(availableLinks).slice(0, this.k)
  }

  onReveal(_destination: string): void {}
  reset(): void {}
}

// No Prefetch baseline
export class NoPrefetchStrategy implements Strategy {
  id: StrategyId = 'no-prefetch'

  onNavigate(_currentPage: string, _availableLinks: string[]): string[] {
    return []
  }

  onReveal(_destination: string): void {}
  reset(): void {}
}
