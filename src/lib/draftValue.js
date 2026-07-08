/*
 * Per-FO career-outcome aggregates from scripts/training/draft_value.json.
 *
 * Each entry has:
 *   - sampleN  : rated picks (excludes TBD)
 *   - counts   : { star, regular, fringe, bust, tbd, unrated }
 *   - avgScore : star=4, regular=2, fringe=1, bust=0 → mean
 *   - verdict  : STRONG / ABOVE-AVG / AVERAGE / BELOW-AVG / POOR (null if N<3)
 *   - exemplars: up to 3 names each for stars and busts
 *
 * Returns null for FOs we haven't annotated (mostly newer regimes).
 */
import data from '../../scripts/training/draft_value.json'

export const draftValueFor = (foId) => data.perFO?.[foId] ?? null
export const draftValueMeta = data._meta
