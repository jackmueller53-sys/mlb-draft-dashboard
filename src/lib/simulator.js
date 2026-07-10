/*
 * Simulator engine.
 *
 * v0.5 — uses a trained per-team conditional-logit preference model when
 * available, falling back to the v0.3 heuristic for teams without learned
 * weights.
 *
 *   score = 55 + learnedUtility + needBonus + positional + trait
 *              + FV/consensus emphasis (early picks)
 *
 * The learned utility is `(β_global + δ_team) · features(prospect)` from
 * scripts/training/model_weights.json. Features encode level (HS/college),
 * tier (P/H), region, and an FV proxy. Re-running the trainer regenerates
 * the weights without touching this file.
 *
 * v0.23 — signability was removed from scoring: a prospect's sign-ability
 * lean (easy/tough) is a subjective, non-public estimate, so the model no
 * longer conditions on it. (Public signing-bonus behavior still shows on
 * team profiles as descriptive history, but does not drive picks.)
 *
 * Monte Carlo: scoreProspect + gaussian noise, N independent draws,
 * aggregated to per-pick and per-team probabilities.
 */

import modelWeights from '../../scripts/training/model_weights.json'
import { foForTeamYear } from './foLookup.js'

// ── Featurization (mirrors scripts/training/featurize.js) ──────────────

const PITCHERS = new Set(['RHP', 'LHP', 'P'])

const REGION_BY_STATE = {
  WA:'West', OR:'West', CA:'West', NV:'West', AZ:'West', UT:'West', CO:'West',
  ID:'West', MT:'West', WY:'West', AK:'West', HI:'West', NM:'West',
  TX:'South', OK:'South', AR:'South', LA:'South', MS:'South', TN:'South',
  AL:'South', GA:'South', FL:'South', SC:'South', NC:'South', VA:'South',
  WV:'South', KY:'South',
  IL:'Midwest', IN:'Midwest', OH:'Midwest', MI:'Midwest', WI:'Midwest',
  MN:'Midwest', IA:'Midwest', MO:'Midwest', KS:'Midwest', NE:'Midwest',
  ND:'Midwest', SD:'Midwest',
  NY:'Northeast', NJ:'Northeast', PA:'Northeast', MA:'Northeast', CT:'Northeast',
  RI:'Northeast', NH:'Northeast', VT:'Northeast', ME:'Northeast', MD:'Northeast',
  DE:'Northeast', DC:'Northeast',
}

const regionFromState = (state) => {
  if (!state) return 'Other'
  return REGION_BY_STATE[state] || 'Other'
}

/*
 * Conference map for college picks. Pre-2024 alignment; 2024 realignment
 * baked in for affected schools. Mirrors scripts/training/featurize.js.
 */
const CONF_BY_SCHOOL = {
  'LSU':'SEC','Alabama':'SEC','Auburn':'SEC','Florida':'SEC','Georgia':'SEC',
  'Kentucky':'SEC','Mississippi State':'SEC','Ole Miss':'SEC','Mississippi':'SEC',
  'South Carolina':'SEC','Tennessee':'SEC','Texas A&M':'SEC','Vanderbilt':'SEC',
  'Arkansas':'SEC','Missouri':'SEC','Oklahoma':'SEC','Texas':'SEC',
  'Boston College':'ACC','Clemson':'ACC','Duke':'ACC','Florida State':'ACC',
  'Georgia Tech':'ACC','Louisville':'ACC','Miami':'ACC','NC State':'ACC',
  'North Carolina':'ACC','Notre Dame':'ACC','Pittsburgh':'ACC','Pitt':'ACC',
  'Syracuse':'ACC','Virginia':'ACC','Virginia Tech':'ACC','Wake Forest':'ACC',
  'Stanford':'ACC','California':'ACC','Cal':'ACC',
  'Baylor':'B12','Iowa State':'B12','Kansas':'B12','Kansas State':'B12',
  'Oklahoma State':'B12','TCU':'B12','Texas Tech':'B12','West Virginia':'B12',
  'BYU':'B12','Cincinnati':'B12','UCF':'B12','Houston':'B12',
  'Arizona':'B12','Arizona State':'B12','Utah':'B12',
  'Illinois':'B10','Indiana':'B10','Iowa':'B10','Maryland':'B10',
  'Michigan':'B10','Michigan State':'B10','Minnesota':'B10','Nebraska':'B10',
  'Northwestern':'B10','Ohio State':'B10','Penn State':'B10','Purdue':'B10',
  'Rutgers':'B10','Wisconsin':'B10','USC':'B10','UCLA':'B10','Oregon':'B10',
  'Washington':'B10','Oregon State':'Pac12','Washington State':'Pac12',
}

