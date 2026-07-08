/*
 * Per-team bonus behavior — loaded from scripts/training/bonus_weights.json.
 *
 * Trained on 2012-2022 R1-deep picks (held out 2023-2024). The headline
 * fields the UI surfaces:
 *   - learnedIntercept : per-team Adam-fit α; the team's "general"
 *                        over/under-slot lean controlling for player type
 *   - rawMean          : raw mean overSlotRatio (no controls)
 *   - rawMedian        : median; less affected by huge over-slot bombs
 *   - overSlotPct      : fraction of their picks signed for >2% over slot
 *   - underSlotPct     : fraction signed for >2% under slot
 *   - n                : sample size
 *
 * Verdict bucketing is from the raw mean (intercept is a model output and
 * less intuitive). Cutpoints calibrated against the league-wide distribution.
 */
import data from '../../scripts/training/bonus_weights.json'

export const bonusFor = (orgId) => data.perTeam?.[orgId] ?? null

/**
 * Per-FO lookup. Returns the bonus tendency aggregated across all teams the
 * decision-maker has run (e.g. Stearns MIL → NYM, Dombrowski DET → BOS → PHI).
 * Falls back to null when the FO isn't in the registry or has <5 picks.
 */
export const bonusForFO = (foId) => data.perFO?.[foId] ?? null

export const bonusMeta = data._meta

export const bonusVerdict = (stats) => {
  if (!stats || stats.n < 10) return null
  const m = stats.rawMean
  if (m >=  0.05) return 'OVER-SLOT'
  if (m >=  0.00) return 'BALANCED'
  if (m >= -0.10) return 'UNDER-SLOT'
  return 'WELL-UNDER-SLOT'
}
