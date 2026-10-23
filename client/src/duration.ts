/** A playing time as "<1 min", "34 min" or "1 h 05 min". */
export function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
