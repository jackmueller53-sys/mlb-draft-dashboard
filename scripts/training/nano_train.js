#!/usr/bin/env node
/*
 * nano_train.js — Karpathy-style training cycle on the 2000-2024 draft dataset.
 *
 * Two models trained sequentially, each with its own loss curve printed:
 *
 *   1. SELECTION head  (per-team conditional logit on top-3 rounds)
 *      Target: P(player j chosen | pool of available picks)
 *      Loss:   negative log-likelihood of observed pick
 *      Output: model_weights.json (overwrites the smaller wiki-only model)
 *
 *   2. BONUS head      (per-team over-slot behavior regression)
 *      Target: overSlotRatio = (signing_bonus - pick_value) / pick_value
 *      Loss:   MSE
 *      Output: bonus_weights.json — per-team intercept (chronic over/under
 *              slot tendency) and HS-bonus modifier
 *
 * Style choices:
 *   - Mini-batch SGD with Adam (β1=0.9, β2=0.999, eps=1e-8)
 *   - Train/val split: 2000-2022 train, 2023-2024 val (no leakage; recent
 *     years held out so we measure how well patterns generalize forward)
 *   - Loss logged every 100 iters; checkpoints kept best-val
 *
 * Run:
 *   node scripts/training/nano_train.js
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { resolveFO, regimeById } from './resolve_fo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const inPath  = path.join(__dirname, 'picks_2000_2024.jsonl')
const selOut  = path.join(__dirname, 'model_weights_csv.json')
const bonusOut = path.join(__dirname, 'bonus_weights.json')

// ── Load JSONL ──────────────────────────────────────────────────────────
const picks = []
{
  const rl = readline.createInterface({ input: fs.createReadStream(inPath), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line) continue
    picks.push(JSON.parse(line))
  }
}
console.log(`loaded ${picks.length} picks 2000-2024\n`)

// ── Featurize ───────────────────────────────────────────────────────────
const REGION_BY_STATE = {
  WA:'West',OR:'West',CA:'West',NV:'West',AZ:'West',UT:'West',CO:'West',
  ID:'West',MT:'West',WY:'West',AK:'West',HI:'West',NM:'West',
  TX:'South',OK:'South',AR:'South',LA:'South',MS:'South',TN:'South',
  AL:'South',GA:'South',FL:'South',SC:'South',NC:'South',VA:'South',
  WV:'South',KY:'South',
  IL:'Midwest',IN:'Midwest',OH:'Midwest',MI:'Midwest',WI:'Midwest',
  MN:'Midwest',IA:'Midwest',MO:'Midwest',KS:'Midwest',NE:'Midwest',ND:'Midwest',SD:'Midwest',
  NY:'Northeast',NJ:'Northeast',PA:'Northeast',MA:'Northeast',CT:'Northeast',
  RI:'Northeast',NH:'Northeast',VT:'Northeast',ME:'Northeast',MD:'Northeast',DE:'Northeast',DC:'Northeast',
}

const FEATURES = [
  'isHS','isCollege',
  'posCIF','posMIF','posC','posCOF','posCF','posLHP','posRHP',
  'rgnWest','rgnSouth','rgnMidwest','rgnNortheast',
  'pickNorm',
]
const D = FEATURES.length

const featurize = (p) => {
  const isHS = p.level === 'HS' ? 1 : 0
  const isCollege = p.level === 'College' ? 1 : 0
  const region = REGION_BY_STATE[p.state] || 'Other'
  // pickNorm: 0 at pick 1, ~1 at pick 300 (deep into draft)
  const pickNorm = Math.log(Math.max(1, p.pick)) / Math.log(300)
  return [
    isHS, isCollege,
    p.grp === 'CIF' ? 1 : 0,
    p.grp === 'MIF' ? 1 : 0,
    p.grp === 'C'   ? 1 : 0,
    p.grp === 'COF' ? 1 : 0,
    p.grp === 'CF'  ? 1 : 0,
    p.grp === 'LHP' ? 1 : 0,
    p.grp === 'RHP' ? 1 : 0,
    region === 'West'      ? 1 : 0,
    region === 'South'     ? 1 : 0,
    region === 'Midwest'   ? 1 : 0,
    region === 'Northeast' ? 1 : 0,
    pickNorm,
  ]
}
for (const p of picks) p._x = featurize(p)

// ── Adam optimizer ──────────────────────────────────────────────────────
class Adam {
  constructor(shape, lr = 0.01) {
    this.lr = lr; this.b1 = 0.9; this.b2 = 0.999; this.eps = 1e-8
    this.t = 0
    this.m = this.zerosLike(shape)
    this.v = this.zerosLike(shape)
  }
  zerosLike(shape) {
    if (typeof shape === 'number') return new Float64Array(shape)
    const out = {}
    for (const k of Object.keys(shape)) out[k] = new Float64Array(shape[k])
    return out
  }
  /** Step: param -= lr · mhat / (sqrt(vhat) + eps); param/grad are arrays */
  step(param, grad, m, v) {
    this.t += 1
    const t = this.t
    const b1t = 1 - Math.pow(this.b1, t)
    const b2t = 1 - Math.pow(this.b2, t)
    for (let i = 0; i < param.length; i++) {
      m[i] = this.b1 * m[i] + (1 - this.b1) * grad[i]
      v[i] = this.b2 * v[i] + (1 - this.b2) * grad[i] * grad[i]
      const mhat = m[i] / b1t
      const vhat = v[i] / b2t
      param[i] -= this.lr * mhat / (Math.sqrt(vhat) + this.eps)
    }
  }
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ════════════════════════════════════════════════════════════════════════
// HEAD 1: Selection model (conditional logit, rounds 1-3, per-team)
// ════════════════════════════════════════════════════════════════════════
console.log('═══ HEAD 1: Selection model ════════════════════════════════════')

