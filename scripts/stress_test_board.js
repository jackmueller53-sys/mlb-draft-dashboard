#!/usr/bin/env node
/*
 * stress_test_board.js
 *
 * Guards src/data/prospects.json against the class of bug that let Jared
 * Grindlinger — a consensus first-round talent — silently vanish from the
 * board. The site has no talent "model" that can dislike a player: the
 * simulator and big board can only ever rank players that exist in this
 * file, so an omitted prospect is invisible, never "unranked."
 *
 * Two layers of checks:
 *
 *   1. Structural integrity
 *        - ranks are contiguous 1..N with no gaps or duplicates
 *        - ids are unique and satisfy the id === `p{rank}` invariant
 *        - every prospect carries the fields the UI + simulator read
 *          (name, pos, tier, level, state, fv, signability) with sane values
 *
 *   2. Consensus coverage
 *        - an independent list of publicly consensus top-of-board 2026
 *          prospects must ALL appear (name-normalized). This is the check
 *          that would have flagged Grindlinger's absence.
 *
 * Exit code is non-zero on any hard failure so it can gate a build / CI.
 *
 *   node scripts/stress_test_board.js
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dirname, '..', 'src', 'data', 'prospects.json')

// ── name normalization (accents, suffixes, punctuation, case) ──────────
const normalize = (name) =>
  name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')          // strip suffixes
    .replace(/[^a-z0-9]+/g, ' ')                        // punctuation -> space
    .trim()

/*
 * Independent consensus reference. These are widely-agreed top 2026 draft
 * prospects drawn from the public boards cited in prospects.json._meta
 * (MLB Pipeline, ESPN/Kiley McDaniel, Baseball America, Baseball
 * Prospectus). Every one MUST be present on the board; a miss is a real
 * omission, not a ranking opinion.
 */
const CONSENSUS_MUST_APPEAR = [
  'Roch Cholowsky', 'Grady Emerson', 'Vahn Lackey', 'Jacob Lombard',
  'Jackson Flora', 'Eric Booth Jr.', 'Drew Burress', 'Chris Hacopian',
  'Gio Rojas', 'Ryder Helfrick', 'Cameron Flukey', 'Derek Curiel',
  'Ace Reese', 'Jared Grindlinger', 'Liam Peterson', 'Tyler Bell',
  'Justin Lebron', 'Trevor Condon', 'Sawyer Strosnider', 'Bo Lowrance',
  'Brody Bumila', 'Archer Horn',
]

const REQUIRED_FIELDS = ['name', 'pos', 'tier', 'level', 'state', 'fv', 'signability']
const VALID_TIERS = new Set(['HIT', 'PIT'])
const VALID_LEVELS = new Set(['HS', 'College'])

const errors = []
const warnings = []
const fail = (m) => errors.push(m)
const warn = (m) => warnings.push(m)

const raw = JSON.parse(readFileSync(DATA, 'utf8'))
const players = raw.prospects ?? []

if (players.length === 0) fail('board is empty')

// ── 1. structural integrity ────────────────────────────────────────────
const ranks = players.map(p => p.rank)
const N = players.length
const expected = Array.from({ length: N }, (_, i) => i + 1)
const rankSet = new Set(ranks)

for (const r of expected) {
  if (!rankSet.has(r)) fail(`missing rank #${r} (board has a gap — a prospect is absent)`)
}
if (rankSet.size !== ranks.length) {
  const seen = new Set(), dupes = new Set()
  for (const r of ranks) { if (seen.has(r)) dupes.add(r); seen.add(r) }
  fail(`duplicate rank(s): ${[...dupes].join(', ')}`)
}

const idSet = new Set()
for (const p of players) {
  if (idSet.has(p.id)) fail(`duplicate id: ${p.id}`)
  idSet.add(p.id)
  if (p.id !== `p${String(p.rank).padStart(2, '0')}`)
    fail(`id/rank mismatch: ${p.id} at rank ${p.rank} (expected p${String(p.rank).padStart(2, '0')})`)

  for (const f of REQUIRED_FIELDS)
    if (p[f] === undefined || p[f] === null || p[f] === '')
      fail(`${p.name ?? p.id}: missing field "${f}"`)

  if (p.tier && !VALID_TIERS.has(p.tier)) fail(`${p.name}: bad tier "${p.tier}"`)
  if (p.level && !VALID_LEVELS.has(p.level)) fail(`${p.name}: bad level "${p.level}"`)
  if (typeof p.fv === 'number' && (p.fv < 20 || p.fv > 80))
    fail(`${p.name}: fv ${p.fv} outside 20-80 scale`)

  // top-30 are expected to carry scouting copy like their board-mates
  if (p.rank <= 30 && (!p.blurb || !p.scoutingNotes))
    warn(`${p.name} (#${p.rank}): top-30 prospect missing blurb/scoutingNotes`)
}

// ── 2. consensus coverage ──────────────────────────────────────────────
const boardIndex = new Map(players.map(p => [normalize(p.name), p]))
for (const name of CONSENSUS_MUST_APPEAR) {
  if (!boardIndex.has(normalize(name)))
    fail(`consensus prospect absent from board: "${name}"`)
}

// ── report ─────────────────────────────────────────────────────────────
console.log(`Stress test: ${N} prospects, ranks 1..${N}`)
console.log(`Consensus reference checked: ${CONSENSUS_MUST_APPEAR.length} names`)
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`)
  for (const w of warnings) console.log(`  ⚠ ${w}`)
}
if (errors.length) {
  console.log(`\n${errors.length} FAILURE(S):`)
  for (const e of errors) console.log(`  ✗ ${e}`)
  process.exit(1)
}
console.log('\n✓ All checks passed — every consensus top prospect appears on the board.')
