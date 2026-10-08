import { toChileDayKey } from './datetime';

const BIRTH_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Age in whole years on the Chile calendar day of `now`, from a YYYY-MM-DD
// birth date (the value of an <input type="date">). Same criterion as the
// backend's minor check: the birthday counts from its Chile calendar day, not
// the UTC one. Returns null for an empty or malformed date.
export function ageOnChileDay(birthDate: string, now: Date = new Date()): number | null {
  const match = BIRTH_DATE_PATTERN.exec(birthDate);
  if (!match) return null;
  const [birthYear, birthMonth, birthDay] = match.slice(1).map(Number);
  const [year, month, day] = toChileDayKey(now.toISOString()).split('-').map(Number);
  const birthdayPending = month < birthMonth || (month === birthMonth && day < birthDay);
  return year - birthYear - (birthdayPending ? 1 : 0);
}

// True when the birth date makes the person under 18 on today's Chile day.
// An invalid date is not treated as a minor (the form reports it separately).
export function isMinorOnChileDay(birthDate: string, now: Date = new Date()): boolean {
  const age = ageOnChileDay(birthDate, now);
  return age !== null && age < 18;
}
