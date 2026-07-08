/*
 * resolve_fo.js
 *
 * Given a (team, year), return the front-office regime responsible for that
 * year's draft, or null. Pure lookup against front_offices.json.
 *
 * "Responsible" = held draft authority for the season in question. Regime
 * tenures are inclusive of `from` and `to`. A regime with multiple tenures
 * (e.g. Stearns at MIL then NYM, Bloom at BOS then STL) is matched for
 * either franchise during its respective window.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const foPath    = path.join(__dirname, 'front_offices.json')
const fo        = JSON.parse(fs.readFileSync(foPath, 'utf8'))

// Pre-build a lookup table: { teamId: { year: regimeId } }
const byTeamYear = {}
for (const regime of fo.regimes) {
  for (const t of regime.tenures) {
    if (!byTeamYear[t.team]) byTeamYear[t.team] = {}
    const to = t.to ?? 2026
    for (let y = t.from; y <= to; y++) {
      // If two regimes claim the same (team, year), the later one in the file wins.
      // The file is hand-curated to avoid this — overlap means an authoring bug.
      if (byTeamYear[t.team][y] && byTeamYear[t.team][y] !== regime.id) {
        console.warn(`overlap: ${t.team} ${y} claimed by both ${byTeamYear[t.team][y]} and ${regime.id}`)
      }
      byTeamYear[t.team][y] = regime.id
    }
  }
}

export const resolveFO = (teamId, year) => byTeamYear[teamId]?.[year] ?? null

export const regimes  = fo.regimes
export const regimeById = Object.fromEntries(fo.regimes.map(r => [r.id, r]))