// Pool by (year, round) — pool = remaining picks in same year & round
// Round 1-3 = serious player evaluation territory
const r123 = picks.filter(p => p.round <= 3 && p.grp)
const byYearRound = {}
for (const p of r123) {
  const k = `${p.year}|${p.round}`
  if (!byYearRound[k]) byYearRound[k] = []
  byYearRound[k].push(p)
}
for (const k of Object.keys(byYearRound)) byYearRound[k].sort((a, b) => a.pick - b.pick)

const allTeams = [...new Set(picks.map(p => p.teamId))].sort()

const buildEvents = (years) => {
  const ev = []
  for (const year of years) {
    for (const round of [1, 2, 3]) {
      const list = byYearRound[`${year}|${round}`]
      if (!list) continue
      for (let i = 0; i < list.length; i++) {
        ev.push({ team: list[i].teamId, pool: list.slice(i) })
      }
    }
  }
  return ev
}

const allYears = [...new Set(picks.map(p => p.year))].sort()
const trainYears = allYears.filter(y => y <= 2022)
const valYears   = allYears.filter(y => y > 2022)
const trainEvents = buildEvents(trainYears)
const valEvents   = buildEvents(valYears)

console.log(`  train events: ${trainEvents.length} (${trainYears[0]}-${trainYears.at(-1)})`)
console.log(`  val events:   ${valEvents.length}   (${valYears[0]}-${valYears.at(-1)})`)
console.log()

// Params: βglobal[D] + δteam[team][D]
const betaGlobal = new Float64Array(D)
const betaTeam = {}
for (const t of allTeams) betaTeam[t] = new Float64Array(D)
const LAMBDA = 8.0   // L2 on δ_team

// Adam state
const adamGlobal = new Adam(D, 0.01)
const mG = new Float64Array(D), vG = new Float64Array(D)
const mT = {}, vT = {}
for (const t of allTeams) { mT[t] = new Float64Array(D); vT[t] = new Float64Array(D) }