const conferenceFromSchool = (school) => {
  if (!school) return 'Other'
  for (const key of Object.keys(CONF_BY_SCHOOL)) {
    if (school.includes(key)) return CONF_BY_SCHOOL[key]
  }
  return 'Other'
}

const inferAge = (p) => {
  if (p.level === 'HS') return 18
  if (p.level === 'JC') return 19
  if (p.level === 'College') return 21
  return 21
}

const POS_GROUP = {
  '1B':'CIF','3B':'CIF','IF':'CIF','DH':'CIF',
  '2B':'MIF','SS':'MIF',
  'C':'C',
  'OF':'COF','LF':'COF','RF':'COF',
  'CF':'CF',
  'LHP':'LHP',
  'RHP':'RHP','P':'RHP','SP':'RHP','RP':'RHP',
}

const featurize = (p) => {
  const isHS       = p.level === 'HS' ? 1 : 0
  const isCollege  = p.level === 'College' ? 1 : 0
  const grp        = POS_GROUP[p.pos] ?? null
  const region     = regionFromState(p.state)
  const fvNorm     = ((p.fv ?? 50) - 55) / 10

  const age     = typeof p.age === 'number' ? p.age : inferAge(p)
  const ageNorm = (age - 21) / 3

  const conf = isCollege ? conferenceFromSchool(p.school) : 'Other'

  return [
    isHS, isCollege,
    grp === 'CIF' ? 1 : 0,
    grp === 'MIF' ? 1 : 0,
    grp === 'C'   ? 1 : 0,
    grp === 'COF' ? 1 : 0,
    grp === 'CF'  ? 1 : 0,
    grp === 'LHP' ? 1 : 0,
    grp === 'RHP' ? 1 : 0,
    region === 'West' ? 1 : 0,
    region === 'South' ? 1 : 0,
    region === 'Midwest' ? 1 : 0,
    region === 'Northeast' ? 1 : 0,
    ageNorm,
    conf === 'SEC'   ? 1 : 0,
    conf === 'ACC'   ? 1 : 0,
    conf === 'B12'   ? 1 : 0,
    conf === 'B10'   ? 1 : 0,
    conf === 'Pac12' ? 1 : 0,
    fvNorm,
  ]
}

// Strip -S / -R2 suffix to get base org id (used as fallback key in model weights).
const orgIdOf = (team) => team.id.replace(/-\d+$/, '')

/*
 * Preference vector for a team. Tries front-office weights first (so e.g.
 * the Mets get Stearns' cross-team history), then falls back to team-level
 * weights for teams whose FO isn't in the registry.
 *
 * Returns { delta, source: 'fo' | 'team' | null, key }.
 */
const preferenceVector = (team) => {
  const foId = foForTeamYear(team.id, 2026)
  if (foId && modelWeights.betaFO?.[foId]) {
    return { delta: modelWeights.betaFO[foId], source: 'fo', key: foId }
  }
  const orgId = orgIdOf(team)
  if (modelWeights.betaTeam?.[orgId]) {
    return { delta: modelWeights.betaTeam[orgId], source: 'team', key: orgId }
  }
  return { delta: null, source: null, key: null }
}

const learnedUtility = (team, prospect) => {
  const { delta } = preferenceVector(team)
  if (!delta) return null
  const x = featurize(prospect)
  const bg = modelWeights.betaGlobal
  let s = 0
  for (let k = 0; k < x.length; k++) s += (bg[k] + delta[k]) * x[k]
  return s
}

export { preferenceVector }

// ── Heuristic fallback (v0.3) ──────────────────────────────────────────

