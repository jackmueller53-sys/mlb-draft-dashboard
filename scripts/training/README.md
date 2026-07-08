# Training pipeline

Two stages, in order:

1. **`derive_tendencies.js`** — coarse rate-stat aggregation (HS share, pitcher share, region share). Cheap. Runs in seconds.
2. **`train_preference_model.js`** — conditional-logit (multinomial-logit) preference model. Trains a 9-dim coefficient vector per team. Runs in a few seconds.

The simulator uses the **trained model** when weights exist for a team, falling back to the derived tendencies otherwise. Stage 2 is the source of truth from v0.5 forward.

---


## What's here

- **`historical_picks.json`** — every first-round pick from the 2020–2025 MLB drafts (~175 picks), with team id, pick number, player, position, level (HS / College / Other), and school. Sourced from Wikipedia year-by-year pages.
- **`derive_tendencies.js`** — Node script that reads `historical_picks.json`, aggregates per organization, and writes derived tendency rates back into `src/data/teams.json`.

## What it computes

For each MLB organization in scope:

| Field            | How it's computed                                                     |
|------------------|-----------------------------------------------------------------------|
| `hs`             | share of first-round picks that were high-school players              |
| `college`        | share of first-round picks that were college players                  |
| `pitcher`        | share of first-round picks that were pitchers (RHP / LHP)             |
| `hitter`         | share of first-round picks that were position players                 |
| `riskTolerance`  | proxy: `0.4 + 0.4 × hsRate` — HS bias as a stand-in for upside lean   |
| `notes`          | auto-generated one-liner ("6 picks 2020-25 · HS-heavy · pitcher lean") |
| `learnedFromPicks` | sample size used                                                    |

`signability` is **preserved** from the hand-tuned values — it can't be derived from picks alone without bonus/slot data.

## Run

From the project root:

```bash
node scripts/training/derive_tendencies.js
```

Output goes to stdout (a markdown-style table) and overwrites `src/data/teams.json` in place.

## Verification

After running, the simulator engine in `src/lib/simulator.js` automatically uses the new tendencies via the existing scoring pipeline — no code changes needed. Reload the dev server and run the Monte Carlo. Notable patterns the data confirms:

- **Padres** 100% HS, **Angels** 100% college, **Rays** 83% HS — exactly the reputations.
- **Braves** 83% pitcher — confirms the HS-arm pipeline.
- **Orioles** 100% hitter — Elias-era stockpiling.

## Limits of this first pass

This is **descriptive aggregation, not a trained model.** It captures team-level rate stats from observed picks but doesn't learn per-pick player features (FV at draft time, signability, regional bias, school conference, slot-relative reach). The next phase will:

1. Add per-pick features (FV, age, conference, region) to `historical_picks.json`.
2. Fit a per-team logistic-style preference model: `P(team picks player | available pool)`.
3. Replace the rate-based tendencies with model-coefficient vectors that the simulator scoring function consumes directly.
4. Expand the prospect pool from the first-round 30 to top-200 so rounds 2-3 can be simulated.

The current pipeline is structured so step 1 (richer features) is additive: extend `historical_picks.json` schema, re-run derivation, ship.

## Refresh cadence

Run `derive_tendencies.js` after each MLB draft to incorporate the new year of data. Set `historical_picks.json._meta.years` to include the new year and add the picks.

## Preference model (`train_preference_model.js`)

A per-team **conditional-logit** model trained on the same 175 historical first-round picks.

### Setup

For each pick event `(year Y, slot N)`, team `i` selected player `j*` out of a pool of all players drafted at slot ≥ N in year Y. Utility:

```
u(i, j) = (β_global + δ_team_i) · x_j
P(j | pool, i) = exp(u(i, j)) / Σ_{j' ∈ pool} exp(u(i, j'))
```

Objective: minimize negative log-likelihood of observed picks with L2 shrinkage on δ_team:

```
L = -Σ_events log P(j* | pool_e, team_e) + λ Σ_teams ||δ_team||²
```

Hierarchical structure lets low-sample teams (3-8 picks) borrow strength from the global mean instead of overfitting their handful of picks.

### Features (9)

`isHS`, `isCollege`, `isPitcher`, `isHitter`, `rgnWest`, `rgnSouth`, `rgnMidwest`, `rgnNortheast`, `fvNorm` *(= (FV - 55) / 10)*.

FV is currently a pick-bucket proxy; replacing it with real draft-day FVs is the single biggest data lift queued up for the next pass.

### Training

Vanilla batch gradient descent. 800 iterations, LR 0.5, λ = 1.0. Converges in a few seconds.

Run:

```bash
node scripts/training/train_preference_model.js
```

Output: `scripts/training/model_weights.json` with `betaGlobal`, `betaTeam`, feature names, and metrics.

### Results

Latest training run:

| Metric              | Value |
|---------------------|-------|
| Final NLL           | 202.4 |
| Uniform-pick base   | 444.7 |
| **NLL improvement** | **54.5%** |
| Top-1 accuracy      | 68.7% |
| **Top-3 accuracy**  | **91.6%** |
| Top-5 accuracy      | 97.2% |

The largest learned per-team deviations track public scouting reputations:

- **Padres** isHS +0.51, **Phillies** isHS +0.48, **Rays** isHS +0.45 — all known HS aggressors
- **Angels** isCollege +0.33, **Astros** isCollege +0.30, **Yankees** isCollege +0.18 — known college-floor preferences
- **Braves** isPitcher +0.56 — the HS-arms pipeline, quantified
- **Cubs** rgnMidwest +0.68, **White Sox** rgnMidwest +0.70 — regional pipelines

### Inference

`src/lib/simulator.js` reads `model_weights.json` directly and uses it in `scoreProspect()`:

```js
score = 55 + learnedUtility(team, prospect) + needBonus + signabilityAdjust
```

The needBonus and signabilityAdjust terms stay heuristic — we don't have signability labels or roster-need labels per historical pick yet.

### Limits / next pass

- **FV is a pick-bucket proxy.** Real draft-day FVs (from MLB Pipeline / Baseball America boards in each draft year) would let the model distinguish "team takes high-grade player at slot" from "team reaches below slot for fit/signability."
- **No signability labels in training.** Once we attach signability per historical pick (was bonus over slot? under slot? unsigned?), it becomes a feature the model can learn.
- **No position-need interaction.** The model doesn't know the team's farm-system depth at draft time. Adding this requires roster-snapshot data per draft year.
- **Per-team sample is small.** 3-8 picks per team. The L2 shrinkage helps, but more years of history would help more.

---

## Source of truth

Picks were pulled from the Wikipedia draft year pages:

- https://en.wikipedia.org/wiki/2020_Major_League_Baseball_draft
- https://en.wikipedia.org/wiki/2021_Major_League_Baseball_draft
- https://en.wikipedia.org/wiki/2022_Major_League_Baseball_draft
- https://en.wikipedia.org/wiki/2023_Major_League_Baseball_draft
- https://en.wikipedia.org/wiki/2024_Major_League_Baseball_draft
- https://en.wikipedia.org/wiki/2025_Major_League_Baseball_draft