const evalNLL = (events) => {
  let totalNLL = 0, top1 = 0, top3 = 0
  for (const ev of events) {
    const eff = new Float64Array(D)
    for (let k = 0; k < D; k++) eff[k] = betaGlobal[k] + (betaTeam[ev.team]?.[k] ?? 0)
    let maxS = -Infinity
    const scores = new Array(ev.pool.length)
    for (let j = 0; j < ev.pool.length; j++) {
      scores[j] = dot(eff, ev.pool[j]._x)
      if (scores[j] > maxS) maxS = scores[j]
    }
    let sumE = 0
    const exps = new Array(ev.pool.length)
    for (let j = 0; j < ev.pool.length; j++) { exps[j] = Math.exp(scores[j] - maxS); sumE += exps[j] }
    const obsP = exps[0] / sumE
    totalNLL -= Math.log(Math.max(obsP, 1e-12))
    // rank
    let rank = 1, obsScore = scores[0]
    for (let j = 1; j < ev.pool.length; j++) if (scores[j] > obsScore) rank += 1
    if (rank <= 1) top1 += 1
    if (rank <= 3) top3 += 1
  }
  return { nll: totalNLL / events.length, top1: top1 / events.length, top3: top3 / events.length }
}

const ITERS = 1200
const BATCH = 256
let bestValNLL = Infinity
let bestParams = null
const t0 = Date.now()

console.log(`  Karpathy loop · ${ITERS} iters · batch ${BATCH} · λ=${LAMBDA}`)
console.log(`  ${'iter'.padStart(5)} | ${'train NLL'.padStart(10)} | ${'val NLL'.padStart(10)} | ${'val top-3'.padStart(10)} | dt`)
console.log(`  ${'-'.repeat(5)}-+-${'-'.repeat(10)}-+-${'-'.repeat(10)}-+-${'-'.repeat(10)}-+-----`)

for (let iter = 0; iter < ITERS; iter++) {
  // Mini-batch: sample BATCH events
  const batchIdxs = []
  for (let i = 0; i < BATCH; i++) batchIdxs.push((Math.random() * trainEvents.length) | 0)

  const gG = new Float64Array(D)
  const gT = {}
  for (const t of allTeams) gT[t] = new Float64Array(D)

  for (const i of batchIdxs) {
    const ev = trainEvents[i]
    const eff = new Float64Array(D)
    for (let k = 0; k < D; k++) eff[k] = betaGlobal[k] + betaTeam[ev.team][k]
    let maxS = -Infinity
    const scores = new Array(ev.pool.length)
    for (let j = 0; j < ev.pool.length; j++) {
      scores[j] = dot(eff, ev.pool[j]._x)
      if (scores[j] > maxS) maxS = scores[j]
    }
    let sumE = 0
    const exps = new Array(ev.pool.length)
    for (let j = 0; j < ev.pool.length; j++) { exps[j] = Math.exp(scores[j] - maxS); sumE += exps[j] }
    const probs = exps.map(e => e / sumE)
    const expectedX = new Float64Array(D)
    for (let j = 0; j < ev.pool.length; j++) {
      const x = ev.pool[j]._x
      for (let k = 0; k < D; k++) expectedX[k] += probs[j] * x[k]
    }
    const obs = ev.pool[0]._x
    for (let k = 0; k < D; k++) {
      const g = (expectedX[k] - obs[k]) / BATCH
      gG[k] += g
      gT[ev.team][k] += g
    }
  }
  // L2 on δ_team
  for (const t of allTeams) {
    for (let k = 0; k < D; k++) gT[t][k] += (2 * LAMBDA / trainEvents.length) * betaTeam[t][k]
  }
  // Adam steps
  adamGlobal.step(betaGlobal, gG, mG, vG)
  for (const t of allTeams) adamGlobal.step(betaTeam[t], gT[t], mT[t], vT[t])

  if (iter % 100 === 0 || iter === ITERS - 1) {
    const tr = evalNLL(trainEvents)
    const va = evalNLL(valEvents)
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`  ${String(iter).padStart(5)} | ${tr.nll.toFixed(4).padStart(10)} | ${va.nll.toFixed(4).padStart(10)} | ${(va.top3 * 100).toFixed(1).padStart(9)}% | ${dt}s`)
    if (va.nll < bestValNLL) {
      bestValNLL = va.nll
      bestParams = {
        betaGlobal: Array.from(betaGlobal),
        betaTeam: Object.fromEntries(allTeams.map(t => [t, Array.from(betaTeam[t])])),
      }
    }
  }
}

