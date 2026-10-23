export type CommissionSize = 'A4' | 'A3' | 'undecided';

/** Starting prices in cents. Final quotes depend on detail and complexity. */
export const commissionPrices = {
  A4: 9000,
  A3: 11000,
  extraSubject: 2000,
} as const;

export const MAX_SUBJECTS = 10;

/** Starting estimate for a size and number of subjects, or null when the size is open. */
export function commissionEstimate(size: CommissionSize, subjects: number): number | null {
  if (size === 'undecided') return null;
  const count = Math.min(MAX_SUBJECTS, Math.max(1, Math.trunc(subjects) || 1));
  return commissionPrices[size] + (count - 1) * commissionPrices.extraSubject;
}
