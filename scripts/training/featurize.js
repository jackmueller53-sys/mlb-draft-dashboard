/*
 * Shared featurization for the preference model.
 * Used by both training (Node) and inference (browser, via duplicate state map in simulator.js).
 */

export const PITCHERS = new Set(['RHP', 'LHP', 'P'])

/*
 * Position → group bucket. Seven mutually-exclusive buckets:
 *   posCIF  — corner infield (1B, 3B)
 *   posMIF  — middle infield (2B, SS)
 *   posC    — catcher (its own bucket; defensive value + bat profile is
 *             too distinct from corner IFs to lump in)
 *   posCOF  — corner outfield (any OF that's not explicitly CF)
 *   posCF   — center field (only explicit CF)
 *   posLHP  — left-handed pitcher
 *   posRHP  — right-handed pitcher (also catches generic 'P')
 *
 * Generic IF / 2-way / DH fall back to CIF.
 */
const POS_GROUP = {
  '1B': 'CIF', '3B': 'CIF', 'IF': 'CIF', 'DH': 'CIF',
  '2B': 'MIF', 'SS': 'MIF',
  'C':  'C',
  'OF': 'COF', 'LF': 'COF', 'RF': 'COF',
  'CF': 'CF',
  'LHP': 'LHP',
  'RHP': 'RHP', 'P': 'RHP', 'SP': 'RHP', 'RP': 'RHP',
}

export const posGroupOf = (pos) => POS_GROUP[pos] ?? null

/*
 * Rank/pick → FV proxy. Smooth monotone decay calibrated so the tier means
 * match the old bucket curve (~65 at pick 1, ~60 mid-late R1, ~55 by #20,
 * ~50 by #35, ~45 by #60) but neighboring picks differ by ~0.4 FV instead
 * of being perfectly tied. Combined with the seeded ±1 jitter in
 * featurize(), this produces realistic "consensus FV" — tier ordering is
 * preserved over big gaps but neighbors can shuffle, which is what
 * actually happens on real draft boards.
 */
export const expectedFVByPick = (pick) => {
  const p = Math.max(1, Math.min(pick, 100))
  if (p <= 60) return 67 - (p - 1) * (67 - 45) / 59     // linear 67 → 45
  return 45 - (p - 60) * (45 - 38) / 40                  // 45 → 38 across picks 60-100
}

