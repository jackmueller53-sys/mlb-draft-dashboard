/*
 * Module-level cache for Monte Carlo runs. Teams and prospects are static
 * JSON imports, so we can memoize indefinitely keyed by (n, seed).
 *
 * Pages call `getMC()` without args and share the same default run.
 * Pass `{ n, seed }` for ad-hoc runs (e.g. "re-roll" button).
 */
import teamsData from '../data/teams.json'
import prospectsData from '../data/prospects.json'
import { runMonteCarlo } from './simulator.js'

const cache = new Map()

export const getMC = ({ n = 1000, seed = 1 } = {}) => {
  const key = `${n}:${seed}`
  if (!cache.has(key)) {
    cache.set(key, runMonteCarlo(teamsData.teams, prospectsData.prospects, { n, seed }))
  }
  return cache.get(key)
}

/** Clear the cache (e.g., before a force re-run with the same key). */
export const resetMC = () => cache.clear()
