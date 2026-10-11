export type Frequency = 'daily' | 'weekly' | 'monthly';

/** Next run strictly after `from`, at `hourUtc`: every day, on Mondays, or on the 1st. */
export function nextRun(frequency: Frequency, hourUtc: number, from = new Date()): Date {
  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUtc),
  );
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  if (frequency === 'weekly') next.setUTCDate(next.getUTCDate() + ((8 - next.getUTCDay()) % 7));
  if (frequency === 'monthly' && next.getUTCDate() !== 1)
    next.setUTCMonth(next.getUTCMonth() + 1, 1);
  return next;
}
