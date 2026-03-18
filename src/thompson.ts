export interface BetaArm {
  alpha: number
  beta: number
  lastSeen: number
}

export function createBetaArm(lastSeen: number): BetaArm {
  return { alpha: 1, beta: 1, lastSeen }
}

/**
 * Sample from Beta(α, β) via ratio of Gamma samples.
 * X ~ Gamma(α), Y ~ Gamma(β), then X/(X+Y) ~ Beta(α, β).
 */
export function betaSample(alpha: number, beta: number): number {
  const x = gammaSample(alpha)
  const y = gammaSample(beta)
  if (x + y === 0) return 0.5
  return x / (x + y)
}

/**
 * Gamma(shape, 1) via Marsaglia & Tsang's method.
 * For shape >= 1 only (our priors always start at 1).
 */
function gammaSample(shape: number): number {
  if (shape < 1) return gammaSample(shape + 1) * Math.random() ** (1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number, v: number
    do { x = randn(); v = 1 + c * x } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function randn(): number {
  return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random())
}

export function selectTopK(
  arms: Record<string, BetaArm>,
  k: number
): string[] {
  return Object.entries(arms)
    .map(([url, arm]) => ({ url, sample: betaSample(arm.alpha, arm.beta) }))
    .sort((a, b) => b.sample - a.sample)
    .slice(0, k)
    .map((p) => p.url)
}

/** Strategy adapter — swap this import in standalone.ts to switch algorithms */
export const strategy = {
  createArm(lastSeen: number, linkCount: number): BetaArm {
    const arm = createBetaArm(lastSeen)
    arm.alpha = 1 + 1 / linkCount
    return arm
  },
  selectTopK(arms: Record<string, BetaArm>, k: number, _totalPulls: number): string[] {
    return selectTopK(arms, k)
  },
  reward(arm: BetaArm): void { arm.alpha++ },
  penalize(arm: BetaArm): void { arm.beta++ },
}
