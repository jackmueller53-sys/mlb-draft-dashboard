import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import teamsData from '../data/teams.json'
import prospectsData from '../data/prospects.json'
import { scoreProspect, modelMetrics, preferenceVector } from '../lib/simulator.js'
import modelWeights from '../../scripts/training/model_weights.json'
import { foForTeamYear, foMeta } from '../lib/foLookup.js'
import { regimeEval } from '../lib/modelEval.js'
import { draftValueFor } from '../lib/draftValue.js'
import { bonusFor, bonusForFO, bonusVerdict, bonusMeta } from '../lib/bonusBehavior.js'

const VERDICT_STYLE = {
  GREEN: { bg: 'rgba(34, 139, 76, 0.10)', fg: '#1F7A3D', label: 'GREEN' },
  AMBER: { bg: 'rgba(202, 138, 4, 0.12)',  fg: '#9A6B00', label: 'AMBER' },
  RED:   { bg: 'rgba(200, 16, 46, 0.10)',  fg: '#A30D26', label: 'RED' },
}

const DV_STYLE = {
  STRONG:     { bg: 'rgba(34, 139, 76, 0.10)', fg: '#1F7A3D' },
  'ABOVE-AVG':{ bg: 'rgba(34, 139, 76, 0.06)', fg: '#1F7A3D' },
  AVERAGE:    { bg: 'rgba(202, 138, 4, 0.10)', fg: '#9A6B00' },
  'BELOW-AVG':{ bg: 'rgba(200, 16, 46, 0.06)', fg: '#A30D26' },
  POOR:       { bg: 'rgba(200, 16, 46, 0.12)', fg: '#A30D26' },
}

const BONUS_STYLE = {
  'OVER-SLOT':        { bg: 'rgba(34, 139, 76, 0.10)',  fg: '#1F7A3D' },
  BALANCED:           { bg: 'rgba(150, 150, 150, 0.10)', fg: 'var(--fg-2)' },
  'UNDER-SLOT':       { bg: 'rgba(202, 138, 4, 0.10)',  fg: '#9A6B00' },
  'WELL-UNDER-SLOT':  { bg: 'rgba(200, 16, 46, 0.10)',  fg: '#A30D26' },
}
import { getMC } from '../lib/mcCache.js'
import { money, slotFor } from '../lib/format.js'
import ProbBar from '../components/ProbBar.jsx'

const TendencyBar = ({ label, val }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>
      <span>{label}</span><span className="mono">{Math.round(val * 100)}%</span>
    </div>
    <div className="bar"><div style={{ width: `${val * 100}%` }} /></div>
  </div>
)

