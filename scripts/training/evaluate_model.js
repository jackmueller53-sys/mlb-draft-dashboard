#!/usr/bin/env node
/*
 * evaluate_model.js
 *
 * Honest accuracy evaluation for the FO-aware preference model.
 *
 *   1. Leave-one-year-out cross-validation:
 *        for each year Y in 2014-2025:
 *          train on all picks NOT in year Y
 *          predict each pick in year Y; record rank of observed pick
 *          report held-out NLL, top-K accuracy
 *
 *   2. Naive baselines for comparison:
 *        uniform        - P(j) = 1/|pool|
 *        FV-only        - score = fvNorm; no team / FO preference
 *        FO-mean (R1)   - score = β_global only; per-regime δ ignored
 *
 *   3. Per-FO confidence verdict:
 *        - sample size in training
 *        - held-out top-3 accuracy (when that regime had a held-out pick)
 *        - "verdict": GREEN (n>=10), AMBER (5-9), RED (<5)
 *
 * Writes:
 *   scripts/training/model_eval.json — summary + per-regime CV results
 *
 * Run:
 *   node scripts/training/evaluate_model.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { featurize, FEATURES, D } from './featurize.js'
import { resolveFO, regimeById } from './resolve_fo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const historyP  = path.join(__dirname, 'historical_picks.json')
const outP      = path.join(__dirname, 'model_eval.json')

const history = JSON.parse(fs.readFileSync(historyP, 'utf8'))

// ── Featurize once ─────────────────────────────────────────────────────
const byYear = {}
for (const p of history.picks) {
  if (!byYear[p.year]) byYear[p.year] = []
  byYear[p.year].push(p)
  p._fo = resolveFO(p.teamId, p.year)
}
for (const y of Object.keys(byYear)) {
  byYear[y].sort((a, b) => a.pick - b.pick)
  for (const p of byYear[y]) p._x = featurize(p)
}

const years = Object.keys(byYear).map(Number).sort((a, b) => a - b)

// ── Training routine (returns {betaGlobal, betaFO}) ────────────────────
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

const trainOnYears = (trainYears, opts = {}) => {
  const { iterations = 600, lr = 0.5, lambda = 10.0 } = opts
  const events = []
  for (const y of trainYears) {
    const picks = byYear[y]
    for (let i = 0; i < picks.length; i++) {
      const fo = picks[i]._fo
      if (!fo) continue
      events.push({ foId: fo, pool: picks.slice(i) })
    }
  }
  const foIds = [...new Set(events.map(e => e.foId))]
  const betaGlobal = new Array(D).fill(0)
  const betaFO = {}
  for (const id of foIds) betaFO[id] = new Array(D).fill(0)

  for (let iter = 0; iter < iterations; iter++) {
    const gradGlobal = new Array(D).fill(0)
    const gradFO = {}
    for (const id of foIds) gradFO[id] = new Array(D).fill(0)
    for (const ev of events) {
      const fo = ev.foId
      const eff = new Array(D)
      for (let k = 0; k < D; k++) eff[k] = betaGlobal[k] + betaFO[fo][k]
      let maxS = -Infinity
      const scores = ev.pool.map(p => { const s = dot(eff, p._x); if (s > maxS) maxS = s; return s })
      const exps = scores.map(s => Math.exp(s - maxS))
      const sumE = exps.reduce((a, b) => a + b, 0)
      const probs = exps.map(e => e / sumE)
      const expectedX = new Array(D).fill(0)
      for (let j = 0; j < ev.pool.length; j++) {
        const xj = ev.pool[j]._x
        for (let k = 0; k < D; k++) expectedX[k] += probs[j] * xj[k]
      }
      const obsX = ev.pool[0]._x
      for (let k = 0; k < D; k++) {
        const g = expectedX[k] - obsX[k]
        gradGlobal[k] += g
        gradFO[fo][k] += g
      }
    }
    for (const id of foIds) {
      for (let k = 0; k < D; k++) gradFO[id][k] += 2 * lambda * betaFO[id][k]
    }
    const invN = 1 / events.length
    for (let k = 0; k < D; k++) betaGlobal[k] -= lr * gradGlobal[k] * invN
    for (const id of foIds) {
      for (let k = 0; k < D; k++) betaFO[id][k] -= lr * gradFO[id][k] * invN
    }
  }
  return { betaGlobal, betaFO, foIds }
}

// ── Prediction routine ─────────────────────────────────────────────────
const predictOnYear = (year, { betaGlobal, betaFO }) => {
  const picks = byYear[year]
  const events = []
  for (let i = 0; i < picks.length; i++) {
    if (!picks[i]._fo) continue
    events.push({ foId: picks[i]._fo, pool: picks.slice(i) })
  }
  const result = { events: 0, ranks: [], nll: 0, top1: 0, top3: 0, top5: 0 }
  for (const ev of events) {
    const fo = ev.foId
    const fallback = !betaFO[fo]
    const eff = new Array(D)
    for (let k = 0; k < D; k++) eff[k] = betaGlobal[k] + (fallback ? 0 : betaFO[fo][k])

    let maxS = -Infinity
    const scores = ev.pool.map(p => { const s = dot(eff, p._x); if (s > maxS) maxS = s; return s })
    const exps = scores.map(s => Math.exp(s - maxS))
    const sumE = exps.reduce((a, b) => a + b, 0)
    const probs = exps.map(e => e / sumE)

    const obsProb = probs[0]
    result.nll -= Math.log(Math.max(obsProb, 1e-12))

    /*
     * Average-rank handling: when multiple candidates have the same
     * probability (very common with the synthetic FV-by-pick curve, where
     * whole tiers tie), give the observed pick the AVERAGE rank of all
     * tied candidates. Otherwise a stable sort gives pool[0] an unfair
     * "always first" benefit when in fact the model can't distinguish it
     * from its tier.
     */
    const order = probs
      .map((p, j) => ({ j, p }))
      .sort((a, b) => b.p - a.p)
    // Find observed's position in sorted order
    const obsIdx = order.findIndex(o => o.j === 0)
    // Find all tied candidates with same prob as observed
    const tiedIdxs = []
    for (let i = 0; i < order.length; i++) {
      if (Math.abs(order[i].p - obsProb) < 1e-9) tiedIdxs.push(i + 1)  // 1-indexed
    }
    const rank = tiedIdxs.reduce((s, r) => s + r, 0) / tiedIdxs.length

    result.ranks.push({ year, fo, rank, fallback })
    result.events += 1
    if (rank <= 1) result.top1 += 1
    if (rank <= 3) result.top3 += 1
    if (rank <= 5) result.top5 += 1
  }
  return result
}

