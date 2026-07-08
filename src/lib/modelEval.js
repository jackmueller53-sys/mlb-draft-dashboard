/*
 * Exposes the held-out cross-validation results from model_eval.json so the
 * UI can show honest accuracy (not training accuracy) and per-regime
 * confidence verdicts.
 *
 * Source: scripts/training/evaluate_model.js produces model_eval.json with
 *   - cv:        overall + per-year held-out metrics
 *   - baselines: uniform / FV-only / no-FV-CV comparisons
 *   - perRegime: [{ id, name, n, cvN, cvTop3, verdict }]
 *
 * Verdict is computed by sample size only (GREEN ≥10, AMBER ≥5, RED <5),
 * tracking the rule used in the eval script.
 */
import evalData from '../../scripts/training/model_eval.json'

export const cvMetrics  = evalData.cv
export const baselines  = evalData.baselines
export const perRegime  = evalData.perRegime ?? []

const byRegimeId = Object.fromEntries(perRegime.map(r => [r.id, r]))
export const regimeEval = (foId) => byRegimeId[foId] ?? null
