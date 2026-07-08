#!/usr/bin/env node
/*
 * train_preference_model.js — v2 (front-office-aware)
 *
 * Unit of analysis is the FO regime, not the franchise. Each historical
 * pick is resolved to the GM/PBO who held draft authority that season.
 * When a regime moves teams (Stearns MIL → NYM; Bloom BOS → STL; Bendix
 * TB → MIA; etc.) their picks aggregate into one preference vector.
 *
 * Model: per-regime conditional logit (multinomial-logit) with hierarchical
 * shrinkage to a global mean. Same formulation as v1 but indexed by FO id.
 *
 *   utility(fo, j) = (β_global + δ_fo) · x_j
 *   P(j | pool, fo) = exp(utility(fo, j)) / Σ_{j' ∈ pool} exp(utility(fo, j'))
 *   L = -Σ_events log P(j* | pool_e, fo_e) + λ Σ_fo ||δ_fo||²
 *
 * Output: scripts/training/model_weights.json with
 *   - betaGlobal (D-vector)
 *   - betaFO     (foId -> D-vector)         ← primary inference target
 *   - betaTeam   (teamId -> D-vector)       ← legacy fallback for teams
 *                                            with no FO assignment
 *   - features, metrics, regimeMeta
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { featurize, FEATURES, D } from './featurize.js'
import { resolveFO, regimeById } from './resolve_fo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const historyP  = path.join(__dirname, 'historical_picks.json')
const outP      = path.join(__dirname, 'model_weights.json')

const history = JSON.parse(fs.readFileSync(historyP, 'utf8'))

// ── 1. Group picks by year + assign FO id ──────────────────────────────
const byYear = {}
let unassigned = 0
for (const p of history.picks) {
  if (!byYear[p.year]) byYear[p.year] = []
  byYear[p.year].push(p)
  p._fo = resolveFO(p.teamId, p.year)
  if (!p._fo) unassigned += 1
}
for (const year of Object.keys(byYear)) {
  byYear[year].sort((a, b) => a.pick - b.pick)
  for (const p of byYear[year]) p._x = featurize(p)
}
if (unassigned) {
  console.warn(`⚠ ${unassigned} picks had no FO assignment (will fall back to team-level training)`)
}

// ── 2. Training events: (foId, pool[]) where pool[0] is the observed choice
const events = []
for (const year of Object.keys(byYear)) {
  const picks = byYear[year]
  for (let i = 0; i < picks.length; i++) {
    const fo = picks[i]._fo
    if (!fo) continue   // skip unassigned picks for FO model
    events.push({
      foId: fo,
      teamId: picks[i].teamId,
      pool: picks.slice(i),
    })
  }
}
console.log(`built ${events.length} FO-resolved training events from ${Object.keys(byYear).length} years`)

// ── 3. Init parameters ────────────────────────────────────────────────
const foIds   = [...new Set(events.map(e => e.foId))].sort()
const teamIds = [...new Set(history.picks.map(p => p.teamId))].sort()
const betaGlobal = new Array(D).fill(0)
const betaFO     = {}
for (const id of foIds)   betaFO[id]   = new Array(D).fill(0)

// ── 4. Training loop ──────────────────────────────────────────────────
const LR         = 0.5
const LAMBDA     = 10.0   // bumped from 1.0 after λ sweep — tighter shrinkage closes
                          // the held-out gap to FV-only without flattening per-FO deltas
const ITERATIONS = 800

const dot = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

let baselineNLL = 0
for (const ev of events) baselineNLL += Math.log(ev.pool.length)

let finalNLL = 0
let prev = Infinity
for (let iter = 0; iter < ITERATIONS; iter++) {
  const gradGlobal = new Array(D).fill(0)
  const gradFO     = {}
  for (const id of foIds) gradFO[id] = new Array(D).fill(0)

  let nll = 0
  for (const ev of events) {
    const fo = ev.foId
    const effBeta = new Array(D)
    for (let k = 0; k < D; k++) effBeta[k] = betaGlobal[k] + betaFO[fo][k]

    const scores = new Array(ev.pool.length)
    let maxS = -Infinity
    for (let j = 0; j < ev.pool.length; j++) {
      scores[j] = dot(effBeta, ev.pool[j]._x)
      if (scores[j] > maxS) maxS = scores[j]
    }
    const exps = new Array(ev.pool.length)
    let sumExp = 0
    for (let j = 0; j < ev.pool.length; j++) {
      exps[j] = Math.exp(scores[j] - maxS)
      sumExp += exps[j]
    }
    const probs = new Array(ev.pool.length)
    for (let j = 0; j < ev.pool.length; j++) probs[j] = exps[j] / sumExp

    nll -= Math.log(probs[0] + 1e-12)

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
    for (let k = 0; k < D; k++) gradFO[id][k] += 2 * LAMBDA * betaFO[id][k]
  }

  const invN = 1 / events.length
  for (let k = 0; k < D; k++) betaGlobal[k] -= LR * gradGlobal[k] * invN
  for (const id of foIds) {
    for (let k = 0; k < D; k++) betaFO[id][k] -= LR * gradFO[id][k] * invN
  }

  if (iter === 0 || iter % 100 === 0 || iter === ITERATIONS - 1) {
    console.log(`  iter ${String(iter).padStart(4)}: NLL = ${nll.toFixed(2)}  (baseline ${baselineNLL.toFixed(2)})`)
  }
  finalNLL = nll
  if (Math.abs(prev - nll) < 1e-5) {
    console.log(`  converged at iter ${iter}`)
    break
  }
  prev = nll
}

// ── 5. Evaluate per-FO top-k accuracy ────────────────────────────────
const foAcc = {}
for (const ev of events) {
  const fo = ev.foId
  const effBeta = new Array(D)
  for (let k = 0; k < D; k++) effBeta[k] = betaGlobal[k] + betaFO[fo][k]
  const scored = ev.pool.map((p, j) => ({ j, s: dot(effBeta, p._x) }))
  scored.sort((a, b) => b.s - a.s)
  const obsRank = scored.findIndex(x => x.j === 0) + 1
  if (!foAcc[fo]) foAcc[fo] = { n: 0, top1: 0, top3: 0, top5: 0, sumRank: 0 }
  foAcc[fo].n      += 1
  foAcc[fo].sumRank += obsRank
  if (obsRank <= 1) foAcc[fo].top1 += 1
  if (obsRank <= 3) foAcc[fo].top3 += 1
  if (obsRank <= 5) foAcc[fo].top5 += 1
}

let totalTop1 = 0, totalTop3 = 0, totalTop5 = 0, totalN = 0
for (const id of foIds) {
  totalTop1 += foAcc[id].top1
  totalTop3 += foAcc[id].top3
  totalTop5 += foAcc[id].top5
  totalN    += foAcc[id].n
}

// ── 6. Legacy: also train betaTeam (used as fallback if FO weights miss) ─
const betaTeam = {}
for (const id of teamIds) betaTeam[id] = new Array(D).fill(0)
const teamEvents = []
for (const year of Object.keys(byYear)) {
  const picks = byYear[year]
  for (let i = 0; i < picks.length; i++) {
    teamEvents.push({ teamId: picks[i].teamId, pool: picks.slice(i) })
  }
}
for (let iter = 0; iter < ITERATIONS; iter++) {
  const gradGlobalT = new Array(D).fill(0)
  const gradTeam   = {}
  for (const id of teamIds) gradTeam[id] = new Array(D).fill(0)
  for (const ev of teamEvents) {
    const team = ev.teamId
    const effBeta = new Array(D)
    for (let k = 0; k < D; k++) effBeta[k] = betaGlobal[k] + betaTeam[team][k]
    const scores = new Array(ev.pool.length)
    let maxS = -Infinity
    for (let j = 0; j < ev.pool.length; j++) {
      scores[j] = dot(effBeta, ev.pool[j]._x)
      if (scores[j] > maxS) maxS = scores[j]
    }
    const exps = new Array(ev.pool.length)
    let sumExp = 0
    for (let j = 0; j < ev.pool.length; j++) {
      exps[j] = Math.exp(scores[j] - maxS); sumExp += exps[j]
    }
    const probs = new Array(ev.pool.length)
    for (let j = 0; j < ev.pool.length; j++) probs[j] = exps[j] / sumExp
    const expectedX = new Array(D).fill(0)
    for (let j = 0; j < ev.pool.length; j++) {
      const xj = ev.pool[j]._x
      for (let k = 0; k < D; k++) expectedX[k] += probs[j] * xj[k]
    }
    const obsX = ev.pool[0]._x
    for (let k = 0; k < D; k++) {
      const g = expectedX[k] - obsX[k]
      gradGlobalT[k]    += g
      gradTeam[team][k] += g
    }
  }
  for (const id of teamIds) {
    for (let k = 0; k < D; k++) gradTeam[id][k] += 2 * LAMBDA * betaTeam[id][k]
  }
  const invN = 1 / teamEvents.length
  // (betaGlobal stays from FO training; team training only updates δ_team)
  for (const id of teamIds) {
    for (let k = 0; k < D; k++) betaTeam[id][k] -= LR * gradTeam[id][k] * invN
  }
}

// ── 7. Save ────────────────────────────────────────────────────────────
const out = {
  _meta: {
    note: 'Front-office–aware conditional-logit preference model. Inference: look up the team\'s currentFO, fetch βFO[fo], add to βglobal. Falls back to βTeam if no FO assignment.',
    trainedAt: new Date().toISOString().slice(0, 10),
    historicalSource: 'scripts/training/historical_picks.json',
    foSource: 'scripts/training/front_offices.json',
    iterations: ITERATIONS,
    lr: LR,
    lambda: LAMBDA,
  },
  features: FEATURES,
  betaGlobal,
  betaFO,
  betaTeam,
  regimeMeta: Object.fromEntries(
    foIds.map(id => [id, {
      name: regimeById[id]?.name ?? id,
      tenures: regimeById[id]?.tenures ?? [],
      nPicks: foAcc[id].n,
      top1Rate: round3(foAcc[id].top1 / foAcc[id].n),
      top3Rate: round3(foAcc[id].top3 / foAcc[id].n),
      avgRank:  round3(foAcc[id].sumRank / foAcc[id].n),
    }])
  ),
  metrics: {
    finalNLL: round3(finalNLL),
    baselineNLL: round3(baselineNLL),
    improvement: round3((baselineNLL - finalNLL) / baselineNLL),
    overallTop1Rate: round3(totalTop1 / totalN),
    overallTop3Rate: round3(totalTop3 / totalN),
    overallTop5Rate: round3(totalTop5 / totalN),
    nFORegimes: foIds.length,
    nEvents: events.length,
  },
}
fs.writeFileSync(outP, JSON.stringify(out, null, 2) + '\n', 'utf8')

// ── Report ─────────────────────────────────────────────────────────────
console.log()
console.log(`saved ${outP}`)
console.log()
console.log(`FO regimes trained:   ${foIds.length}`)
console.log(`Training events:      ${events.length}`)
console.log(`Final NLL:            ${finalNLL.toFixed(2)}`)
console.log(`Uniform-pick base:    ${baselineNLL.toFixed(2)}`)
console.log(`Improvement:          ${((baselineNLL - finalNLL) / baselineNLL * 100).toFixed(1)}%`)
console.log()
console.log(`Top-1 accuracy:       ${(totalTop1 / totalN * 100).toFixed(1)}%`)
console.log(`Top-3 accuracy:       ${(totalTop3 / totalN * 100).toFixed(1)}%`)
console.log(`Top-5 accuracy:       ${(totalTop5 / totalN * 100).toFixed(1)}%`)
console.log()
console.log('Cross-team FO regimes (multi-org tenures):')
for (const id of foIds) {
  const r = regimeById[id]
  if (r && r.tenures.length > 1) {
    const teams = r.tenures.map(t => `${t.team} ${t.from}-${t.to ?? 'now'}`).join(' → ')
    console.log(`  ${r.name.padEnd(20)} ${teams}  (${foAcc[id].n} picks)`)
  }
}
console.log()
console.log('Per-FO distinctive features (largest |δ|):')
for (const id of foIds) {
  const dev = betaFO[id]
  const n = foAcc[id].n
  const top = dev
    .map((v, k) => ({ k, v, abs: Math.abs(v) }))
    .filter(f => FEATURES[f.k] !== 'fvNorm')
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 2)
  const summary = top.map(s => `${FEATURES[s.k]}=${s.v >= 0 ? '+' : ''}${s.v.toFixed(2)}`).join('  ')
  const name = (regimeById[id]?.name ?? id).padEnd(20)
  console.log(`  ${name} n=${String(n).padStart(2)}  ${summary}`)
}

function round3(n) { return Math.round(n * 1000) / 1000 }
