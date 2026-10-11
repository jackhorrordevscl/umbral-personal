import { calculateAge, getAgeBand, isMinor } from './age.util';

// `now` instants are noon UTC (08:00-09:00 in Santiago), so the Chile calendar
// day matches the UTC day and the cases read naturally.
const at = (day: string) => new Date(`${day}T12:00:00Z`);

describe('calculateAge', () => {
  it('counts the birthday itself as a completed year', () => {
    expect(calculateAge('2010-06-15', at('2024-06-15'))).toBe(14);
  });

  it('does not count the year the day before the birthday', () => {
    expect(calculateAge('2010-06-15', at('2024-06-14'))).toBe(13);
  });

  it('accounts for the month, not only the day of month', () => {
    expect(calculateAge('2010-06-15', at('2024-05-30'))).toBe(13);
    expect(calculateAge('2010-06-15', at('2024-07-01'))).toBe(14);
  });

  it('is 0 for a baby born earlier the same year', () => {
    expect(calculateAge('2024-01-10', at('2024-06-15'))).toBe(0);
  });

  it('treats a Feb 29 birthday as completed on Mar 1 in non-leap years', () => {
    expect(calculateAge('2000-02-29', at('2001-02-28'))).toBe(0);
    expect(calculateAge('2000-02-29', at('2001-03-01'))).toBe(1);
    expect(calculateAge('2000-02-29', at('2004-02-29'))).toBe(4);
  });

  it('accepts a Date stored as UTC midnight (Prisma birthDate)', () => {
    expect(
      calculateAge(new Date('2010-06-15T00:00:00.000Z'), at('2024-06-15')),
    ).toBe(14);
    expect(
      calculateAge(new Date('2010-06-15T00:00:00.000Z'), at('2024-06-14')),
    ).toBe(13);
  });

  it('uses the Chile calendar day for "today", not the UTC day', () => {
    // 2024-06-16T01:00Z is still 2024-06-15 21:00 in Santiago (UTC-4 in June).
    const lateNight = new Date('2024-06-16T01:00:00Z');
    expect(calculateAge('2010-06-16', lateNight)).toBe(13);
    expect(calculateAge('2010-06-15', lateNight)).toBe(14);
  });

  it('returns a negative age for a future birth date', () => {
    expect(calculateAge('2026-12-01', at('2026-10-08'))).toBe(-1);
    expect(calculateAge('2027-10-08', at('2026-10-08'))).toBe(-1);
    expect(calculateAge('2028-10-08', at('2026-10-08'))).toBe(-2);
  });

  it('defaults now to the current time', () => {
    expect(calculateAge('1990-01-01')).toBeGreaterThanOrEqual(36);
  });

  it('throws on an unparseable date', () => {
    expect(() => calculateAge('not-a-date', at('2026-10-08'))).toThrow();
  });
});

describe('isMinor', () => {
  it('is true the day before the 18th birthday', () => {
    expect(isMinor('2006-10-09', at('2024-10-08'))).toBe(true);
  });

  it('is false on the 18th birthday', () => {
    expect(isMinor('2006-10-08', at('2024-10-08'))).toBe(false);
  });

  it('is false for adults', () => {
    expect(isMinor('1990-01-01', at('2026-10-08'))).toBe(false);
  });

  it('is true for a future birth date (negative age)', () => {
    expect(isMinor('2030-01-01', at('2026-10-08'))).toBe(true);
  });
});

describe('getAgeBand', () => {
  it('is UNDER_14 until the day before the 14th birthday', () => {
    expect(getAgeBand('2010-10-09', at('2024-10-08'))).toBe('UNDER_14');
  });

  it('is AGE_14_17 exactly on the 14th birthday', () => {
    expect(getAgeBand('2010-10-08', at('2024-10-08'))).toBe('AGE_14_17');
  });

  it('is AGE_14_17 the day before the 18th birthday', () => {
    expect(getAgeBand('2006-10-09', at('2024-10-08'))).toBe('AGE_14_17');
  });

  it('is ADULT exactly on the 18th birthday', () => {
    expect(getAgeBand('2006-10-08', at('2024-10-08'))).toBe('ADULT');
  });

  it('is UNDER_14 for newborns', () => {
    expect(getAgeBand('2026-10-08', at('2026-10-08'))).toBe('UNDER_14');
  });
});