// Final eval
const trFinal = evalNLL(trainEvents)
const vaFinal = evalNLL(valEvents)
console.log()
console.log(`  final train top-3: ${(trFinal.top3 * 100).toFixed(1)}%`)
console.log(`  final val   top-3: ${(vaFinal.top3 * 100).toFixed(1)}%   ← held out 2023-2024`)
console.log(`  best val NLL:      ${bestValNLL.toFixed(4)}`)

fs.writeFileSync(selOut, JSON.stringify({
  _meta: {
    note: 'CSV-trained selection model — per-team conditional logit on R1-3 picks 2000-2024',
    features: FEATURES,
    trainedAt: new Date().toISOString().slice(0, 10),
    trainYears: [trainYears[0], trainYears.at(-1)],
    valYears:   [valYears[0],   valYears.at(-1)],
    nTrainEvents: trainEvents.length,
    nValEvents:   valEvents.length,
    metrics: {
      trainNLL: round4(trFinal.nll), valNLL: round4(vaFinal.nll),
      trainTop3: round4(trFinal.top3), valTop3: round4(vaFinal.top3),
      bestValNLL: round4(bestValNLL),
    },
  },
  betaGlobal: bestParams?.betaGlobal ?? Array.from(betaGlobal),
  betaTeam:   bestParams?.betaTeam   ?? Object.fromEntries(allTeams.map(t => [t, Array.from(betaTeam[t])])),
}, null, 2) + '\n')
console.log(`  ✓ wrote ${selOut}`)

// ════════════════════════════════════════════════════════════════════════
// HEAD 2: Bonus behavior model (per-team over-slot tendency)
// ════════════════════════════════════════════════════════════════════════
console.log()
console.log('═══ HEAD 2: Bonus behavior model ═══════════════════════════════')

// Slot system existed since 2012 (formal bonus pool); pre-2012 dollar values
// were advisory so over-slot is less meaningful. Restrict to 2012+.
const bonusRows = picks.filter(p =>
  p.year >= 2012 &&
  p.overSlotRatio != null && isFinite(p.overSlotRatio) &&
  p.pickValue > 0 && p.signingBonus > 0 &&
  Math.abs(p.overSlotRatio) < 5  // drop extreme outliers (data errors)
)
console.log(`  bonus-modeling rows: ${bonusRows.length} (2012-2024, valid pickValue + signingBonus)`)
console.log()

// Bonus features: subset relevant to bonus behavior
const BONUS_F = ['isHS','isCollege','posC','posSS','posCF','isPitcher','pickNorm']
const BD = BONUS_F.length
const bFeat = (p) => [
  p.level === 'HS' ? 1 : 0,
  p.level === 'College' ? 1 : 0,
  p.grp === 'C'   ? 1 : 0,
  p.pos === 'SS'  ? 1 : 0,
  p.grp === 'CF'  ? 1 : 0,
  (p.grp === 'LHP' || p.grp === 'RHP') ? 1 : 0,
  Math.log(Math.max(1, p.pick)) / Math.log(300),
]
for (const p of bonusRows) p._bx = bFeat(p)

// Train/val split: 2012-2022 train, 2023-2024 val
const bTrain = bonusRows.filter(p => p.year <= 2022)
const bVal   = bonusRows.filter(p => p.year > 2022)

// Params: α_team (intercept) + β_global[BD] (no per-team interaction; simple)
const betaB = new Float64Array(BD)
const alphaTeam = {}
for (const t of allTeams) alphaTeam[t] = 0

const mB = new Float64Array(BD), vB = new Float64Array(BD)
const mA = {}, vA = {}
for (const t of allTeams) { mA[t] = 0; vA[t] = 0 }
const adamB = new Adam(BD, 0.01)

const bonusPredict = (p) => alphaTeam[p.teamId] + dot(betaB, p._bx)
const mse = (rows) => {
  let s = 0
  for (const p of rows) { const e = p.overSlotRatio - bonusPredict(p); s += e * e }
  return s / rows.length
}

