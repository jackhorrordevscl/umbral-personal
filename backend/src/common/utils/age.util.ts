import type { AssentAgeBand } from '@prisma/client';
import { chileDayKeyFromInstant } from './chile-time.util';

export const ADULT_AGE = 18;
export const ASSENT_UNDER_14_LIMIT = 14;

export type AgeBand = AssentAgeBand | 'ADULT';

// birthDate is a calendar date stored as UTC midnight (new Date('YYYY-MM-DD')),
// so its day is read in UTC, like reports.service.ts does. "Today" is the Chile
// calendar day of `now` (the therapist's day), so a late-evening instant in
// Santiago does not tick the age over a day early.
function calendarParts(dayKey: string): [number, number, number] {
  const [year, month, day] = dayKey.split('-').map(Number);
  return [year, month, day];
}

function birthDayKey(birthDate: Date | string): string {
  const date = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid birthDate');
  }
  return date.toISOString().slice(0, 10);
}

// Completed years. A Feb 29 birthday is completed on Mar 1 in non-leap years.
// A future birth date yields a negative age (it is not clamped to 0), so
// callers can tell it apart from a newborn.
export function calculateAge(
  birthDate: Date | string,
  now: Date = new Date(),
): number {
  const [by, bm, bd] = calendarParts(birthDayKey(birthDate));
  const [ty, tm, td] = calendarParts(chileDayKeyFromInstant(now));
  const birthdayPassed = tm > bm || (tm === bm && td >= bd);
  return ty - by - (birthdayPassed ? 0 : 1);
}

export function isMinor(birthDate: Date | string, now?: Date): boolean {
  return calculateAge(birthDate, now) < ADULT_AGE;
}

export function getAgeBand(birthDate: Date | string, now?: Date): AgeBand {
  const age = calculateAge(birthDate, now);
  if (age >= ADULT_AGE) return 'ADULT';
  return age < ASSENT_UNDER_14_LIMIT ? 'UNDER_14' : 'AGE_14_17';
}
