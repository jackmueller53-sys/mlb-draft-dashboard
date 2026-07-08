/*
 * foLookup.js
 *
 * Browser-side resolver: given a team id (and optional year), return the
 * front-office regime in charge that year. Reads regimeMeta from
 * model_weights.json — no separate fetch, no duplicate registry.
 *
 * For the 2026 draft simulator we default to year=2026, but the helper
 * accepts any year so historical comparisons are possible later.
 */
import modelWeights from '../../scripts/training/model_weights.json'

const orgIdOf = (teamId) => teamId.replace(/-(S|R2)$/, '')

/** Build a fast lookup: { teamId: { year: foId } } */
const byTeamYear = (() => {
  const t = {}
  for (const [foId, meta] of Object.entries(modelWeights.regimeMeta ?? {})) {
    for (const tenure of meta.tenures ?? []) {
      if (!t[tenure.team]) t[tenure.team] = {}
      const to = tenure.to ?? 2026
      for (let y = tenure.from; y <= to; y++) {
        t[tenure.team][y] = foId
      }
    }
  }
  return t
})()

export const foForTeamYear = (teamId, year = 2026) =>
  byTeamYear[orgIdOf(teamId)]?.[year] ?? null

export const foMeta = (foId) => modelWeights.regimeMeta?.[foId] ?? null

export const foWeights = (foId) => modelWeights.betaFO?.[foId] ?? null
