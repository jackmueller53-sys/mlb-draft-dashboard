import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import prospectsData from '../data/prospects.json'

const SORTS = {
  rank:  (a, b) => a.rank - b.rank,
  fv:    (a, b) => b.fv - a.fv,
  name:  (a, b) => a.name.localeCompare(b.name),
  age:   (a, b) => a.age - b.age,
  bonus: (a, b) => (b.bonusExp || 0) - (a.bonusExp || 0),
}

export default function BigBoard() {
  const [q, setQ] = useState('')
  const [level, setLevel] = useState('all')
  const [tier, setTier] = useState('all')
  const [sort, setSort] = useState('rank')

  const filtered = useMemo(() => {
    return prospectsData.prospects
      .filter(p => level === 'all' || p.level === level)
      .filter(p => tier === 'all' || p.tier === tier)
      .filter(p => !q || `${p.name} ${p.school} ${p.pos}`.toLowerCase().includes(q.toLowerCase()))
      .sort(SORTS[sort])
  }, [q, level, tier, sort])

  return (
    <>
      <div className="page-title">Big board</div>
      <div className="page-sub">2026 first round · {filtered.length} prospects</div>

      <div className="board-controls">
        <input
          className="input"
          placeholder="Search player, school, or position"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <select className="select" value={level} onChange={e => setLevel(e.target.value)}>
          <option value="all">All levels</option>
          <option value="HS">High school</option>
          <option value="College">College</option>
        </select>
        <select className="select" value={tier} onChange={e => setTier(e.target.value)}>
          <option value="all">All</option>
          <option value="HIT">Hitters</option>
          <option value="PIT">Pitchers</option>
        </select>
        <select className="select" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="rank">Sort: rank</option>
          <option value="fv">Sort: FV</option>
          <option value="bonus">Sort: bonus exp.</option>
          <option value="age">Sort: age</option>
          <option value="name">Sort: name</option>
        </select>
      </div>

      <table className="board-table">
        <thead>
          <tr>
            <th>Rk</th>
            <th>Player</th>
            <th>Pos</th>
            <th>Level</th>
            <th>School / team</th>
            <th>State</th>
            <th>FV</th>
            <th>Signability</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(p => (
            <tr key={p.id}>
              <td className="rank-cell">{p.rank}</td>
              <td className="name-cell"><Link to={`/players/${p.id}`}>{p.name}</Link></td>
              <td><span className={`pos-pill ${p.tier === 'PIT' ? 'pit' : 'hit'}`}>{p.pos}</span></td>
              <td className="muted">{p.level}</td>
              <td className="muted">{p.school}</td>
              <td className="muted">{p.state}</td>
              <td className="mono">{p.fv}</td>
              <td className="muted" style={{ textTransform: 'capitalize' }}>{p.signability}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