// ── 1. Leave-one-year-out CV ──────────────────────────────────────────
console.log('=== Leave-one-year-out cross-validation ===')
console.log()
const cvByYear = {}
const cvAll = { events: 0, top1: 0, top3: 0, top5: 0, nll: 0, allRanks: [] }
for (const yHeld of years) {
  const trainYears = years.filter(y => y !== yHeld)
  process.stdout.write(`  training on ${trainYears.length} years, holding out ${yHeld}… `)
  const model = trainOnYears(trainYears, { iterations: 600 })
  const result = predictOnYear(yHeld, model)
  cvByYear[yHeld] = result
  cvAll.events += result.events
  cvAll.top1   += result.top1
  cvAll.top3   += result.top3
  cvAll.top5   += result.top5
  cvAll.nll    += result.nll
  for (const r of result.ranks) cvAll.allRanks.push(r)
  console.log(`n=${result.events}, top-3=${(100 * result.top3 / result.ranks.length).toFixed(0)}%`)
}
console.log()
console.log('Held-out summary across all years:')
console.log(`  events:      ${cvAll.events}`)
console.log(`  NLL:         ${cvAll.nll.toFixed(2)}`)
console.log(`  top-1:       ${(100 * cvAll.top1 / cvAll.events).toFixed(1)}%`)
console.log(`  top-3:       ${(100 * cvAll.top3 / cvAll.events).toFixed(1)}%`)
console.log(`  top-5:       ${(100 * cvAll.top5 / cvAll.events).toFixed(1)}%`)

