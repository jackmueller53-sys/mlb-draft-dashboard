#!/usr/bin/env node
/*
 * aggregate_outcomes.js
 *
 * Reads historical_picks.json + front_offices.json. For each FO regime,
 * tallies outcome categories across their picks (where outcome is set) and
 * computes:
 *   - counts:  star / regular / fringe / bust / tbd / unrated
 *   - hitRate: (star + regular) / rated picks
 *   - score:   weighted avg (star=4, regular=2, fringe=1, bust=0) / rated picks
 *   - sampleN: rated pick count
 *
 * Writes scripts/training/draft_value.json — consumed by the UI to surface
 * per-regime "draft-day value" on team profiles.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveFO, regimeById } from './resolve_fo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const historyP  = path.join(__dirname, 'historical_picks.json')
const outP      = path.join(__dirname, 'draft_value.json')

const history = JSON.parse(fs.readFileSync(historyP, 'utf8'))

const SCORE = { star: 4, regular: 2, fringe: 1, bust: 0 }

const stats = {}
for (const p of history.picks) {
  const foId = resolveFO(p.teamId, p.year)
  if (!foId) continue
  const o = p.outcome
  if (!stats[foId]) {
    stats[foId] = { foId, name: regimeById[foId]?.name ?? foId,
      star: 0, regular: 0, fringe: 0, bust: 0, tbd: 0, unrated: 0,
      sumScore: 0, sampleN: 0, exemplars: { star: [], bust: [] } }
  }
  const s = stats[foId]
  if (o === 'star')         { s.star += 1;    s.sumScore += SCORE.star;    s.sampleN += 1; s.exemplars.star.push(p.name) }
  else if (o === 'regular') { s.regular += 1; s.sumScore += SCORE.regular; s.sampleN += 1 }
  else if (o === 'fringe')  { s.fringe += 1;  s.sumScore += SCORE.fringe;  s.sampleN += 1 }
  else if (o === 'bust')    { s.bust += 1;    s.sumScore += SCORE.bust;    s.sampleN += 1; s.exemplars.bust.push(p.name) }
  else if (o === 'tbd')     { s.tbd += 1 }
  else                      { s.unrated += 1 }
}

const out = {
  _meta: {
    note: 'Per-FO draft-value rating. Scale: star=4, regular=2, fringe=1, bust=0. Avg across rated picks. Sample is top 15 of 2014-2020 (or whichever of those were picked by that FO).',
    generatedAt: new Date().toISOString().slice(0, 10),
    scale: SCORE,
  },
  perFO: {},
}

console.log()
console.log('  Regime                n   ★    R    F    B    avg   verdict')
console.log('  ────────────────────  ──  ──   ──   ──   ──   ────  ────────')
const ordered = Object.values(stats).sort((a, b) => {
  if (a.sampleN >= 3 && b.sampleN >= 3) {
    return (b.sumScore / b.sampleN) - (a.sumScore / a.sampleN)
  }
  return b.sampleN - a.sampleN
})
for (const s of ordered) {
  const avg = s.sampleN ? s.sumScore / s.sampleN : null
  const verdict = avg == null || s.sampleN < 3 ? '—' : verdictFor(avg)
  out.perFO[s.foId] = {
    name: s.name,
    sampleN: s.sampleN,
    counts: { star: s.star, regular: s.regular, fringe: s.fringe, bust: s.bust, tbd: s.tbd, unrated: s.unrated },
    avgScore: avg != null ? Math.round(avg * 100) / 100 : null,
    verdict,
    exemplars: {
      star: s.exemplars.star.slice(0, 3),
      bust: s.exemplars.bust.slice(0, 3),
    },
  }
  if (s.sampleN > 0) {
    console.log(`  ${s.name.padEnd(20)}  ${String(s.sampleN).padStart(2)}  ${String(s.star).padStart(2)}   ${String(s.regular).padStart(2)}   ${String(s.fringe).padStart(2)}   ${String(s.bust).padStart(2)}   ${avg != null ? avg.toFixed(2).padStart(4) : '   —'}  ${verdict}`)
  }
}

fs.writeFileSync(outP, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log()
console.log(`saved ${outP}`)

function verdictFor(avg) {
  if (avg >= 2.5) return 'STRONG'
  if (avg >= 1.8) return 'ABOVE-AVG'
  if (avg >= 1.2) return 'AVERAGE'
  if (avg >= 0.7) return 'BELOW-AVG'
  return 'POOR'
}
