import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import teamsData from '../data/teams.json'

const RANGE = {
  1:   { min: 1,  max: 37 },   // R1 + PPI + Competitive Balance A
  2:   { min: 38, max: 75 },   // R2 + Competitive Balance B + Compensatory
  all: { min: 1,  max: 75 },
}

export default function Teams() {
  const [round, setRound] = useState('1')

  const teams = useMemo(() => {
    const r = RANGE[round]
    return [...teamsData.teams]
      .filter(t => t.pick >= r.min && t.pick <= r.max)
      .sort((a, b) => a.pick - b.pick)
  }, [round])

  return (
    <>
      <div className="page-title">Team profiles</div>
      <div className="page-sub">2026 draft order · tendencies and roster needs</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {['1','2','all'].map(r => (
          <button
            key={r}
            className={`btn ${round === r ? 'btn-primary' : ''}`}
            style={{ padding: '6px 14px', fontSize: 13 }}
            onClick={() => setRound(r)}
          >
            {r === 'all' ? 'All picks' : `Round ${r}`}
          </button>
        ))}
        <div className="muted" style={{ fontFamily: 'var(--mono)', fontSize: 12, alignSelf: 'center', marginLeft: 8 }}>
          {teams.length} entries
        </div>
      </div>

      <div className="grid-3">
        {teams.map(t => (
          <Link key={t.id} to={`/teams/${t.id}`} className="team-card" style={{ ['--team']: t.color }}>
            <div className="team-card-bar" />
            <div className="team-card-body">
              <div className="team-card-pick">
                Pick #{t.pick}{t.pickType && t.pickType !== 'R1' ? ` · ${t.pickType}` : ''}
              </div>
              <div className="team-card-name">{t.name}</div>
              <div className="team-card-meta">{t.league} {t.div}</div>
              <div className="needs-row">
                {t.needs.map(n => <span key={n} className="pos-pill">{n}</span>)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
