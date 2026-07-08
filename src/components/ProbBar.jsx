/* Inline probability bar: width = prob (0..1), percentage label. */
export default function ProbBar({ prob, color = 'var(--navy)' }) {
  const pct = Math.round((prob ?? 0) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${(prob ?? 0) * 100}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--fg-2)', width: 38, textAlign: 'right' }}>{pct}%</div>
    </div>
  )
}
