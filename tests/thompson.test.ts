import { describe, it, expect } from 'vitest'
import { createBetaArm, betaSample, selectTopK, type BetaArm } from '../src/thompson'

describe('thompson', () => {
  describe('createBetaArm', () => {
    it('initializes with uniform prior (alpha=1, beta=1)', () => {
      const arm = createBetaArm(5)
      expect(arm.alpha).toBe(1)
      expect(arm.beta).toBe(1)
      expect(arm.lastSeen).toBe(5)
    })
  })

  describe('betaSample', () => {
    it('returns values in [0, 1]', () => {
      for (let i = 0; i < 100; i++) {
        const s = betaSample(1, 1)
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(1)
      }
    })

    it('samples near 1 for high alpha, low beta', () => {
      const samples: number[] = []
      for (let i = 0; i < 200; i++) {
        samples.push(betaSample(100, 1))
      }
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length
      expect(mean).toBeGreaterThan(0.9)
    })

    it('samples near 0 for low alpha, high beta', () => {
      const samples: number[] = []
      for (let i = 0; i < 200; i++) {
        samples.push(betaSample(1, 100))
      }
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length
      expect(mean).toBeLessThan(0.1)
    })

    it('samples near 0.5 for symmetric priors', () => {
      const samples: number[] = []
      for (let i = 0; i < 500; i++) {
        samples.push(betaSample(10, 10))
      }
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length
      expect(mean).toBeGreaterThan(0.4)
      expect(mean).toBeLessThan(0.6)
    })

    it('handles shape < 1 (fractional alpha/beta)', () => {
      for (let i = 0; i < 50; i++) {
        const s = betaSample(0.5, 0.5)
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('selectTopK', () => {
    it('favors arms with higher reward rate over many samples', () => {
      const arms: Record<string, BetaArm> = {
        '/good': { alpha: 50, beta: 2, lastSeen: 0 },
        '/bad': { alpha: 2, beta: 50, lastSeen: 0 },
        '/mid': { alpha: 10, beta: 10, lastSeen: 0 },
      }

      // Run many selections — /good should dominate top-1
      const counts: Record<string, number> = { '/good': 0, '/bad': 0, '/mid': 0 }
      const trials = 200
      for (let i = 0; i < trials; i++) {
        const result = selectTopK(arms, 1)
        counts[result[0]]++
      }
      expect(counts['/good']).toBeGreaterThan(trials * 0.8)
      expect(counts['/bad']).toBeLessThan(trials * 0.05)
    })

    it('returns correct number of results', () => {
      const arms: Record<string, BetaArm> = {
        '/a': { alpha: 5, beta: 2, lastSeen: 0 },
        '/b': { alpha: 3, beta: 4, lastSeen: 0 },
        '/c': { alpha: 1, beta: 1, lastSeen: 0 },
      }
      expect(selectTopK(arms, 2)).toHaveLength(2)
    })

    it('returns all arms if fewer than K', () => {
      const arms: Record<string, BetaArm> = {
        '/a': { alpha: 5, beta: 2, lastSeen: 0 },
      }
      expect(selectTopK(arms, 3)).toHaveLength(1)
    })

    it('returns empty array for empty arms', () => {
      expect(selectTopK({}, 3)).toHaveLength(0)
    })

    it('explores uncertain arms (uniform prior)', () => {
      const arms: Record<string, BetaArm> = {
        '/known': { alpha: 20, beta: 20, lastSeen: 0 }, // known ~0.5
        '/new': { alpha: 1, beta: 1, lastSeen: 0 },     // unknown, high variance
      }

      // /new should appear in top-1 at least sometimes due to exploration
      let newSelected = 0
      const trials = 200
      for (let i = 0; i < trials; i++) {
        const result = selectTopK(arms, 1)
        if (result[0] === '/new') newSelected++
      }
      // Uniform Beta(1,1) has high variance, so /new should be selected meaningfully often
      expect(newSelected).toBeGreaterThan(trials * 0.15)
    })
  })
})