const fallbackEvents = cvAll.allRanks.filter(r => r.fallback).length
console.log(`  fallback to global-mean (no held-out regime weights): ${fallbackEvents} of ${cvAll.events}`)
console.log()

// ── 2. Baselines ──────────────────────────────────────────────────────
console.log('=== Baseline comparisons ===')
console.log()

// Uniform-pick: P = 1/|pool|; expected NLL = Σ log(pool_size)
let unifNLL = 0, unifTop3 = 0, unifTop5 = 0, unifEvents = 0
for (const y of years) {
  for (let i = 0; i < byYear[y].length; i++) {
    if (!byYear[y][i]._fo) continue
    const poolSize = byYear[y].length - i
    unifNLL += Math.log(poolSize)
    unifEvents += 1
    if (poolSize >= 3 && Math.random() < 3 / poolSize) {/* expectation; report exact below */}
  }
}
// Exact uniform top-K rates:
let uTop1 = 0, uTop3 = 0, uTop5 = 0
for (const y of years) {
  for (let i = 0; i < byYear[y].length; i++) {
    if (!byYear[y][i]._fo) continue
    const ps = byYear[y].length - i
    uTop1 += 1 / ps
    uTop3 += Math.min(3, ps) / ps
    uTop5 += Math.min(5, ps) / ps
  }
}
console.log(`Uniform baseline:`)
console.log(`  NLL:    ${unifNLL.toFixed(2)}`)
console.log(`  top-1:  ${(100 * uTop1 / unifEvents).toFixed(1)}%`)
console.log(`  top-3:  ${(100 * uTop3 / unifEvents).toFixed(1)}%`)
console.log(`  top-5:  ${(100 * uTop5 / unifEvents).toFixed(1)}%`)
console.log()

// FV-only: train, then zero out non-FV coefficients
const fvOnly = trainOnYears(years, { iterations: 400 })
const fvIdx = FEATURES.indexOf('fvNorm')
for (let k = 0; k < D; k++) if (k !== fvIdx) fvOnly.betaGlobal[k] = 0
for (const id in fvOnly.betaFO) {
  for (let k = 0; k < D; k++) if (k !== fvIdx) fvOnly.betaFO[id][k] = 0
}
let fvNLL = 0, fvTop1 = 0, fvTop3 = 0, fvTop5 = 0, fvEvents = 0
for (const y of years) {
  const r = predictOnYear(y, fvOnly)
  fvNLL += r.nll; fvTop1 += r.top1; fvTop3 += r.top3; fvTop5 += r.top5; fvEvents += r.events
}
console.log(`FV-only baseline (talent ranking; tie-broken):`)
console.log(`  NLL:    ${fvNLL.toFixed(2)}  (vs uniform ${unifNLL.toFixed(2)}, vs CV ${cvAll.nll.toFixed(2)})`)
console.log(`  top-1:  ${(100 * fvTop1 / fvEvents).toFixed(1)}%`)
console.log(`  top-3:  ${(100 * fvTop3 / fvEvents).toFixed(1)}%`)
console.log(`  top-5:  ${(100 * fvTop5 / fvEvents).toFixed(1)}%`)
console.log()

