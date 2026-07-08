/*
 * PickDistChart: inline histogram of P(taken at pick N) across the draft.
 *
 * - One bar per pick number in [from..to].
 * - Bar height scales to the max probability in the distribution.
 * - The 80% interval is highlighted in navy; the median pick in red.
 * - Bars outside the interval render as a subtle gray (so the shape of
 *   the long tail is still visible).
 *
 * Props
 *   dist     : { pickNum: prob }   the player's pickDist from Monte Carlo
 *   summary  : { p10, p50, p90 }   output of summarizePickDist()
 *   from     : number (default 1)
 *   to       : number (default 60)
 */
export default function PickDistChart({ dist = {}, summary, from = 1, to = 60, height = 70 }) {
  const probs = Object.values(dist)
  const maxProb = probs.length ? Math.max(...probs) : 0.01
  const ticks = [from, Math.round((from + to) / 2), to]

  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        height,
        gap: 1,
        padding: '4px 0',
      }}>
        {Array.from({ length: to - from + 1 }, (_, i) => {
          const pick = i + from
          const prob = dist[pick] ?? 0
          const h = maxProb > 0 ? (prob / maxProb) * 100 : 0
          const inRange = summary && summary.p10 != null && summary.p90 != null
            && pick >= summary.p10 && pick <= summary.p90
          const isMedian = summary && pick === summary.p50
          const bg = isMedian ? 'var(--red)' : inRange ? 'var(--navy)' : 'var(--border-2)'
          return (
            <div
              key={pick}
              style={{
                flex: 1,
                height: `${Math.max(h, prob > 0 ? 2 : 1)}%`,
                background: bg,
                borderRadius: '1px 1px 0 0',
                minHeight: 1,
                opacity: prob > 0 ? 1 : 0.35,
              }}
              title={`#${pick}: ${Math.round(prob * 100)}%`}
            />
          )
        })}
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 4,
        fontFamily: 'var(--mono)',
        fontSize: 10,
        color: 'var(--fg-3)',
      }}>
        {ticks.map(t => <span key={t}>#{t}</span>)}
      </div>
      <div style={{
        display: 'flex',
        gap: 14,
        marginTop: 8,
        fontSize: 11,
        color: 'var(--fg-3)',
      }}>
        <Legend swatch="var(--red)"      label="median" />
        <Legend swatch="var(--navy)"     label="80% interval" />
        <Legend swatch="var(--border-2)" label="tail" />
      </div>
    </div>
  )
}

const Legend = ({ swatch, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
    <span style={{ width: 8, height: 8, background: swatch, borderRadius: 2 }} />
    {label}
  </span>
)