const BONUS_ITERS = 2000
const BONUS_BATCH = 512
console.log(`  Karpathy loop · ${BONUS_ITERS} iters · batch ${BONUS_BATCH}`)
console.log(`  ${'iter'.padStart(5)} | ${'train MSE'.padStart(10)} | ${'val MSE'.padStart(10)} | dt`)
console.log(`  ${'-'.repeat(5)}-+-${'-'.repeat(10)}-+-${'-'.repeat(10)}-+-----`)
const t1 = Date.now()
let bestBonusValMSE = Infinity

for (let iter = 0; iter < BONUS_ITERS; iter++) {
  // Mini-batch
  const gB = new Float64Array(BD)
  const gA = {}
  for (const t of allTeams) gA[t] = 0
  for (let i = 0; i < BONUS_BATCH; i++) {
    const p = bTrain[(Math.random() * bTrain.length) | 0]
    const yhat = bonusPredict(p)
    const err = yhat - p.overSlotRatio   // gradient sign: ∂(err²)/2 = err
    const scale = 2 / BONUS_BATCH
    for (let k = 0; k < BD; k++) gB[k] += scale * err * p._bx[k]
    gA[p.teamId] += scale * err
  }
  // Update
  adamB.step(betaB, gB, mB, vB)
  for (const t of allTeams) {
    const tmpP = new Float64Array([alphaTeam[t]])
    const tmpG = new Float64Array([gA[t]])
    const tmpM = new Float64Array([mA[t]])
    const tmpV = new Float64Array([vA[t]])
    adamB.step(tmpP, tmpG, tmpM, tmpV)
    alphaTeam[t] = tmpP[0]; mA[t] = tmpM[0]; vA[t] = tmpV[0]
  }
  if (iter % 100 === 0 || iter === BONUS_ITERS - 1) {
    const tr = mse(bTrain)
    const va = mse(bVal)
    const dt = ((Date.now() - t1) / 1000).toFixed(1)
    console.log(`  ${String(iter).padStart(5)} | ${tr.toFixed(4).padStart(10)} | ${va.toFixed(4).padStart(10)} | ${dt}s`)
    if (va < bestBonusValMSE) bestBonusValMSE = va
  }
}

// Per-team stats
const teamBonusStats = {}
for (const t of allTeams) {
  const teamRows = bTrain.filter(p => p.teamId === t)
  if (teamRows.length === 0) continue
  const mean = teamRows.reduce((s, p) => s + p.overSlotRatio, 0) / teamRows.length
  const median = (() => {
    const arr = teamRows.map(p => p.overSlotRatio).sort((a, b) => a - b)
    return arr[arr.length >> 1]
  })()
  const overSlotPct = teamRows.filter(p => p.overSlotRatio > 0.02).length / teamRows.length
  const underSlotPct = teamRows.filter(p => p.overSlotRatio < -0.02).length / teamRows.length
  teamBonusStats[t] = {
    n: teamRows.length,
    learnedIntercept: round4(alphaTeam[t]),
    rawMean:   round4(mean),
    rawMedian: round4(median),
    overSlotPct:  round4(overSlotPct),
    underSlotPct: round4(underSlotPct),
  }
}