// No-FV CV: pure team-preference signal (level + region only)
// Train without using fvNorm coefficient at all.
console.log('=== No-FV CV (pure team-preference signal) ===')
let noFvAll = { events: 0, top1: 0, top3: 0, top5: 0, nll: 0 }
for (const yHeld of years) {
  const trainYears = years.filter(y => y !== yHeld)
  const model = trainOnYears(trainYears, { iterations: 600 })
  model.betaGlobal[fvIdx] = 0
  for (const id in model.betaFO) model.betaFO[id][fvIdx] = 0
  const r = predictOnYear(yHeld, model)
  noFvAll.events += r.events
  noFvAll.top1   += r.top1
  noFvAll.top3   += r.top3
  noFvAll.top5   += r.top5
  noFvAll.nll    += r.nll
}
console.log(`  NLL:    ${noFvAll.nll.toFixed(2)}`)
console.log(`  top-1:  ${(100 * noFvAll.top1 / noFvAll.events).toFixed(1)}%`)
console.log(`  top-3:  ${(100 * noFvAll.top3 / noFvAll.events).toFixed(1)}%`)
console.log(`  top-5:  ${(100 * noFvAll.top5 / noFvAll.events).toFixed(1)}%`)
console.log(`  ↑ lift over uniform top-3: +${(100 * (noFvAll.top3 / noFvAll.events - uTop3 / unifEvents)).toFixed(1)} pts`)
console.log()

// ── 3. Per-FO verdict ─────────────────────────────────────────────────
console.log('=== Per-FO confidence verdict ===')
console.log()
const foStats = {}
for (const p of history.picks) {
  if (!p._fo) continue
  if (!foStats[p._fo]) foStats[p._fo] = { id: p._fo, name: regimeById[p._fo]?.name ?? p._fo, n: 0, cvRanks: [] }
  foStats[p._fo].n += 1
}
for (const r of cvAll.allRanks) {
  if (foStats[r.fo]) foStats[r.fo].cvRanks.push(r.rank)
}
const verdicts = []
for (const fo of Object.values(foStats)) {
  const n = fo.n
  const cvN = fo.cvRanks.length
  const top3 = cvN ? fo.cvRanks.filter(r => r <= 3).length / cvN : null
  let verdict
  if (n >= 10) verdict = 'GREEN'
  else if (n >= 5) verdict = 'AMBER'
  else verdict = 'RED'
  verdicts.push({ id: fo.id, name: fo.name, n, cvN, cvTop3: top3, verdict })
}
verdicts.sort((a, b) => b.n - a.n)
console.log('  Regime               n   cvN  cvTop3  Verdict')
console.log('  ───────────────────  ──  ───  ──────  ──────')
for (const v of verdicts) {
  const cvT = v.cvTop3 == null ? '   —' : `${(v.cvTop3 * 100).toFixed(0).padStart(3)}%`
  console.log(`  ${v.name.padEnd(20)} ${String(v.n).padStart(2)}  ${String(v.cvN).padStart(3)}  ${cvT}   ${v.verdict}`)
}

// ── Save ───────────────────────────────────────────────────────────────
const out = {
  _meta: {
    note: 'Honest evaluation: leave-one-year-out cross-validation + baseline comparisons + per-FO sample-size verdict.',
    generatedAt: new Date().toISOString().slice(0, 10),
  },
  cv: {
    events: cvAll.events,
    nll: round3(cvAll.nll),
    top1Rate: round3(cvAll.top1 / cvAll.events),
    top3Rate: round3(cvAll.top3 / cvAll.events),
    top5Rate: round3(cvAll.top5 / cvAll.events),
    fallbackRate: round3(fallbackEvents / cvAll.events),
    byYear: Object.fromEntries(Object.entries(cvByYear).map(([y, r]) => [y, {
      n: r.events,
      nll: round3(r.nll),
      top3: round3(r.top3 / r.events),
    }])),
  },
  baselines: {
    uniform: { nll: round3(unifNLL), top3Rate: round3(uTop3 / unifEvents) },
    fvOnly:  { nll: round3(fvNLL),   top3Rate: round3(fvTop3 / fvEvents) },
    noFvCV:  { nll: round3(noFvAll.nll), top3Rate: round3(noFvAll.top3 / noFvAll.events) },
  },
  perRegime: verdicts,
}
fs.writeFileSync(outP, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log()
console.log(`saved ${outP}`)

function round3(n) { return Math.round(n * 1000) / 1000 }