/*
 * needBonus: flat +2.5 to a prospect's score when their position matches a
 * team need. Aliases expand each prospect's specific position into all the
 * codes that could appear in a team `needs` array — including position-group
 * codes (MIF/CIF/COF) so e.g. a 2B prospect matches a team that listed "MIF".
 */
const needBonus = (team, prospect) => {
  if (!team.needs) return 0
  const aliases = {
    SS:  ['SS', 'IF', 'MIF'],
    '2B':['2B', 'IF', 'MIF'],
    '3B':['3B', 'IF', 'CIF'],
    '1B':['1B', 'IF', 'CIF'],
    C:   ['C'],
    CF:  ['CF', 'OF', 'COF'],
    OF:  ['OF', 'COF'],
    LHP: ['LHP', 'P'],
    RHP: ['RHP', 'P'],
    P:   ['P', 'RHP'],
  }
  const matches = aliases[prospect.pos] || [prospect.pos]
  return team.needs.some(n => matches.includes(n)) ? 2.5 : 0
}

/*
 * Premium-position bonus. Industry treats up-the-middle defenders (C, SS, CF)
 * as scarce; corner positions (1B, DH) as defensive negatives. Applied flat
 * at inference, on top of FV and team prefs.
 *
 * Magnitudes are modest — about half an FV grade each direction — so they
 * nudge tiebreakers rather than overriding talent rankings.
 */
const POSITIONAL_VALUE = {
  C:  0.7,   // v0.18 — was 2.0 → tuned to 0.5 then nudged to 0.7. Keeps C
             // premium without forcing three catchers into the top 10. Most
             // catcher value is already in FV; this bonus is just the scarcity tax.
  SS: 1.5,
  CF: 0.7,   // v0.19 — was 1.5. Stacking with OF-need bonus was forcing
             // three CFs (rk 31/39/47) into picks #15-17. Same scarcity-tax
             // calibration as C now; FV does the heavy lifting.
  '2B': 0.5,
  '3B': 0,
  OF:  0,
  LF:  0,
  RF:  0,
  '1B': -1.5,  // defense-light, profile risk
  DH:  -1.5,
}

const positionalValueBonus = (prospect) =>
  POSITIONAL_VALUE[prospect.pos] ?? 0

/*
 * Pitcher trait bonus. Parses scoutingNotes / blurb / tags for industry
 * trait language (velocity, frame, command, athleticism). +X bonus for
 * each trait detected, capped so a single arm can't run away with the
 * scoring on text alone. Hitters get 0.
 *
 * Patterns are conservative — only counts unambiguous mentions like
 * "94-98" or "plus command" so we don't double-count vague language.
 */
const PITCHER_TRAIT_PATTERNS = [
  { re: /\b(9[5-9]|10[0-9])\s*-?\s*(?:9[5-9]|10[0-9])?\s*mph|sits\s+9[5-9]|touches?\s+(?:9[7-9]|10[0-9])/i, bonus: 1.5, label: 'velocity' },
  { re: /plus[- ]plus|double[- ]plus/i, bonus: 0.8, label: 'plus-plus tool' },
  { re: /plus\s+(?:command|control|fastball|slider|curve|change)/i, bonus: 0.6, label: 'plus pitch' },
  { re: /projectable\s+(?:frame|body)|pro[- ]ready|advanced\s+(?:command|polish|feel)/i, bonus: 0.6, label: 'frame/polish' },
  { re: /three[- ]?pitch\s+mix|four[- ]?pitch\s+mix|clean\s+arm/i, bonus: 0.4, label: 'mix' },
]

const PITCHER_TRAIT_CAP = 2.5

const pitcherTraitBonus = (prospect) => {
  if (!PITCHERS.has(prospect.pos)) return 0
  const text = `${prospect.scoutingNotes ?? ''} ${prospect.blurb ?? ''} ${(prospect.tags ?? []).join(' ')}`
  if (!text.trim()) return 0
  let total = 0
  for (const { re, bonus } of PITCHER_TRAIT_PATTERNS) {
    if (re.test(text)) total += bonus
  }
  return Math.min(total, PITCHER_TRAIT_CAP)
}

