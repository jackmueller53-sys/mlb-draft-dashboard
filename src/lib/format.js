export const slotMap = {
  1: 11075800, 2: 8170600, 3: 7345700, 4: 6588200, 5: 5921500, 6: 5343900,
  7: 4956000, 8: 4612500, 9: 4297400, 10: 4014700, 11: 3754800, 12: 3508500,
  13: 3279300, 14: 3060900, 15: 2853400, 16: 2657200, 17: 2470600, 18: 2293000,
  19: 2123200, 20: 1962200, 21: 1808900, 22: 1664200, 23: 1527500, 24: 1397100,
  25: 1273900, 26: 1156700, 27: 1045400, 28: 939900, 29: 839500, 30: 743700
}

export const money = (n) => {
  if (n == null) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`
  return `$${n}`
}

export const fvColor = (fv) => {
  if (fv >= 60) return 'var(--goldL)'
  if (fv >= 55) return 'var(--gold)'
  if (fv >= 50) return 'var(--diamond)'
  return 'var(--fg2)'
}

export const slotFor = (pick) => slotMap[pick] ?? null

export const overUnder = (bonusExp, pick) => {
  const slot = slotFor(pick)
  if (!slot || !bonusExp) return null
  const diff = bonusExp - slot
  const pct = (diff / slot) * 100
  return { diff, pct }
}

export const posTier = (pos) => {
  const pitchers = ['RHP','LHP','SP','RP','P']
  return pitchers.includes(pos) ? 'PIT' : 'HIT'
}
