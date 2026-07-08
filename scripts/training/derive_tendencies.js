#!/usr/bin/env node
/*
 * derive_tendencies.js
 *
 * Reads scripts/training/historical_picks.json (2020-2025 first-round picks).
 * For each MLB organization, derives:
 *   - level rate         : hs vs college share
 *   - side rate          : pitcher vs hitter share
 *   - region lean        : West / South / Midwest / Northeast share (school state)
 *   - avgPickFV          : average expected-FV of players taken (rank-bucket proxy)
 *   - fvFlex             : average (actual_FV - expected_FV_at_pick). Negative = "reaches"
 *                          for signability / under-slot; positive = "surprises" by taking
 *                          higher-graded players than slot would suggest.
 *   - riskTolerance      : derived from HS bias (HS = riskier proxy)
 *
 * Writes the derived tendencies back into src/data/teams.json. Preserves
 * everything except the `tendencies` block + `notes` + `learnedFromPicks`.
 * Also attaches richer fields under `tendencies` itself so the simulator
 * can opt into them later without breaking older entries.
 *
 * Run:
 *   node scripts/training/derive_tendencies.js
 *
 * NOTE: this is still aggregate stat extraction, not a per-pick logistic
 * preference model. But the feature surface — FV bucketing, region, flex —
 * is now what a real model would need to train.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root      = path.resolve(__dirname, '..', '..')
const historyP  = path.join(__dirname, 'historical_picks.json')
const teamsP    = path.join(root, 'src', 'data', 'teams.json')

const history = JSON.parse(fs.readFileSync(historyP, 'utf8'))
const teams   = JSON.parse(fs.readFileSync(teamsP, 'utf8'))

const PITCHERS = new Set(['RHP', 'LHP', 'P'])

// ── Feature engineering ─────────────────────────────────────────────────

// Expected FV at a given pick number (rough curve from public draft boards).
const expectedFVByPick = (pick) => {
  if (pick <= 3)  return 65
  if (pick <= 10) return 60
  if (pick <= 20) return 55
  if (pick <= 35) return 50
  if (pick <= 60) return 45
  return 40
}

// Synthetic FV for an actual pick — same curve. Real impl would use
// the player's draft-day FV from a board (BA, MLB Pipeline).
const syntheticFV = (pick) => expectedFVByPick(pick)

// Pull a US state code from the school string, e.g. "Stillwater HS (OK)".
const stateRegex = /\(([A-Z]{2,3})\)$/
const stateFromSchool = (school) => {
  const m = school.match(stateRegex)
  if (m && m[1] !== 'HS') return m[1]  // guard against "HS" being captured
  // College fallback — small dictionary of common programs.
  const COLLEGE_STATE = {
    'LSU': 'LA', 'Vanderbilt': 'TN', 'Florida': 'FL', 'Arkansas': 'AR',
    'Tennessee': 'TN', 'Mississippi State': 'MS', 'Ole Miss': 'MS',
    'Texas A&M': 'TX', 'Texas Tech': 'TX', 'Texas': 'TX',
    'Wake Forest': 'NC', 'NC State': 'NC', 'North Carolina': 'NC',
    'Virginia': 'VA', 'Virginia Tech': 'VA',
    'UCLA': 'CA', 'Stanford': 'CA', 'UC Santa Barbara': 'CA',
    'Oregon State': 'OR', 'Oregon': 'OR',
    'Arizona': 'AZ', 'Arizona State': 'AZ', 'Grand Canyon': 'AZ',
    'Auburn': 'AL', 'Alabama': 'AL',
    'Georgia': 'GA', 'Georgia Tech': 'GA',
    'Louisville': 'KY', 'Kentucky': 'KY',
    'Oklahoma': 'OK', 'Oklahoma State': 'OK',
    'Coastal Carolina': 'SC', 'South Carolina': 'SC', 'Clemson': 'SC',
    'Maryland': 'MD',
    'Boston College': 'MA',
    'Notre Dame': 'IN',
    'Kansas State': 'KS',
    'Sam Houston State': 'TX', 'Sam Houston': 'TX',
    'Florida State': 'FL', 'Florida Atlantic': 'FL', 'Miami (OH)': 'OH',
    'Cal Poly': 'CA',
    'Chipola College': 'FL',
    'West Virginia': 'WV',
    'New Mexico State': 'NM',
    'Eastern Illinois': 'IL', 'Illinois': 'IL',
    'Minnesota': 'MN',
    'Duke': 'NC',
    'East Carolina': 'NC',
    'Connecticut': 'CT', 'UConn': 'CT',
    'James Madison': 'VA', 'Campbell': 'NC',
    'Oklahoma': 'OK',
    'Nebraska': 'NE',
    'TCU': 'TX',
  }
  for (const key of Object.keys(COLLEGE_STATE)) {
    if (school.includes(key)) return COLLEGE_STATE[key]
  }
  return null
}

const REGION_BY_STATE = {
  // West
  WA: 'West', OR: 'West', CA: 'West', NV: 'West', AZ: 'West', UT: 'West',
  CO: 'West', ID: 'West', MT: 'West', WY: 'West', AK: 'West', HI: 'West', NM: 'West',
  // South
  TX: 'South', OK: 'South', AR: 'South', LA: 'South', MS: 'South',
  TN: 'South', AL: 'South', GA: 'South', FL: 'South', SC: 'South',
  NC: 'South', VA: 'South', WV: 'South', KY: 'South',
  // Midwest
  IL: 'Midwest', IN: 'Midwest', OH: 'Midwest', MI: 'Midwest', WI: 'Midwest',
  MN: 'Midwest', IA: 'Midwest', MO: 'Midwest', KS: 'Midwest', NE: 'Midwest',
  ND: 'Midwest', SD: 'Midwest',
  // Northeast
  NY: 'Northeast', NJ: 'Northeast', PA: 'Northeast', MA: 'Northeast',
  CT: 'Northeast', RI: 'Northeast', NH: 'Northeast', VT: 'Northeast',
  ME: 'Northeast', MD: 'Northeast', DE: 'Northeast', DC: 'Northeast',
}

const regionFromSchool = (school) => {
  const st = stateFromSchool(school)
  if (!st) return 'Other'
  return REGION_BY_STATE[st] || 'Other'
}

// ── Aggregate ───────────────────────────────────────────────────────────

const stats = {}  // orgId -> { picks: [], hs, col, pit, hit, regions, fvSum, flexSum }
for (const p of history.picks) {
  const id = p.teamId
  if (!stats[id]) {
    stats[id] = {
      picks: [], hs: 0, col: 0, pit: 0, hit: 0,
      regions: {}, fvSum: 0, flexSum: 0,
    }
  }
  const s = stats[id]
  s.picks.push(p)
  if (p.level === 'HS')      s.hs += 1
  else if (p.level === 'College') s.col += 1
  if (PITCHERS.has(p.pos)) s.pit += 1
  else                     s.hit += 1

  const region = regionFromSchool(p.school)
  s.regions[region] = (s.regions[region] || 0) + 1

  const fv  = syntheticFV(p.pick)
  const exp = expectedFVByPick(p.pick)
  s.fvSum   += fv
  s.flexSum += (fv - exp)
}

// ── Derive ──────────────────────────────────────────────────────────────

const tendenciesByOrg = {}
const noteByOrg       = {}
for (const id in stats) {
  const s     = stats[id]
  const total = s.picks.length
  const known = s.hs + s.col

  const hs       = known ? s.hs / known : 0.5
  const college  = known ? s.col / known : 0.5
  const pitcher  = total ? s.pit / total : 0.5
  const hitter   = total ? s.hit / total : 0.5

  const regionShare = {}
  for (const r of ['West', 'South', 'Midwest', 'Northeast', 'Other']) {
    regionShare[r] = round2((s.regions[r] || 0) / total)
  }
  const dominantRegion = Object.entries(regionShare)
    .filter(([r]) => r !== 'Other')
    .sort(([, a], [, b]) => b - a)[0]?.[0] ?? null

  const avgPickFV = round2(s.fvSum / total)
  const fvFlex    = round2(s.flexSum / total)

  // HS share is the simplest "risk" proxy; flex layers on the "reach" tendency.
  const riskTolerance = round2(0.4 + hs * 0.4)

  tendenciesByOrg[id] = {
    hs: round2(hs),
    college: round2(college),
    pitcher: round2(pitcher),
    hitter: round2(hitter),
    riskTolerance,
    avgPickFV,
    fvFlex,
    regionShare,
    dominantRegion,
  }

  // Auto-note
  const fragments = [`${total} R1 picks 2020-25`]
  if (hs >= 0.66)        fragments.push('HS-heavy')
  else if (hs <= 0.33)   fragments.push('college-heavy')
  if (pitcher >= 0.6)    fragments.push('pitcher lean')
  else if (hitter >= 0.7) fragments.push('hitter lean')
  if (dominantRegion && regionShare[dominantRegion] >= 0.4) {
    fragments.push(`${dominantRegion} pipeline`)
  }
  noteByOrg[id] = fragments.join(' · ')
}

// ── Merge ───────────────────────────────────────────────────────────────

let mergedCount = 0
for (const team of teams.teams) {
  // strip -S and -R2 to get base org id
  const orgId = team.id.replace(/-(S|R2)$/, '')
  const d = tendenciesByOrg[orgId]
  if (!d) continue
  team.tendencies = {
    ...team.tendencies,
    hs: d.hs,
    college: d.college,
    pitcher: d.pitcher,
    hitter: d.hitter,
    riskTolerance: d.riskTolerance,
    avgPickFV: d.avgPickFV,
    fvFlex: d.fvFlex,
    regionShare: d.regionShare,
    dominantRegion: d.dominantRegion,
  }
  team.learnedFromPicks = stats[orgId].picks.length
  // Preserve "Round 2 · …" prefix if present
  const prefix = team.round === 2 ? 'Round 2 · ' : ''
  team.notes = prefix + noteByOrg[orgId]
  mergedCount += 1
}

teams._meta = teams._meta || {}
teams._meta.tendenciesSource     = '2020-2025 first-round picks (Wikipedia)'
teams._meta.tendenciesGeneratedAt = new Date().toISOString().slice(0, 10)
teams._meta.tendenciesScript      = 'scripts/training/derive_tendencies.js'
teams._meta.tendencyFeatures      = ['hs', 'college', 'pitcher', 'hitter', 'riskTolerance', 'avgPickFV', 'fvFlex', 'regionShare', 'dominantRegion']

fs.writeFileSync(teamsP, JSON.stringify(teams, null, 2) + '\n', 'utf8')

// ── Report ──────────────────────────────────────────────────────────────

console.log(`learned tendencies for ${Object.keys(tendenciesByOrg).length} organizations`)
console.log(`merged into ${mergedCount} team entries (R1 + supp + R2)`)
console.log()
console.log('  org | n | HS%  | C%   | P%   | H%   | avgFV | flex  | region')
console.log('  ----+---+------+------+------+------+-------+-------+----------')
const ids = Object.keys(tendenciesByOrg).sort()
for (const id of ids) {
  const t = tendenciesByOrg[id]
  const n = stats[id].picks.length
  console.log(
    `  ${id.padEnd(3)} | ${String(n).padStart(2)} | ${pct(t.hs)} | ${pct(t.college)} | ${pct(t.pitcher)} | ${pct(t.hitter)} | ${String(t.avgPickFV).padStart(5)} | ${String(t.fvFlex >= 0 ? '+' + t.fvFlex : t.fvFlex).padStart(5)} | ${(t.dominantRegion ?? '—').padEnd(9)} (${pct(t.regionShare[t.dominantRegion] ?? 0).trim()})`
  )
}

function round2(n) { return Math.round(n * 100) / 100 }
function pct(n) { return (Math.round(n * 100) + '%').padStart(4) }