// Used only when no learned weights exist for this org.
const heuristicTalent = (team, prospect) => {
  const t = team.tendencies || {}
  const base = prospect.fv ?? 50
  const levelFit = prospect.level === 'HS'
    ? (t.hs ?? 0.5) * 4 - 2
    : prospect.level === 'College'
      ? (t.college ?? 0.5) * 4 - 2
      : 0
  const sideFit = prospect.tier === 'PIT'
    ? (t.pitcher ?? 0.5) * 3 - 1.5
    : (t.hitter ?? 0.5) * 3 - 1.5
  return base + levelFit + sideFit
}

// ── Top-of-draft BPA / consensus layer (v0.20) ─────────────────────────
/*
 * The learned model under-weights FV once every fit/trait bonus is stacked
 * on (the trained fvNorm coefficient is only ~3.5, so a 10-grade FV gap is
 * a smaller swing than a need + trait combo). Real drafts don't work that
 * way at the very top — picks 1-10 are overwhelmingly best-player-available
 * and hew to the industry consensus board.
 *
 * So we add a pick-dependent layer that is strongest at #1 and fades to zero
 * by ~pick 16, leaving the mid-to-late board exactly as the model had it:
 *
 *   earlyWeight(pick)  1.0 at #1 → 0 by #16 (linear)
 *   fvEmphasis         extra reward per FV grade above 55, scaled by earliness
 *   consensusBonus     reward for sitting near the top of the consensus board
 *   fit damping        need bonus is softened early so fit can't override BPA
 *
 * Signability, positional value, pitcher traits, and the learned utility all
 * stay intact — fit and historical trends are still in the mix, just not
 * allowed to leapfrog a clear consensus talent at the top of the round.
 */
const earlyWeight = (pick) => Math.max(0, Math.min(1, (16 - (pick ?? 60)) / 15))

// Extra FV push, early only. pick 1: 65-FV → +6.0, 60 → +3.0, 50 → -3.0.
const fvEmphasis = (prospect, pick) =>
  ((prospect.fv ?? 50) - 55) * 0.6 * earlyWeight(pick)

// Consensus board pull, early only. pick 1: rk1 → +3.0, rk3 → +2.4, rk5 → +1.8,
// rk10 → +0.3, outside top-10 → 0. Keeps the true top of the board on top.
const consensusBonus = (prospect, pick) => {
  const w = earlyWeight(pick)
  if (w <= 0) return 0
  const topness = Math.max(0, 11 - (prospect.rank ?? 999))
  return topness * 0.30 * w
}

// Soften the (fit) need bonus at the very top so it nudges rather than decides.
// pick 1: 0.5× need, pick 16+: full need. Positional value is left full since
// it is a talent-adjacent premium, not roster fit.
const needDamp = (pick) => 1 - 0.5 * earlyWeight(pick)

// ── Scoring ────────────────────────────────────────────────────────────

export const scoreProspect = (team, prospect) => {
  const pick     = team.pick
  const need     = needBonus(team, prospect) * needDamp(pick)
  const posValue = positionalValueBonus(prospect)
  const trait    = pitcherTraitBonus(prospect)
  const fvEm     = fvEmphasis(prospect, pick)
  const cons     = consensusBonus(prospect, pick)
  const u        = learnedUtility(team, prospect)
  if (u != null) return 55 + u + need + posValue + trait + fvEm + cons
  return heuristicTalent(team, prospect) + need + posValue + trait + fvEm + cons
}

export const hasLearnedWeights = (team) => preferenceVector(team).source != null

export const modelMetrics = modelWeights.metrics
export const modelMeta    = modelWeights._meta

// ── Single mock ────────────────────────────────────────────────────────

/*
 * FV gap floor.
 *
 * When a board has 30+ FV-tied prospects clustered around 40-45, position
 * bonuses + need bonuses can let a rk93 win over a rk50. Prevent that by
 * filtering the candidate pool to only prospects whose FV is within
 * FV_GAP_FLOOR of the best-available FV before scoring. Stops the
 * deep-R2 reach pattern without affecting top-of-round picks where
 * everyone is clustered at high FV anyway.
 */
const FV_GAP_FLOOR = 5