// ── FO-level aggregates (2014-2024 where FO is resolvable) ─────────────
// Same raw stats but grouped by the decision-maker, so cross-team regimes
// (Stearns MIL→NYM, Friedman TB→LAD, Dombrowski DET→BOS→PHI, etc.)
// aggregate. Train + val combined here since we just want descriptive
// per-FO numbers for the UI; no held-out split needed.
const foBonusStats = {}
const foRows = {}
for (const p of bonusRows) {
  const fo = resolveFO(p.teamId, p.year)
  if (!fo) continue
  ;(foRows[fo] ??= []).push(p)
}
for (const [fo, rows] of Object.entries(foRows)) {
  if (rows.length === 0) continue
  const mean = rows.reduce((s, p) => s + p.overSlotRatio, 0) / rows.length
  const sorted = rows.map(p => p.overSlotRatio).sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  const overSlotPct  = rows.filter(p => p.overSlotRatio > 0.02).length / rows.length
  const underSlotPct = rows.filter(p => p.overSlotRatio < -0.02).length / rows.length
  // Span tenures across teams (e.g., "MIL 2016-2023 → NYM 2024-2024")
  const tenureMap = {}
  for (const p of rows) {
    if (!tenureMap[p.teamId]) tenureMap[p.teamId] = { from: p.year, to: p.year }
    tenureMap[p.teamId].from = Math.min(tenureMap[p.teamId].from, p.year)
    tenureMap[p.teamId].to   = Math.max(tenureMap[p.teamId].to,   p.year)
  }
  foBonusStats[fo] = {
    name: regimeById[fo]?.name ?? fo,
    n: rows.length,
    rawMean:   round4(mean),
    rawMedian: round4(median),
    overSlotPct:  round4(overSlotPct),
    underSlotPct: round4(underSlotPct),
    tenures: Object.entries(tenureMap).map(([t, { from, to }]) => ({ team: t, from, to })),
  }
}

fs.writeFileSync(bonusOut, JSON.stringify({
  _meta: {
    note: 'Per-team bonus behavior model. Trained on 2012-2022 R1-deep picks with valid signing bonus + pick value. Held out 2023-2024.',
    features: BONUS_F,
    target: 'overSlotRatio = (signing_bonus - pick_value) / pick_value',
    trainedAt: new Date().toISOString().slice(0, 10),
    n: bonusRows.length,
    bestValMSE: round4(bestBonusValMSE),
  },
  betaGlobal: Array.from(betaB),
  alphaTeam: alphaTeam,        // learned per-team intercept
  perTeam: teamBonusStats,     // raw stats for interpretability
  perFO:    foBonusStats,      // aggregated by decision-maker (2014-2024 only)
}, null, 2) + '\n')
console.log()
console.log(`  ✓ wrote ${bonusOut}`)

// ── Summary table ───────────────────────────────────────────────────────
console.log()
console.log('═══ Per-team bonus tendencies (sorted by learnedIntercept) ════')
console.log()
const sortedTeams = Object.entries(teamBonusStats)
  .sort(([, a], [, b]) => b.learnedIntercept - a.learnedIntercept)
console.log('  team |   n  | intercept | mean   | over% | under%')
console.log('  -----+------+-----------+--------+-------+-------')
for (const [t, s] of sortedTeams) {
  console.log(`  ${t.padEnd(4)} | ${String(s.n).padStart(4)} | ${(s.learnedIntercept >= 0 ? '+' : '') + s.learnedIntercept.toFixed(3).padStart(8)} | ${(s.rawMean >= 0 ? '+' : '') + s.rawMean.toFixed(3).padStart(6)} | ${(s.overSlotPct * 100).toFixed(0).padStart(4)}% | ${(s.underSlotPct * 100).toFixed(0).padStart(4)}%`)
}

// ── Per-FO summary table ─────────────────────────────────────────────
console.log()
console.log('═══ Per-FO bonus tendencies (cross-team regimes flagged) ══════')
console.log()
const sortedFOs = Object.entries(foBonusStats)
  .filter(([, s]) => s.n >= 5)
  .sort(([, a], [, b]) => b.rawMean - a.rawMean)
console.log(`  ${'FO'.padEnd(20)} | n  | mean    | over%  | tenures`)
console.log(`  ${'-'.repeat(20)}-+----+---------+--------+--------`)
for (const [, s] of sortedFOs) {
  const teamsStr = s.tenures.map(t => `${t.team} ${t.from}-${t.to}`).join(' → ')
  console.log(`  ${s.name.padEnd(20)} | ${String(s.n).padStart(2)} | ${(s.rawMean >= 0 ? '+' : '') + (s.rawMean * 100).toFixed(1).padStart(5)}% | ${(s.overSlotPct * 100).toFixed(0).padStart(4)}%  | ${teamsStr}`)
}

function round4(n) { return Math.round(n * 10000) / 10000 }
