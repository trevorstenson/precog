export interface Arm {
  pulls: number
  rewards: number
  lastSeen: number
}

export function createArm(lastSeen: number): Arm {
  return { pulls: 0, rewards: 0, lastSeen }
}

export function ucbScore(arm: Arm, totalPulls: number, alpha: number): number {
  if (arm.pulls === 0) return Infinity
  const exploitation = arm.rewards / arm.pulls
  const exploration = alpha * Math.sqrt(Math.log(totalPulls) / arm.pulls)
  return exploitation + exploration
}

export function selectTopK(
  arms: Record<string, Arm>,
  totalPulls: number,
  k: number,
  alpha: number
): string[] {
  return Object.entries(arms)
    .map(([url, arm]) => ({ url, score: ucbScore(arm, totalPulls, alpha) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((p) => p.url)
}

const DEFAULT_ALPHA = 0.5

/** Strategy adapter — swap this import in standalone.ts to switch algorithms */
export const strategy = {
  createArm(lastSeen: number, linkCount: number): Arm {
    const arm = createArm(lastSeen)
    arm.pulls = 1
    arm.rewards = 1 / linkCount
    return arm
  },
  selectTopK(arms: Record<string, Arm>, k: number, totalPulls: number): string[] {
    return selectTopK(arms, Math.max(1, totalPulls), k, DEFAULT_ALPHA)
  },
  reward(arm: Arm): void { arm.rewards++; arm.pulls++ },
  penalize(arm: Arm): void { arm.pulls++ },
}
