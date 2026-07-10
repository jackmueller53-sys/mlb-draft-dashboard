import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import teamsData from '../data/teams.json'
import prospectsData from '../data/prospects.json'
import { runMock, modelMetrics, modelMeta } from '../lib/simulator.js'
import { cvMetrics, baselines } from '../lib/modelEval.js'
import { getMC } from '../lib/mcCache.js'
import ProbBar from '../components/ProbBar.jsx'

const N_RUNS = 1000

const ROUND_LIMITS = {
  1:   { min: 1,  max: 37 },   // R1 + PPI + Competitive Balance A
  2:   { min: 38, max: 75 },   // R2 + Competitive Balance B + Compensatory
  all: { min: 1,  max: 75 },
}

export default function Simulator() {
  const [mode, setMode]   = useState('mc')   // 'single' | 'mc'
  const [round, setRound] = useState('1')    // '1' | '2' | 'all'

  const picks = useMemo(
    () => runMock(teamsData.teams, prospectsData.prospects),
    []
  )

  const mc = useMemo(() => getMC({ n: N_RUNS, seed: 1 }), [])

  const order = useMemo(
    () => [...teamsData.teams].sort((a, b) => a.pick - b.pick),
    []
  )
  const prospectsById = useMemo(
    () => Object.fromEntries(prospectsData.prospects.map(p => [p.id, p])),
    []
  )

  const range = ROUND_LIMITS[round]
  const inRange = (pick) => pick >= range.min && pick <= range.max

  const filteredPicks = picks.filter(p => inRange(p.pick))
  const filteredOrder = order.filter(t => inRange(t.pick))

  const teamCount = filteredPicks.length
  const hsCount   = filteredPicks.filter(p => p.prospect.level === 'HS').length
  const pitCount  = filteredPicks.filter(p => p.prospect.tier === 'PIT').length

  return (
    <>
      <div className="page-title">Mock simulator</div>
      <div className="page-sub"
           title="Top-3 hit rate = how often a front office's actual pick landed in the model's top-3 predicted targets, tested on draft years the model was not trained on (leave-one-year-out cross-validation).">
        v0.8 · FO-aware model · 2014-25 · {cvMetrics.events} picks ·{' '}
        top-3 hit rate on unseen years <b>{Math.round((cvMetrics.top3Rate ?? 0) * 100)}%</b>{' '}
        (vs {Math.round((baselines.uniform?.top3Rate ?? 0) * 100)}% random,
        {' '}{Math.round((baselines.fvOnly?.top3Rate ?? 0) * 100)}% talent-only)
      </div>

      <div className="grid-4" style={{ marginBottom: 18 }}>
        <div className="panel">
          <div className="kpi-label">Picks made</div>
          <div className="kpi-value">{teamCount}</div>
          <div className="kpi-sub">{round === 'all' ? 'rounds 1-2' : `round ${round}`}</div>
        </div>
        <div className="panel">
          <div className="kpi-label">High school</div>
          <div className="kpi-value">{hsCount}</div>
          <div className="kpi-sub">{teamCount ? Math.round(100 * hsCount / teamCount) : 0}%</div>
        </div>
        <div className="panel">
          <div className="kpi-label">Pitchers</div>
          <div className="kpi-value">{pitCount}</div>
          <div className="kpi-sub">{teamCount ? Math.round(100 * pitCount / teamCount) : 0}%</div>
        </div>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="kpi-label" style={{ margin: 0 }}>View</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className={`btn ${mode === 'single' ? 'btn-primary' : ''}`}
                style={{ padding: '5px 10px', fontSize: 12 }}
                onClick={() => setMode('single')}
              >Single</button>
              <button
                className={`btn ${mode === 'mc' ? 'btn-primary' : ''}`}
                style={{ padding: '5px 10px', fontSize: 12 }}
                onClick={() => setMode('mc')}
              >Monte Carlo</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="kpi-label" style={{ margin: 0 }}>Round</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {['1','2','all'].map(r => (
                <button
                  key={r}
                  className={`btn ${round === r ? 'btn-primary' : ''}`}
                  style={{ padding: '5px 10px', fontSize: 12 }}
                  onClick={() => setRound(r)}
                >{r === 'all' ? 'All' : `R${r}`}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {mode === 'single' ? (
        <SinglePicks picks={filteredPicks} />
      ) : (
        <MCPicks order={filteredOrder} mc={mc} prospectsById={prospectsById} />
      )}
    </>
  )
}

function SinglePicks({ picks }) {
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
        <div className="panel-title" style={{ margin: 0 }}>Single-run mock</div>
      </div>
      {picks.map(({ pick, team, prospect, score }) => (
        <div key={pick} className="pick-row">
          <div className="pick-num">#{pick}</div>
          <div className="pick-team">
            <span style={{ display: 'inline-block', width: 3, height: 14, background: team.color, marginRight: 8, verticalAlign: 'middle', borderRadius: 2 }} />
            <Link to={`/teams/${team.id}`}>{team.name}</Link>
          </div>
          <div>
            <div className="pick-player">
              <Link to={`/players/${prospect.id}`}>{prospect.name}</Link>
            </div>
            <div className="pick-detail">
              <span className={`pos-pill ${prospect.tier === 'PIT' ? 'pit' : 'hit'}`}>{prospect.pos}</span>
              {' '}· {prospect.level} · {prospect.school}
            </div>
          </div>
          <div className="pick-score" title="Fit score">{score.toFixed(1)}</div>
        </div>
      ))}
    </div>
  )
}

function MCPicks({ order, mc, prospectsById }) {
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="panel-title" style={{ margin: 0 }}>Probabilistic round · {mc.n.toLocaleString()} simulations</div>
        <div className="muted" style={{ fontSize: 12 }}>top 3 most likely per pick</div>
      </div>
      {order.map(team => {
        const dist = mc.pickProspectDist[team.pick] || {}
        const top = Object.entries(dist)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([pid, prob]) => ({ p: prospectsById[pid], prob }))
          .filter(x => x.p)
        return (
          <div
            key={team.id}
            style={{
              padding: '12px 18px',
              borderBottom: '1px solid var(--border)',
              display: 'grid',
              gridTemplateColumns: '60px 220px 1fr',
              gap: 16,
              alignItems: 'flex-start',
            }}
          >
            <div className="pick-num" style={{ paddingTop: 4 }}>#{team.pick}</div>
            <div className="pick-team" style={{ paddingTop: 4 }}>
              <span style={{ display: 'inline-block', width: 3, height: 14, background: team.color, marginRight: 8, verticalAlign: 'middle', borderRadius: 2 }} />
              <Link to={`/teams/${team.id}`}>{team.name}</Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {top.length === 0 && <div className="muted" style={{ fontSize: 12 }}>no projection</div>}
              {top.map(({ p, prob }) => (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12, alignItems: 'center' }}>
                  <div>
                    <span className="pick-player">
                      <Link to={`/players/${p.id}`}>{p.name}</Link>
                    </span>
                    <span className="pick-detail" style={{ marginLeft: 8 }}>
                      <span className={`pos-pill ${p.tier === 'PIT' ? 'pit' : 'hit'}`}>{p.pos}</span>
                      {' '}· {p.level} · {p.school}
                    </span>
                  </div>
                  <ProbBar prob={prob} />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
