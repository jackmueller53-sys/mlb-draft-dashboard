/*
 * User-run simulator.
 *
 * The user picks a team ("draft as"), and the sim auto-drafts every slot
 * with the same scoreProspect logic used in the mock simulator. When a pick
 * belongs to the chosen org (any -R2 or -S variant counts), the sim halts
 * and shows the top available prospects with per-team fit context. Clicking
 * one drafts them and resumes auto-drafting through R1+R2.
 *
 * The user picks are highlighted with a team-color stripe in the final draft
 * board. Reset returns to the team picker.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import teamsData from '../data/teams.json'
import prospectsData from '../data/prospects.json'
import { scoreProspect, pickBestForTeam } from '../lib/simulator.js'

const orgOf = (teamId) => teamId.replace(/-\d+$/, '')

// Team display name in the draft feed. Removes the "(Supp.)" tag baked into
// team.name for supplemental entries — the pick number tells you it's a supp.
const cleanTeamName = (team) => team.name.replace(/\s*\(Supp\.\)/, '')

export default function UserSimulator() {
  const [userOrgId, setUserOrgId]   = useState(null)
  const [picks, setPicks]           = useState([])
  const [available, setAvailable]   = useState(prospectsData.prospects)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [sortKey, setSortKey]       = useState('rank')

  const teamOrder = useMemo(
    () => [...teamsData.teams].sort((a, b) => a.pick - b.pick),
    []
  )

  // ── Derived draft state — computed unconditionally so hook order is stable ──
  const currentTeam    = currentIdx < teamOrder.length ? teamOrder[currentIdx] : null
  const isUserOnClock  = !!(userOrgId && currentTeam && orgOf(currentTeam.id) === userOrgId)
  const done           = !!userOrgId && currentIdx >= teamOrder.length
  const userTeamEntry  = userOrgId ? teamOrder.find(t => orgOf(t.id) === userOrgId) : null
  const userColor      = userTeamEntry?.color ?? 'var(--navy)'
  const userTeamName   = userTeamEntry ? cleanTeamName(userTeamEntry) : ''

  // Sortable ranking of available prospects for the on-the-clock panel.
  // useMemo must run every render — return [] when we don't need it.
  const sortedAvailable = useMemo(() => {
    if (!isUserOnClock) return []
    const withScore = available.map(p => ({ p, s: scoreProspect(currentTeam, p) }))
    if (sortKey === 'rank') return withScore.sort((a, b) => (a.p.rank ?? 999) - (b.p.rank ?? 999))
    if (sortKey === 'fv')   return withScore.sort((a, b) => (b.p.fv ?? 0)   - (a.p.fv ?? 0))
    if (sortKey === 'fit')  return withScore.sort((a, b) => b.s - a.s)
    return withScore
  }, [isUserOnClock, available, currentTeam, sortKey])

  // Roll through every non-user pick, auto-selecting via pickBestForTeam,
  // then commit state and pause. Pure — takes the starting slice and returns
  // the new state via setState calls at the end.
  const runToNextUserPick = (orgId, startMade, startPool, startIdx) => {
    let made = startMade
    let pool = startPool
    let idx  = startIdx
    while (idx < teamOrder.length && pool.length > 0) {
      const team = teamOrder[idx]
      if (orgId && orgOf(team.id) === orgId) break
      const { idx: bestIdx, score } = pickBestForTeam(team, pool)
      if (bestIdx < 0) break
      const chosen = pool[bestIdx]
      made = [...made, { pick: team.pick, team, prospect: chosen, score, user: false }]
      pool = pool.filter(p => p.id !== chosen.id)
      idx += 1
    }
    setPicks(made)
    setAvailable(pool)
    setCurrentIdx(idx)
  }

  const selectTeam = (orgId) => {
    setUserOrgId(orgId)
    runToNextUserPick(orgId, [], prospectsData.prospects, 0)
  }

  const handleUserPick = (prospectId) => {
    const team = teamOrder[currentIdx]
    const prospect = available.find(p => p.id === prospectId)
    if (!prospect) return
    const score = scoreProspect(team, prospect)
    const made = [...picks, { pick: team.pick, team, prospect, score, user: true }]
    const pool = available.filter(p => p.id !== prospectId)
    runToNextUserPick(userOrgId, made, pool, currentIdx + 1)
  }

  const reset = () => {
    setUserOrgId(null)
    setPicks([])
    setAvailable(prospectsData.prospects)
    setCurrentIdx(0)
    setSortKey('rank')
  }

  // ── Render: team-picker phase ───────────────────────────────────────
  if (!userOrgId) {
    const orgs = [...new Set(teamOrder.map(t => orgOf(t.id)))]
      .map(id => teamOrder.find(t => orgOf(t.id) === id))
      .sort((a, b) => a.name.localeCompare(b.name))

    return (
      <>
        <div className="page-title">User simulator</div>
        <div className="page-sub">
          Draft as any team · sim auto-picks the other 29 · rounds 1-2
        </div>
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-title">Pick your team</div>
          <div className="grid-4" style={{ gap: 10 }}>
            {orgs.map(t => (
              <button
                key={t.id}
                onClick={() => selectTeam(orgOf(t.id))}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid var(--border-2)`,
                  borderLeft: `4px solid ${t.color}`,
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--font)',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
              >
                <div style={{ fontFamily: 'var(--display)', fontSize: 13, fontWeight: 700, letterSpacing: '.005em', color: 'var(--fg)' }}>
                  {cleanTeamName(t).toUpperCase()}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{t.city}</div>
              </button>
            ))}
          </div>
        </div>
      </>
    )
  }

  // ── Render: drafting phase ──────────────────────────────────────────
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, marginBottom: 4 }}>
        <div className="page-title" style={{ margin: 0 }}>User simulator</div>
        <span style={{ fontFamily: 'var(--display)', fontSize: 13, fontWeight: 700, letterSpacing: '.06em', color: userColor, textTransform: 'uppercase' }}>
          Drafting as {userTeamName}
        </span>
        <button onClick={reset} className="btn" style={{ marginLeft: 'auto' }}>Reset</button>
      </div>
      <div className="page-sub">
        {done
          ? 'Draft complete — R1+R2 wrapped'
          : isUserOnClock
            ? `You are on the clock at pick #${currentTeam.pick}`
            : `Auto-drafting through pick #${currentTeam?.pick}...`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isUserOnClock ? '1fr 1fr' : '1fr', gap: 18 }}>
        <div className="panel" style={{ padding: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <div className="panel-title" style={{ margin: 0 }}>Draft board</div>
          </div>
          <div style={{ maxHeight: isUserOnClock ? 700 : 900, overflowY: 'auto' }}>
            {picks.length === 0 ? (
              <div className="muted" style={{ padding: 18, fontSize: 13 }}>No picks yet.</div>
            ) : (
              picks.map(({ pick, team, prospect, user }) => (
                <div
                  key={pick}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '50px 220px 1fr',
                    gap: 12,
                    alignItems: 'center',
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    background: user ? `${userColor}0d` : 'transparent',
                    borderLeft: user ? `3px solid ${userColor}` : '3px solid transparent',
                  }}
                >
                  <div className="pick-num">#{pick}</div>
                  <div style={{
                    fontFamily: 'var(--display)',
                    fontSize: 13,
                    fontWeight: user ? 700 : 500,
                    letterSpacing: '.005em',
                    color: 'var(--fg)',
                  }}>
                    <span style={{ display: 'inline-block', width: 3, height: 12, background: team.color, marginRight: 8, verticalAlign: 'middle', borderRadius: 2 }} />
                    {cleanTeamName(team).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>
                      {user && <span style={{ fontSize: 10, marginRight: 6, color: userColor, fontFamily: 'var(--display)', letterSpacing: '.06em' }}>YOU →</span>}
                      <Link to={`/players/${prospect.id}`}>{prospect.name}</Link>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      <span className={`pos-pill ${prospect.tier === 'PIT' ? 'pit' : 'hit'}`}>{prospect.pos}</span>
                      {' '}· {prospect.level} · rk {prospect.rank ?? '—'} · FV {prospect.fv}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {isUserOnClock && (
          <div className="panel" style={{ padding: 0 }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="panel-title" style={{ margin: 0 }}>
                Pick #{currentTeam.pick} · {cleanTeamName(currentTeam)}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {['rank', 'fv', 'fit'].map(k => (
                  <button
                    key={k}
                    onClick={() => setSortKey(k)}
                    className="btn"
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      background: sortKey === k ? 'var(--navy)' : 'var(--surface)',
                      color: sortKey === k ? '#fff' : 'var(--fg-2)',
                      borderColor: sortKey === k ? 'var(--navy)' : 'var(--border-2)',
                    }}
                  >
                    {k === 'rank' ? 'Board rank' : k === 'fv' ? 'FV' : 'Fit'}
                  </button>
                ))}
              </div>
            </div>
            {currentTeam.needs && (
              <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--display)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Team needs</span>
                {currentTeam.needs.map(n => <span key={n} className="pos-pill">{n}</span>)}
              </div>
            )}
            <div style={{ maxHeight: 620, overflowY: 'auto' }}>
              {sortedAvailable.slice(0, 25).map(({ p, s }, i) => {
                const isTopRec = sortKey === 'fit' ? i === 0 : sortedAvailable[0].p.id === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => handleUserPick(p.id)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '40px 1fr 60px 60px 70px',
                      gap: 10,
                      alignItems: 'center',
                      width: '100%',
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      background: 'var(--surface)',
                      border: 'none',
                      borderLeft: isTopRec ? `3px solid var(--red)` : '3px solid transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font)',
                      transition: 'background .12s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                  >
                    <div className="mono" style={{ color: 'var(--fg-3)', fontSize: 12 }}>#{p.rank ?? '—'}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>{p.name}</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        <span className={`pos-pill ${p.tier === 'PIT' ? 'pit' : 'hit'}`}>{p.pos}</span>
                        {' '}· {p.level} · {p.school}
                      </div>
                    </div>
                    <div className="mono" style={{ fontSize: 13, color: 'var(--fg-2)' }}>FV {p.fv}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', textTransform: 'capitalize' }}>{p.signability}</div>
                    <div className="mono" style={{ fontSize: 13, textAlign: 'right', color: 'var(--navy)' }}>{s.toFixed(1)}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {done && (
        <div style={{ marginTop: 18 }}>
          <button onClick={reset} className="btn btn-primary">Draft again</button>
        </div>
      )}
    </>
  )
}