export default function TeamProfile() {
  const { teamId } = useParams()
  const team = teamsData.teams.find(t => t.id === teamId)

  const mc = useMemo(() => getMC(), [])

  if (!team) return <div>Team not found. <Link to="/teams">Back</Link></div>

  const slot = slotFor(team.pick)
  const t = team.tendencies
  const pref = preferenceVector(team)
  const foId = foForTeamYear(team.id, 2026)
  const fo   = foId ? foMeta(foId) : null
  const learned = pref.delta
  const FEATURES = modelWeights.features
  const evalRow  = foId ? regimeEval(foId) : null   // held-out CV verdict for this FO
  const vStyle   = evalRow ? VERDICT_STYLE[evalRow.verdict] : null
  const dv       = foId ? draftValueFor(foId) : null
  const dvStyle  = dv?.verdict ? DV_STYLE[dv.verdict] : null
  const orgId      = team.id.replace(/-(S|R2)$/, '')
  // Prefer per-FO bonus stats when available — picks up cross-team regimes.
  const bonus      = (foId && bonusForFO(foId)) || bonusFor(orgId)
  const bonusScope = (foId && bonusForFO(foId)) ? 'fo' : 'team'
  const bVerdict   = bonusVerdict(bonus)
  const bStyle     = bVerdict ? BONUS_STYLE[bVerdict] : null
  // Rank features by signed strength for this team's FO (or team fallback)
  const topPrefs = learned
    ? learned.map((v, k) => ({ name: FEATURES[k], v }))
        .filter(f => f.name !== 'fvNorm')
        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
        .slice(0, 4)
    : []

  /*
   * Top fits — only prospects realistically still on the board.
   *
   * Availability = P(prospect taken at pick ≥ team.pick) across the 1000-run
   * Monte Carlo distribution. Filter out anyone with <5% chance of being
   * there, then rank the survivors by deterministic fit score. This stops
   * the panel from suggesting a #25 team "fits" Cholowsky.
   */
  const AVAIL_FLOOR = 0.05
  const fits = [...prospectsData.prospects]
    .map(p => {
      const dist = mc.pickDist[p.id] || {}
      let avail = 0
      for (const pickStr in dist) {
        if (parseInt(pickStr, 10) >= team.pick) avail += dist[pickStr]
      }
      return { p, score: scoreProspect(team, p), avail }
    })
    .filter(({ avail }) => avail >= AVAIL_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  // Fit-score range across the shown targets, for normalizing the fit bar.
  const fitScores = fits.map(f => f.score)
  const fitMax = fitScores.length ? Math.max(...fitScores) : 1
  const fitMin = fitScores.length ? Math.min(...fitScores) : 0

  return (
    <div style={{ ['--team']: team.color }}>
      <div className="profile-bar" />
      <div style={{ height: 14 }} />

      <Link to="/teams" className="muted" style={{ fontSize: 13 }}>← All teams</Link>
      <div className="profile-head" style={{ marginTop: 8 }}>
        <div>
          <div className="profile-eyebrow">
            Pick #{team.pick}{team.supplemental ? ' (Supp.)' : ''} · {team.league} {team.div}
          </div>
          <div className="profile-name">{team.name}</div>
          <div className="profile-meta">
            <span>City <b>{team.city}</b></span>
            <span>Slot value <b>{money(slot)}</b></span>
            <span>Signability lean <b style={{ textTransform: 'capitalize' }}>{t.signability}</b></span>
          </div>
        </div>
      </div>

      {learned && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-title">
            Learned preference model{pref.source === 'fo' ? ' · front-office' : ' · team fallback'}
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 220 }}>
              <div className="kpi-label">Decision-maker</div>
              <div style={{ fontWeight: 600, marginTop: 4, fontSize: 15 }}>
                {fo?.name ?? '—'}
              </div>
              {fo && (
                <div className="muted" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
                  {fo.tenures.map((tn, i) => (
                    <div key={i}>
                      {tn.team} {tn.from}–{tn.to ?? 'now'}
                    </div>
                  ))}
                </div>
              )}
              <div className="kpi-label" style={{ marginTop: 14 }}>Trained on</div>
              <div className="mono" style={{ fontSize: 14, marginTop: 4 }}>
                {fo?.nPicks ?? '—'} historical picks (R1-R2)
              </div>
              <div className="kpi-label" style={{ marginTop: 12 }}
                   title="How often this front office's actual pick was inside the model's top-3 predicted targets, scored on the same drafts the model learned from. Inflated — see the accuracy on unseen years below.">
                Top-3 hit rate · on its own history
              </div>
              <div className="mono" style={{ fontSize: 14, marginTop: 4 }}>
                {fo ? Math.round(fo.top3Rate * 100) + '%' : '—'}
              </div>
              {evalRow && vStyle && (
                <>
                  <div className="kpi-label" style={{ marginTop: 12 }}
                       title="The honest accuracy: draft years are removed one at a time, the model is retrained on the rest, then asked to predict the held-out year. This is how often the actual pick landed in the model's top 3 on drafts it never trained on.">
                    Top-3 hit rate · on unseen years
                  </div>
                  <div className="mono" style={{ fontSize: 14, marginTop: 4 }}>
                    {evalRow.cvTop3 != null ? Math.round(evalRow.cvTop3 * 100) + '%' : '—'}
                    {' '}<span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                      (tested on {evalRow.cvN} picks)
                    </span>
                  </div>
                  <div style={{
                    display: 'inline-block',
                    marginTop: 12,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: vStyle.bg,
                    color: vStyle.fg,
                    fontFamily: 'var(--display)',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }} title={evalRow.verdict === 'GREEN'
                      ? '≥10 historical picks — high confidence'
                      : evalRow.verdict === 'AMBER'
                        ? '5-9 historical picks — usable but caveated'
                        : '<5 historical picks — predictions lean on league-average preferences'}>
                    {vStyle.label} · {evalRow.n} picks
                  </div>
                </>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div className="kpi-label">Distinctive preferences (vs. league avg)</div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {topPrefs.map(({ name, v }) => {
                  const pos = v >= 0
                  const mag = Math.min(Math.abs(v), 1)
                  return (
                    <div key={name} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 60px', alignItems: 'center', gap: 10 }}>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--fg-2)' }}>{name}</span>
                      <div style={{ display: 'flex', position: 'relative', height: 8, background: 'var(--surface-2)', borderRadius: 4 }}>
                        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--border-2)' }} />
                        <div style={{
                          position: 'absolute',
                          left: pos ? '50%' : `${50 - mag * 50}%`,
                          width: `${mag * 50}%`,
                          top: 0, bottom: 0,
                          background: pos ? 'var(--navy)' : 'var(--red)',
                          borderRadius: pos ? '0 4px 4px 0' : '4px 0 0 4px',
                        }} />
                      </div>
                      <span className="mono" style={{ fontSize: 12, color: pos ? 'var(--navy)' : 'var(--red)', textAlign: 'right' }}>
                        {pos ? '+' : ''}{v.toFixed(2)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {bonus && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-title">
            Slot &amp; signing-bonus behavior (2012-2024)
            {bonusScope === 'fo' && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.04em' }}>· FRONT-OFFICE</span>}
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 200 }}>
              <div className="kpi-label">Sample</div>
              <div className="mono" style={{ fontSize: 18, marginTop: 4 }}>{bonus.n} picks</div>
              <div className="kpi-label" style={{ marginTop: 12 }}>Avg over-slot</div>
              <div className="mono" style={{ fontSize: 22, marginTop: 4, color: bonus.rawMean >= 0 ? '#1F7A3D' : '#A30D26' }}>
                {bonus.rawMean >= 0 ? '+' : ''}{(bonus.rawMean * 100).toFixed(1)}%
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                median {bonus.rawMedian >= 0 ? '+' : ''}{(bonus.rawMedian * 100).toFixed(1)}%
              </div>
              {bVerdict && bStyle && (
                <div style={{
                  display: 'inline-block',
                  marginTop: 12,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: bStyle.bg,
                  color: bStyle.fg,
                  fontFamily: 'var(--display)',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }} title="Calibrated against league-wide raw-mean distribution.">
                  {bVerdict}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div className="kpi-label">Pick-by-pick mix</div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: 'Over slot  (>+2%)',  pct: bonus.overSlotPct,                          fg: '#1F7A3D' },
                  { label: 'Slot ±2%',           pct: 1 - bonus.overSlotPct - bonus.underSlotPct, fg: 'var(--fg-2)' },
                  { label: 'Under slot (<-2%)',  pct: bonus.underSlotPct,                         fg: '#A30D26' },
                ].map(({ label, pct, fg }) => (
                  <div key={label} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 50px', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{label}</span>
                    <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, position: 'relative' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(0, pct) * 100}%`, background: fg, borderRadius: 4 }} />
                    </div>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--fg-2)', textAlign: 'right' }}>{Math.round(pct * 100)}%</span>
                  </div>
                ))}
              </div>
              {bonusScope === 'fo' && bonus.tenures && (
                <div className="muted" style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6 }}>
                  Aggregated across{' '}
                  {bonus.tenures.map((t, i) => (
                    <span key={i}>
                      <span className="mono">{t.team} {t.from}–{t.to}</span>
                      {i < bonus.tenures.length - 1 ? ' → ' : ''}
                    </span>
                  ))}
                </div>
              )}
              {bonusScope === 'team' && typeof bonus.learnedIntercept === 'number' && (
                <div className="muted" style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6 }}>
                  Model intercept{' '}
                  <span className="mono">{bonus.learnedIntercept >= 0 ? '+' : ''}{bonus.learnedIntercept.toFixed(3)}</span>
                  {' '}— learned bonus tendency after controlling for level, position, and pick position.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {dv && dv.sampleN > 0 && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-title">Historical draft value (2014-2022)</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 220 }}>
              <div className="kpi-label">Rated picks</div>
              <div className="mono" style={{ fontSize: 22, marginTop: 4 }}>{dv.sampleN}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                top-15 picks 2014-2022{dv.counts.tbd ? `, ${dv.counts.tbd} TBD` : ''}
              </div>
              {dv.avgScore != null && (
                <>
                  <div className="kpi-label" style={{ marginTop: 14 }}>Avg outcome score</div>
                  <div className="mono" style={{ fontSize: 22, marginTop: 4 }}>
                    {dv.avgScore.toFixed(2)} <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>/ 4.00</span>
                  </div>
                </>
              )}
              {dv.verdict && dvStyle && (
                <div style={{
                  display: 'inline-block',
                  marginTop: 12,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: dvStyle.bg,
                  color: dvStyle.fg,
                  fontFamily: 'var(--display)',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }} title="Star = 4, Regular = 2, Fringe = 1, Bust = 0. Compared across all FOs.">
                  {dv.verdict}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div className="kpi-label">Outcome mix</div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { k: 'star',    label: 'Star',     fg: '#1F7A3D' },
                  { k: 'regular', label: 'Regular',  fg: 'var(--navy)' },
                  { k: 'fringe',  label: 'Fringe',   fg: 'var(--fg-2)' },
                  { k: 'bust',    label: 'Bust',     fg: 'var(--red)' },
                ].map(({ k, label, fg }) => {
                  const n = dv.counts[k]
                  const pct = dv.sampleN ? n / dv.sampleN : 0
                  return (
                    <div key={k} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 40px', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{label}</span>
                      <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, position: 'relative' }}>
                        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, background: fg, borderRadius: 4 }} />
                      </div>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--fg-2)', textAlign: 'right' }}>{n}</span>
                    </div>
                  )
                })}
              </div>
              {(dv.exemplars.star.length > 0 || dv.exemplars.bust.length > 0) && (
                <div style={{ marginTop: 14, fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                  {dv.exemplars.star.length > 0 && (
                    <div><span style={{ color: '#1F7A3D', fontWeight: 600 }}>Stars:</span> {dv.exemplars.star.join(', ')}</div>
                  )}
                  {dv.exemplars.bust.length > 0 && (
                    <div><span style={{ color: 'var(--red)', fontWeight: 600 }}>Busts:</span> {dv.exemplars.bust.join(', ')}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid-3">
        <div className="panel">
          <div className="panel-title">Tendencies</div>
          <TendencyBar label="High school" val={t.hs} />
          <TendencyBar label="College"     val={t.college} />
          <TendencyBar label="Pitcher"     val={t.pitcher} />
          <TendencyBar label="Hitter"      val={t.hitter} />
          <TendencyBar label="Risk tolerance" val={t.riskTolerance} />
        </div>
        <div className="panel">
          <div className="panel-title">Organizational needs</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {team.needs.map(n => <span key={n} className="pos-pill">{n}</span>)}
          </div>
          <div className="muted" style={{ lineHeight: 1.6, fontSize: 13 }}>{team.notes}</div>
        </div>
        <div className="panel">
          <div className="panel-title">Pick context</div>
          <div className="grade-row">
            <div className="grade-cell"><div className="lbl">Pick</div><div className="val">#{team.pick}</div></div>
            <div className="grade-cell"><div className="lbl">Slot</div><div className="val">{slot ? money(slot) : '—'}</div></div>
            <div className="grade-cell"><div className="lbl">League</div><div className="val">{team.league}</div></div>
          </div>
        </div>
      </div>

      <div className="spacer" />

      {/*
        Merged targets board: each prospect realistically available at this
        slot, with two bars — "likely available" (Monte-Carlo P(on the board
        at team.pick)) and "fit rating" (deterministic fit score, normalized
        across the shown candidates). Replaces the old separate "likely
        targets" and "top fits" panels.
      */}
      <div className="panel">
        <div className="panel-title">Draft targets at pick #{team.pick}</div>
        {fits.length === 0 ? (
          <div className="muted" style={{ padding: '12px 0', fontSize: 13 }}>
            No prospects clear the {Math.round(AVAIL_FLOOR * 100)}% availability threshold —
            everyone with a meaningful fit profile is projected gone before this slot.
          </div>
        ) : (
          <>
            <div className="targets-head">
              <div />
              <div className="kpi-label" style={{ margin: 0 }}>Player</div>
              <div className="kpi-label" style={{ margin: 0 }}>Likely available</div>
              <div className="kpi-label" style={{ margin: 0 }}>Fit rating</div>
            </div>
            {fits.map(({ p, score, avail }, i) => (
              <div key={p.id} className="targets-row">
                <div className="rank-cell" style={{ width: 'auto' }}>{i + 1}</div>
                <div>
                  <Link to={`/players/${p.id}`} style={{ color: 'var(--fg)', fontWeight: 700 }}>{p.name}</Link>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    <span className={`pos-pill ${p.tier === 'PIT' ? 'pit' : 'hit'}`}>{p.pos}</span>
                    {' '}· {p.level} · FV {p.fv}
                  </div>
                </div>
                <div className="targets-bar">
                  <span className="targets-bar-label">Available</span>
                  <ProbBar prob={avail} color={team.color} />
                </div>
                <div className="targets-bar">
                  <span className="targets-bar-label">Fit</span>
                  <FitBar score={score} min={fitMin} max={fitMax} />
                </div>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
              Likely available = share of {mc.n.toLocaleString()} simulated drafts where the player is still on the board at #{team.pick}.
              Fit rating = model score for this front office (talent + learned tendencies + roster need), scaled across the shown targets.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* Fit rating bar — normalizes the raw fit score across the shown candidates
 * so the strongest fit fills the bar and the weakest still reads meaningfully
 * (floored at 40%). Shows the raw score as the numeric label. */
function FitBar({ score, min, max }) {
  const span = max - min
  const pct = span > 0 ? 0.4 + 0.6 * (score - min) / span : 1
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--navy)', borderRadius: 4 }} />
      </div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--fg-2)', width: 32, textAlign: 'right' }}>{score.toFixed(0)}</div>
    </div>
  )
}
