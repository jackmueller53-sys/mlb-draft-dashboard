#!/usr/bin/env node
/*
 * prep_csv.js
 *
 * Stream-parses data/raw/MLB Draft 2000-2024 CB Picks Fixed.csv (30k picks)
 * and writes scripts/training/picks_2000_2024.jsonl — one normalized pick per
 * line, ready for the nano-trainer.
 *
 * Per pick we extract:
 *   year, round, pick, teamId (3-letter), name, pos (P/H/group),
 *   level (HS/College/JC), school, state, fv (industry FV if mapped),
 *   pickValue (slot), signingBonus, overSlotRatio.
 *
 * Notes:
 *   - team_name → 3-letter code via MLB_TEAM_CODE map.
 *   - school_school_class: 'SR'/'JR'/'SO'/'FR' = College; blank/'HS' = HS.
 *   - 'JC' for junior college, but the dataset doesn't reliably tag JC, so
 *     we fall back to scanning school name for 'JC'/'CC'.
 *   - Pre-2012 there was no formal slot value system (MLB introduced
 *     bonus-pool in 2012). Picks before 2012 have pickValue but it was
 *     advisory; the overSlotRatio interpretation differs.
 *
 * Run: node scripts/training/prep_csv.js
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root      = path.resolve(__dirname, '..', '..')
const inPath    = path.join(root, 'data', 'raw', 'MLB Draft 2000-2024 CB Picks Fixed.csv')
const outPath   = path.join(__dirname, 'picks_2000_2024.jsonl')

// MLB team-name → our id (matches existing historical_picks.json)
const TEAM_CODE = {
  'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CWS',
  'Cincinnati Reds': 'CIN', 'Cleveland Indians': 'CLE', 'Cleveland Guardians': 'CLE',
  'Colorado Rockies': 'COL', 'Detroit Tigers': 'DET', 'Houston Astros': 'HOU',
  'Kansas City Royals': 'KC', 'Los Angeles Angels': 'LAA',
  'Los Angeles Angels of Anaheim': 'LAA', 'Anaheim Angels': 'LAA',
  'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA', 'Florida Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN',
  'New York Mets': 'NYM', 'New York Yankees': 'NYY',
  'Oakland Athletics': 'ATH', 'Athletics': 'ATH',
  'Philadelphia Phillies': 'PHI', 'Pittsburgh Pirates': 'PIT',
  'San Diego Padres': 'SD', 'San Francisco Giants': 'SF',
  'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL',
  'Tampa Bay Rays': 'TB', 'Tampa Bay Devil Rays': 'TB',
  'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR',
  'Washington Nationals': 'WSH', 'Montreal Expos': 'WSH',
}

// Position groups (mirrors simulator.js)
const POS_GROUP = {
  '1B':'CIF','3B':'CIF','IF':'CIF','DH':'CIF',
  '2B':'MIF','SS':'MIF',
  'C':'C',
  'OF':'COF','LF':'COF','RF':'COF',
  'CF':'CF',
  'LHP':'LHP',
  'RHP':'RHP','P':'RHP','SP':'RHP','RP':'RHP','TWP':'RHP',
}

// Column indices from header inspection
const COL = {
  pick_round: 1, pick_number: 2, year: 8, school_name: 9,
  pos_abbr: 56, bat_side: 57, pitch_hand: 59,
  team_id: 62, team_name: 63,
  school_class: 73, pick_value: 75, signing_bonus: 76,
  scouting: 77, blurb: 78, home_state: 83, school_state: 84,
}

// CSV-aware row splitter (handles quoted commas, escaped quotes)
const splitCSVRow = (line) => {
  const out = []
  let cur = '', inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuote = !inQuote
    } else if (c === ',' && !inQuote) {
      out.push(cur); cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

const isCollegeClass = (cls) => /^(FR|SO|JR|SR|GRAD)$/i.test(cls)

const cleanNum = (s) => {
  if (s == null || s === '' || s === 'NA') return null
  const n = Number(String(s).replace(/[$,]/g, ''))
  return isFinite(n) ? n : null
}

// — Parse —
const out = fs.createWriteStream(outPath)
const rl = readline.createInterface({ input: fs.createReadStream(inPath), crlfDelay: Infinity })

let headerSeen = false
let total = 0, kept = 0
const yearCount = {}
const skippedReasons = { noTeam: 0, noPos: 0, noPickNum: 0 }

let pending = ''
for await (const raw of rl) {
  // CSVs may have embedded newlines in quoted fields. Track quote balance.
  const candidate = pending ? pending + '\n' + raw : raw
  const quotes = (candidate.match(/"/g) || []).length
  if (quotes % 2 !== 0) { pending = candidate; continue }
  const line = candidate
  pending = ''
  if (!headerSeen) { headerSeen = true; continue }

  const f = splitCSVRow(line)
  if (f.length < 80) continue
  total += 1

  const teamName = f[COL.team_name]?.trim()
  const teamId = TEAM_CODE[teamName]
  if (!teamId) { skippedReasons.noTeam += 1; continue }

  const year      = Number(f[COL.year])
  const round     = Number(f[COL.pick_round])
  const pickNum   = Number(f[COL.pick_number])
  if (!isFinite(year) || !isFinite(pickNum)) { skippedReasons.noPickNum += 1; continue }
  if (year < 2000 || year > 2024) continue

  const posAbbr   = f[COL.pos_abbr]?.trim() || null
  if (!posAbbr || posAbbr === 'NA') { skippedReasons.noPos += 1; continue }
  const pitchHand = f[COL.pitch_hand]?.trim()

  // Resolve pitcher handedness: split P into LHP / RHP using pitch_hand_code
  let pos = posAbbr
  if (posAbbr === 'P' || posAbbr === 'TWP') {
    if (pitchHand === 'L') pos = 'LHP'
    else if (pitchHand === 'R') pos = 'RHP'
    else pos = 'RHP'  // default if unknown
  }
  const grp = POS_GROUP[pos] ?? null

  const cls = (f[COL.school_class] || '').trim()
  let level
  if (isCollegeClass(cls)) level = 'College'
  else level = 'HS'
  const school = (f[COL.school_name] || '').trim()
  if (/\bJC\b|\bCC\b|community college|junior college/i.test(school)) level = 'JC'

  const pickValue    = cleanNum(f[COL.pick_value])
  const signingBonus = cleanNum(f[COL.signing_bonus])
  const overSlotRatio = (pickValue != null && signingBonus != null && pickValue > 0)
    ? (signingBonus - pickValue) / pickValue : null

  const state = (f[COL.school_state] || f[COL.home_state] || '').trim()

  const record = {
    year, round, pick: pickNum, teamId,
    name: f[5]?.trim() || null,  // person_full_name lives around col 5
    pos, grp, level,
    school: school || null,
    state: state && state !== 'NA' ? state : null,
    pickValue, signingBonus, overSlotRatio,
  }
  out.write(JSON.stringify(record) + '\n')
  kept += 1
  yearCount[year] = (yearCount[year] || 0) + 1
}
out.end()

console.log(`parsed ${total} rows, kept ${kept}, skipped ${total - kept}`)
console.log(`skipped breakdown:`, skippedReasons)
console.log()
console.log('picks per year (kept):')
for (const y of Object.keys(yearCount).sort()) {
  console.log(`  ${y}: ${yearCount[y]}`)
}
