# MLB Draft Dashboard

Interactive dashboard + simulator for the **2026 MLB Draft**, inspired by the original Tableau dashboard at
<https://public.tableau.com/app/profile/john.mueller2059/viz/MLBDraftDataBreakdown/Dashboard1>.

Sister site to **baseball-hub** — shares the typographic system (Barlow Condensed / Playfair Display / JetBrains Mono),
but uses a distinct midnight-diamond + gold palette so the two read as a family without colliding visually.

---

## Stack

- **Vite + React 18** (SPA)
- **React Router v6** for client-side routing
- **JSON data layer** — placeholder until the data pipeline lands

## Run it

```bash
cd "Projects/MLB Draft Dashboard"
npm install
npm run dev
```

Then open <http://localhost:5180>.

---

## Site map (v0.1)

| Route | Purpose |
|---|---|
| `/` | Hero + KPIs + top-10 board preview |
| `/board` | Sortable / filterable big board for the first round |
| `/teams` | All 30 teams in pick order, with needs |
| `/teams/:teamId` | Team profile: tendencies, needs, slot value, top fits |
| `/players/:playerId` | Player profile: 20-80 grades, signability, team fits |
| `/simulator` | Pattern-weighted first-round mock with stats + re-run |

## Data layer

All data lives in `src/data/`:

- `teams.json` — 30 teams. Per team: pick #, color, league/div, organizational needs, **tendencies** (HS vs College, hitter vs pitcher, signability preference, risk tolerance), and a short scouting blurb.
- `prospects.json` — 32 first-round placeholder prospects. Per player: rank, position, level, school/state, age, B/T, height/weight, FV, 20-80 grades, signability lean, bonus expectation, tags, blurb.

> ⚠️ **All names, grades, and tendencies in v0.1 are SYNTHETIC placeholders.** They exist to exercise the UI and the simulator. Real data goes in via the pipeline described below.

## Simulator

`src/lib/simulator.js` runs a deterministic first-round mock by scoring each available prospect against each team:

```
score = FV
      + levelFit (HS vs College tendency)
      + sideFit  (pitcher vs hitter tendency)
      + needBonus (position match against team needs)
      + signabilityAdjust (risk tolerance × signability lean)
```

The current weights are hand-tuned and meant to be replaced by **learned weights** from the 2020-2025 training set.

---

## Roadmap

### Phase 1 — ✅ Infrastructure (this commit)
- Site shell, routing, theme, four MVP pages, placeholder data, deterministic simulator.

### Phase 2 — Real prospect data (2026 class)
Sources (publicly available, name-match keyed):
- MLB Pipeline top-200 board
- Baseball America top-500
- Perfect Game national rankings
- Prospects Live / Prospect Times boards
- College stat lines (D1Baseball, NCAA), HS performance circuit data

Pipeline plan (`scripts/` to be added):
1. **Scrape / fetch** each source into `data/raw/<source>/<date>.json`.
2. **Normalize** names (handle accents, suffixes, nicknames) into a canonical `player_key`.
3. **Merge** across sources, taking grade medians and union of tags.
4. **Diff** vs. current `prospects.json` and write a PR-style report.
5. **Promote** the merged file to `src/data/prospects.json`.

### Phase 3 — Train team-pattern model on 2020-2025
- Pull historical first-round picks (player profile → team).
- Featurize each pick (HS/College, position, FV, signability, region, school conf, performance).
- Per team: learn a logistic-regression-style "fingerprint" that scores prospects.
- Replace the hand-tuned weights in `simulator.js` with model coefficients per team.
- Add a **confidence band** to mock picks and surface "X% chance team Y takes player Z."

### Phase 4 — Expand
- Compensatory + competitive balance picks (CBA/CBB rounds).
- Second + third rounds.
- Mock vs. actuals diff after Day 1 of the real draft.
- Roster-fit page: where would a prospect slot into a team's farm system depth chart?

---

## File layout

```
src/
├── App.jsx                # routes
├── main.jsx               # entry
├── styles/global.css      # design system (CSS vars)
├── components/Layout.jsx  # sticky header + nav
├── data/
│   ├── teams.json
│   └── prospects.json
├── lib/
│   ├── format.js          # money, slot map, helpers
│   └── simulator.js       # scoring + mock runner
└── pages/
    ├── Home.jsx
    ├── BigBoard.jsx
    ├── Teams.jsx
    ├── TeamProfile.jsx
    ├── PlayerProfile.jsx
    └── Simulator.jsx
```

## Conventions

- Design tokens live in `:root` in `global.css`. Don't hard-code colors in components.
- Data files have a `_meta` block describing scale and provenance. Keep it up to date when swapping in real data.
- The simulator is **pure** — `runMock(teams, prospects)` returns a new array, no global state.
