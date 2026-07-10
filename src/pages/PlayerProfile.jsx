import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import prospectsData from '../data/prospects.json'
import teamsData from '../data/teams.json'
import { scoreProspect, summarizePickDist, topK } from '../lib/simulator.js'
import { getMC } from '../lib/mcCache.js'
import ProbBar from '../components/ProbBar.jsx'
import PickDistChart from '../components/PickDistChart.jsx'

const Stat = ({ lbl, val }) => (
  <div className="grade-cell">
    <div className="lbl">{lbl}</div>
    <div className="val" style={{ fontSize: 20 }}>{val ?? '—'}</div>
  </div>
)

/*
 * Statistical panel body.
 *   - High school prospects: FV only (no collegiate statistical record).
 *   - College prospects with a sourced line: hitting or pitching stat tiles.
 *   - College prospects without a line yet: FV + a "not sourced" note.
 */
function StatPanel({ p }) {
  if (p.level === 'HS') {
    return (
      <>
        <div className="grade-row">
          <Stat lbl="Future value" val={p.fv} />
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6 }}>
          High school prospect — no collegiate statistical record. Evaluation is scouting-based.
        </div>
      </>
    )
  }

  const s = p.stats
  if (!s) {
    return (
      <>
        <div className="grade-row">
          <Stat lbl="Future value" val={p.fv} />
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6 }}>
          College statistics not yet sourced for this prospect.
        </div>
      </>
    )
  }

  if (s.type === 'pitching') {
    const g = s.pitching || {}
    return (
      <>
        <div className="grade-row">
          <Stat lbl="ERA"    val={g.era} />
          <Stat lbl="IP"     val={g.ip} />
          <Stat lbl="SO"     val={g.so} />
          <Stat lbl="BB"     val={g.bb} />
          <Stat lbl="WHIP"   val={g.whip} />
          <Stat lbl="Record" val={g.record} />
        </div>
        <StatFooter s={s} />
      </>
    )
  }

  const g = s.hitting || {}
  return (
    <>
      <div className="grade-row">
        <Stat lbl="AVG" val={g.avg} />
        <Stat lbl="OBP" val={g.obp} />
        <Stat lbl="SLG" val={g.slg} />
        <Stat lbl="HR"  val={g.hr} />
        <Stat lbl="RBI" val={g.rbi} />
        {g.sb != null && <Stat lbl="SB" val={g.sb} />}
      </div>
      <StatFooter s={s} />
    </>
  )
}

const StatFooter = ({ s }) => (
  <div className="muted" style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
    {s.season} · {s.team}
    {s.summer ? <> · Summer: {s.summer}</> : ''}
    <span style={{ display: 'block', color: 'var(--fg-3)', marginTop: 2 }}>Source: {s.source}</span>
  </div>
)

const MetaItem = ({ label, value }) => {
  if (value == null || value === '') return null
  return <span>{label} <b>{value}</b></span>
}

export default function PlayerProfile() {
  const { playerId } = useParams()
  const p = prospectsData.prospects.find(x => x.id === playerId)

  const mc = useMemo(() => getMC(), [])
  const teamsById = useMemo(
    () => Object.fromEntries(teamsData.teams.map(t => [t.id, t])),
    []
  )

  if (!p) return <div>Player not found. <Link to="/board">Back</Link></div>

  const teamFits = [...teamsData.teams]
    .map(t => ({ t, score: scoreProspect(t, p) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)

  const pickDist = mc.pickDist[p.id]
  const teamDist = mc.teamDist[p.id]
  const summary = summarizePickDist(pickDist)
  const topTeams = topK(teamDist, 5)

  return (
    <>
      <Link to="/board" className="muted" style={{ fontSize: 13 }}>← Big board</Link>
      <div className="profile-head" style={{ marginTop: 8 }}>
        <div>
          <div className="profile-eyebrow" style={{ color: 'var(--red)' }}>
            Rank #{p.rank} · FV {p.fv} · {p.level}
          </div>
          <div className="profile-name">{p.name}</div>
          <div className="profile-meta">
            <MetaItem label="Pos"    value={p.pos} />
            <MetaItem label="School" value={p.school} />
            <MetaItem label="State"  value={p.state} />
            <MetaItem label="Age"    value={p.age} />
            <MetaItem label="B/T"    value={p.bt && p.tw ? `${p.bt}/${p.tw}` : null} />
            <MetaItem label="Frame"  value={p.ht && p.wt ? `${p.ht} · ${p.wt}` : null} />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          {p.level === 'HS'
            ? 'Player grade'
            : p.stats?.type === 'pitching'
              ? 'College pitching'
              : p.stats
                ? 'College hitting'
                : 'College statistics'}
        </div>
        <StatPanel p={p} />
      </div>

      <div className="spacer" />

      {summary && (
        <div className="grid-2">
          <div className="panel">
            <div className="panel-title">Pick projection · {mc.n.toLocaleString()} sims</div>
            <div className="grade-row" style={{ marginBottom: 16 }}>
              <div className="grade-cell">
                <div className="lbl">Most likely</div>
                <div className="val">#{summary.mostLikelyPick ?? '—'}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {Math.round((summary.mostLikelyProb ?? 0) * 100)}% of sims
                </div>
              </div>
              <div className="grade-cell">
                <div className="lbl">Median</div>
                <div className="val">#{summary.p50 ?? '—'}</div>
              </div>
              <div className="grade-cell">
                <div className="lbl">80% range</div>
                <div className="val" style={{ fontSize: 20 }}>
                  {summary.p10 != null && summary.p90 != null ? `${summary.p10}–${summary.p90}` : '—'}
                </div>
              </div>
              <div className="grade-cell">
                <div className="lbl">Undrafted (rds 1-2)</div>
                <div className="val">{Math.round((summary.undrafted ?? 0) * 100)}%</div>
              </div>
            </div>
            <PickDistChart dist={pickDist} summary={summary} from={1} to={60} />
          </div>

          <div className="panel">
            <div className="panel-title">Likeliest landing spots</div>
            {topTeams.length === 0 ? (
              <div className="muted">No team probabilities (player not selected in any sim).</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {topTeams.map(({ key: teamId, prob }) => {
                  const t = teamsById[teamId]
                  if (!t) return null
                  return (
                    <div key={teamId} style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12, alignItems: 'center' }}>
                      <div>
                        <span style={{ display: 'inline-block', width: 4, height: 14, background: t.color, marginRight: 8, verticalAlign: 'middle', borderRadius: 2 }} />
                        <Link to={`/teams/${t.id}`} style={{ color: 'var(--fg)', fontWeight: 600 }}>{t.name}</Link>
                        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>pick #{t.pick}</span>
                      </div>
                      <ProbBar prob={prob} color={t.color} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="spacer" />

      <div className="panel">
        <div className="panel-title">Best team fits (deterministic)</div>
        <table className="board-table">
          <thead>
            <tr><th>Rk</th><th>Team</th><th>Pick</th><th>Needs</th><th>Score</th></tr>
          </thead>
          <tbody>
            {teamFits.map(({ t, score }, i) => (
              <tr key={t.id}>
                <td className="rank-cell">{i + 1}</td>
                <td className="name-cell">
                  <span style={{ display: 'inline-block', width: 4, height: 14, background: t.color, marginRight: 8, verticalAlign: 'middle', borderRadius: 2 }} />
                  <Link to={`/teams/${t.id}`}>{t.name}</Link>
                </td>
                <td className="mono">#{t.pick}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {t.needs.map(n => <span key={n} className="pos-pill">{n}</span>)}
                  </div>
                </td>
                <td className="mono">{score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