export const REGION_BY_STATE = {
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

const COLLEGE_STATE = {
  'LSU':'LA', 'Vanderbilt':'TN', 'Florida':'FL', 'Arkansas':'AR',
  'Tennessee':'TN', 'Mississippi State':'MS', 'Ole Miss':'MS',
  'Texas A&M':'TX', 'Texas Tech':'TX', 'Texas':'TX',
  'Wake Forest':'NC', 'NC State':'NC', 'North Carolina':'NC',
  'Virginia':'VA', 'Virginia Tech':'VA',
  'UCLA':'CA', 'Stanford':'CA', 'UC Santa Barbara':'CA',
  'Oregon State':'OR', 'Oregon':'OR',
  'Arizona':'AZ', 'Arizona State':'AZ', 'Grand Canyon':'AZ',
  'Auburn':'AL', 'Alabama':'AL',
  'Georgia':'GA', 'Georgia Tech':'GA',
  'Louisville':'KY', 'Kentucky':'KY',
  'Oklahoma':'OK', 'Oklahoma State':'OK',
  'Coastal Carolina':'SC', 'South Carolina':'SC', 'Clemson':'SC',
  'Maryland':'MD', 'Boston College':'MA', 'Notre Dame':'IN',
  'Kansas State':'KS', 'Sam Houston State':'TX', 'Sam Houston':'TX',
  'Florida State':'FL', 'Florida Atlantic':'FL', 'Miami (OH)':'OH',
  'Cal Poly':'CA', 'Chipola College':'FL', 'West Virginia':'WV',
  'New Mexico State':'NM', 'Eastern Illinois':'IL', 'Illinois':'IL',
  'Minnesota':'MN', 'Duke':'NC', 'East Carolina':'NC',
  'Connecticut':'CT', 'UConn':'CT', 'James Madison':'VA', 'Campbell':'NC',
  'Nebraska':'NE', 'TCU':'TX',
}

/*
 * String → uniform [0,1) → seeded standard normal.
 * 32-bit FNV-1a-style hash, then Box-Muller. Deterministic, same input
 * → same output across runs (Node and browser).
 */
const hash32 = (s) => {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
const seededGaussian = (seedStr) => {
  const u1 = Math.max((hash32(seedStr + '|a') + 1) / 4294967297, 1e-12)
  const u2 = (hash32(seedStr + '|b')) / 4294967296
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

const STATE_REGEX = /\(([A-Z]{2,3})\)/

export const stateFromSchool = (school) => {
  if (!school) return null
  const m = school.match(STATE_REGEX)
  if (m && m[1] !== 'HS') return m[1]
  for (const key of Object.keys(COLLEGE_STATE)) {
    if (school.includes(key)) return COLLEGE_STATE[key]
  }
  return null
}

export const regionFromState = (state) => {
  if (!state) return 'Other'
  return REGION_BY_STATE[state] || 'Other'
}

/*
 * Conference lookup for college picks. Uses pre-2024 alignment for the
 * historical period (matches what was true when most of our training data
 * was drafted). 2024 realignment (USC/UCLA→B1G, Stanford/Cal→ACC,
 * OU/Texas→SEC, Arizona/ASU/Utah→B12, Oregon/Washington→B1G) is recorded as
 * the school's CURRENT bucket — small mislabel risk for 2024-25 picks but
 * acceptable noise.
 */
const CONF_BY_SCHOOL = {
  // SEC (pre-2024 + Oklahoma/Texas joining 2024)
  'LSU': 'SEC', 'Alabama': 'SEC', 'Auburn': 'SEC', 'Florida': 'SEC',
  'Georgia': 'SEC', 'Kentucky': 'SEC', 'Mississippi State': 'SEC',
  'Ole Miss': 'SEC', 'Mississippi': 'SEC', 'South Carolina': 'SEC',
  'Tennessee': 'SEC', 'Texas A&M': 'SEC', 'Vanderbilt': 'SEC',
  'Arkansas': 'SEC', 'Missouri': 'SEC', 'Oklahoma': 'SEC', 'Texas': 'SEC',
  // ACC
  'Boston College': 'ACC', 'Clemson': 'ACC', 'Duke': 'ACC',
  'Florida State': 'ACC', 'Georgia Tech': 'ACC', 'Louisville': 'ACC',
  'Miami': 'ACC', 'NC State': 'ACC', 'North Carolina': 'ACC',
  'Notre Dame': 'ACC', 'Pittsburgh': 'ACC', 'Pitt': 'ACC',
  'Syracuse': 'ACC', 'Virginia': 'ACC', 'Virginia Tech': 'ACC',
  'Wake Forest': 'ACC', 'Stanford': 'ACC', 'California': 'ACC', 'Cal': 'ACC',
  // Big 12 (pre-2024 + 2024 additions)
  'Baylor': 'B12', 'Iowa State': 'B12', 'Kansas': 'B12',
  'Kansas State': 'B12', 'Oklahoma State': 'B12', 'TCU': 'B12',
  'Texas Tech': 'B12', 'West Virginia': 'B12', 'BYU': 'B12',
  'Cincinnati': 'B12', 'UCF': 'B12', 'Houston': 'B12',
  'Arizona': 'B12', 'Arizona State': 'B12', 'Utah': 'B12',
  // Big 10 (pre-2024 + 2024 west-coast additions)
  'Illinois': 'B10', 'Indiana': 'B10', 'Iowa': 'B10', 'Maryland': 'B10',
  'Michigan': 'B10', 'Michigan State': 'B10', 'Minnesota': 'B10',
  'Nebraska': 'B10', 'Northwestern': 'B10', 'Ohio State': 'B10',
  'Penn State': 'B10', 'Purdue': 'B10', 'Rutgers': 'B10', 'Wisconsin': 'B10',
  'USC': 'B10', 'UCLA': 'B10', 'Oregon': 'B10', 'Washington': 'B10',
  // Pac-12 (pre-2024 residual; will hit zero for 2024+ since membership emptied)
  'Oregon State': 'Pac12', 'Washington State': 'Pac12',
}

export const conferenceFromSchool = (school) => {
  if (!school) return 'Other'
  for (const key of Object.keys(CONF_BY_SCHOOL)) {
    if (school.includes(key)) return CONF_BY_SCHOOL[key]
  }
  return 'Other'
}

/*
 * Age proxy. We don't have draft-day age per player, so we infer from level.
 * - HS: ~18 (some reclasses 17, some over-age 19; tighter than reality)
 * - JC: ~19
 * - College: ~21 (most are juniors; some draft-eligible sophs at 20, some
 *   seniors at 22). Single point estimate is intentionally coarse — the
 *   age FEATURE is meant to capture "older = more polished" signal that
 *   the level dummies don't fully express.
 */
export const inferAge = (player) => {
  if (player.level === 'HS') return 18
  if (player.level === 'JC') return 19
  if (player.level === 'College') return 21
  return 21
}

/*
 * featurize(player)
 *
 * Returns the feature vector used by the preference model.
 * Order must match FEATURES below.
 *
 * Accepts both historical-pick records (player.pick is a pick number) and
 * 2026-class prospect records (player has .fv on the 20-80 scale and .state).
 */
export const FEATURES = [
  'isHS', 'isCollege',
  'posCIF', 'posMIF', 'posC', 'posCOF', 'posCF', 'posLHP', 'posRHP',
  'rgnWest', 'rgnSouth', 'rgnMidwest', 'rgnNortheast',
  'ageNorm',
  'confSEC', 'confACC', 'confB12', 'confB10', 'confPac12',
  'fvNorm',
]
export const D = FEATURES.length

export const featurize = (player) => {
  const isHS       = player.level === 'HS' ? 1 : 0
  const isCollege  = player.level === 'College' ? 1 : 0

  const grp     = posGroupOf(player.pos)
  const posCIF  = grp === 'CIF' ? 1 : 0
  const posMIF  = grp === 'MIF' ? 1 : 0
  const posC    = grp === 'C'   ? 1 : 0
  const posCOF  = grp === 'COF' ? 1 : 0
  const posCF   = grp === 'CF'  ? 1 : 0
  const posLHP  = grp === 'LHP' ? 1 : 0
  const posRHP  = grp === 'RHP' ? 1 : 0
  const isCollegeForConf = isCollege   // used below

  const state  = player.state ?? stateFromSchool(player.school)
  const region = regionFromState(state)

  const rgnWest      = region === 'West'      ? 1 : 0
  const rgnSouth     = region === 'South'     ? 1 : 0
  const rgnMidwest   = region === 'Midwest'   ? 1 : 0
  const rgnNortheast = region === 'Northeast' ? 1 : 0

  // age — single continuous feature, centered so 21 (college Jr) → 0
  const age = typeof player.age === 'number' ? player.age : inferAge(player)
  const ageNorm = (age - 21) / 3   // HS=−1, JC=−0.67, College=0, scale ~[-1,1]

  // conference (5 binary features for college picks; HS picks → all zero)
  const conf = isCollegeForConf ? conferenceFromSchool(player.school) : 'Other'
  const confSEC   = conf === 'SEC'   ? 1 : 0
  const confACC   = conf === 'ACC'   ? 1 : 0
  const confB12   = conf === 'B12'   ? 1 : 0
  const confB10   = conf === 'B10'   ? 1 : 0
  const confPac12 = conf === 'Pac12' ? 1 : 0

  /*
   * FV priority:
   *   1. `industryFV`  — pre-draft FV from a public board (best signal;
   *                      genuinely exogenous to where the player ended up
   *                      going). Top-15 of each year 2014-2025 carry this.
   *   2. `fv`          — set for 2026 prospects from MLB Pipeline/ESPN.
   *   3. seeded curve+jitter — proxy for picks deeper than the top-15 where
   *                      we haven't sourced an explicit industry FV. Smooth
   *                      monotone curve + σ=1.0 Gaussian (seeded on
   *                      name|year so same player always gets same FV).
   *                      Decorrelates FV from pick number enough that the
   *                      FV-only baseline can't perfectly cheat.
   */
  let fvRaw
  if (typeof player.industryFV === 'number') {
    fvRaw = player.industryFV
  } else if (typeof player.fv === 'number') {
    fvRaw = player.fv
  } else {
    const baseline = expectedFVByPick(player.pick ?? 60)
    fvRaw = baseline + 1.0 * seededGaussian(`${player.name ?? ''}|${player.year ?? ''}`)
  }
  const fvNorm = (fvRaw - 55) / 10   // centered around 55, scale to roughly [-1, 1]

  return [
    isHS, isCollege,
    posCIF, posMIF, posC, posCOF, posCF, posLHP, posRHP,
    rgnWest, rgnSouth, rgnMidwest, rgnNortheast,
    ageNorm,
    confSEC, confACC, confB12, confB10, confPac12,
    fvNorm,
  ]
}