export const pickBestForTeam = (team, available, scorer = scoreProspect) => {
  if (available.length === 0) return { idx: -1, score: -Infinity }
  const bestFV = available.reduce((m, p) => Math.max(m, p.fv ?? 50), -Infinity)
  const floor = bestFV - FV_GAP_FLOOR
  let bestIdx = -1, bestScore = -Infinity
  for (let i = 0; i < available.length; i++) {
    if ((available[i].fv ?? 50) < floor) continue
    const s = scorer(team, available[i])
    if (s > bestScore) { bestScore = s; bestIdx = i }
  }
  // Fallback: should never happen since best-FV candidate is always within floor.
  if (bestIdx === -1) bestIdx = 0
  return { idx: bestIdx, score: bestScore }
}

const greedyDraft = (teams, prospects, scorer) => {
  const available = [...prospects]
  const order = [...teams].sort((a, b) => a.pick - b.pick)
  const picks = []
  for (const team of order) {
    if (available.length === 0) break
    const { idx, score } = pickBestForTeam(team, available, scorer)
    const chosen = available.splice(idx, 1)[0]
    picks.push({ pick: team.pick, team, prospect: chosen, score })
  }
  return picks
}

export const runMock = (teams, prospects) =>
  greedyDraft(teams, prospects, scoreProspect)

// ── Stochastic engine ──────────────────────────────────────────────────

const mulberry32 = (seed) => {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gaussian = (rng) => {
  const u1 = Math.max(rng(), 1e-12)
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

const NOISE = {
  fvSigma: 1.8,
  fitSigma: 0.6,
}

const noisyScore = (team, prospect, rng) => {
  const base = scoreProspect(team, prospect)
  return base + gaussian(rng) * NOISE.fvSigma + gaussian(rng) * NOISE.fitSigma
}

export const runMonteCarlo = (teams, prospects, { n = 1000, seed = 1 } = {}) => {
  const rng = mulberry32(seed)
  const pickDist = {}
  const teamDist = {}
  const pickProspectDist = {}

  for (let run = 0; run < n; run++) {
    const scorer = (team, prospect) => noisyScore(team, prospect, rng)
    const picks = greedyDraft(teams, prospects, scorer)
    for (const { pick, team, prospect } of picks) {
      const pid = prospect.id
      ;(pickDist[pid] ??= {})[pick] = (pickDist[pid][pick] ?? 0) + 1
      ;(teamDist[pid] ??= {})[team.id] = (teamDist[pid][team.id] ?? 0) + 1
      ;(pickProspectDist[pick] ??= {})[pid] = (pickProspectDist[pick][pid] ?? 0) + 1
    }
  }

  const norm = (obj) => {
    const out = {}
    for (const k in obj) out[k] = obj[k] / n
    return out
  }

  const result = { n, pickDist: {}, teamDist: {}, pickProspectDist: {} }
  for (const pid in pickDist)       result.pickDist[pid] = norm(pickDist[pid])
  for (const pid in teamDist)       result.teamDist[pid] = norm(teamDist[pid])
  for (const pn in pickProspectDist) result.pickProspectDist[pn] = norm(pickProspectDist[pn])
  return result
}

// ── Distribution helpers ───────────────────────────────────────────────

export const summarizePickDist = (pickDist) => {
  if (!pickDist) return null
  const entries = Object.entries(pickDist)
    .map(([k, v]) => [parseInt(k, 10), v])
    .sort((a, b) => a[0] - b[0])

  let cum = 0
  let p10 = null, p50 = null, p90 = null
  for (const [pick, prob] of entries) {
    cum += prob
    if (p10 == null && cum >= 0.10) p10 = pick
    if (p50 == null && cum >= 0.50) p50 = pick
    if (p90 == null && cum >= 0.90) p90 = pick
  }
  const sortedByProb = [...entries].sort((a, b) => b[1] - a[1])
  const [mostLikelyPick, mostLikelyProb] = sortedByProb[0] || [null, 0]
  const drafted = entries.reduce((s, [, p]) => s + p, 0)
  const undrafted = Math.max(0, 1 - drafted)
  return { p10, p50, p90, mostLikelyPick, mostLikelyProb, drafted, undrafted }
}

export const topK = (dist, k = 5) => {
  if (!dist) return []
  return Object.entries(dist)
    .sort(([, a], [, b]) => b - a)
    .slice(0, k)
    .map(([key, prob]) => ({ key, prob }))
}
