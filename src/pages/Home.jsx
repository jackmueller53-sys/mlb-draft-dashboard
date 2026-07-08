import { Link } from 'react-router-dom'
import teamsData from '../data/teams.json'
import prospectsData from '../data/prospects.json'

export default function Home() {
  const teams = teamsData.teams
  const prospects = prospectsData.prospects

  return (
    <>
      <section className="hero">
        <div className="hero-eyebrow">2026 MLB Draft</div>
        <h1>Draft Dashboard</h1>
        <p>
          A working space for the first round: team tendencies, prospect traits,
          signability, and roster fit — all in one place. Starting with the first round
          and expanding from there.
        </p>
        <div className="hero-cta">
          <Link to="/board" className="btn btn-primary">View big board</Link>
          <Link to="/simulator" className="btn">Run mock</Link>
          <Link to="/teams" className="btn">Team profiles</Link>
        </div>
      </section>

      <div className="grid-3">
        <div className="panel">
          <div className="kpi-label">First round slots</div>
          <div className="kpi-value">30</div>
          <div className="kpi-sub">plus competitive balance picks</div>
        </div>
        <div className="panel">
          <div className="kpi-label">Tracked prospects</div>
          <div className="kpi-value">{prospects.length}</div>
          <div className="kpi-sub">first-round–quality talent</div>
        </div>
        <div className="panel">
          <div className="kpi-label">Teams profiled</div>
          <div className="kpi-value">{teams.length}</div>
          <div className="kpi-sub">tendencies and roster needs</div>
        </div>
      </div>

      <div className="spacer" />

      <div className="panel">
        <div className="panel-title">Top 10 preview</div>
        <table className="board-table">
          <thead>
            <tr><th style={{ width: 60 }}>Rk</th><th>Player</th><th>Pos</th><th>School</th><th>FV</th></tr>
          </thead>
          <tbody>
            {prospects.slice(0, 10).map(p => (
              <tr key={p.id}>
                <td className="rank-cell">{p.rank}</td>
                <td className="name-cell"><Link to={`/players/${p.id}`}>{p.name}</Link></td>
                <td><span className={`pos-pill ${p.tier === 'PIT' ? 'pit' : 'hit'}`}>{p.pos}</span></td>
                <td className="muted">{p.school}</td>
                <td className="mono">{p.fv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
