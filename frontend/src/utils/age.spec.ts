import { describe, it, expect } from 'vitest';
import { ageOnChileDay, isMinorOnChileDay } from './age';

describe('ageOnChileDay', () => {
  it('counts whole years, not yet incremented before the birthday', () => {
    const now = new Date('2026-06-15T15:00:00Z');
    expect(ageOnChileDay('2008-06-16', now)).toBe(17);
    expect(ageOnChileDay('2008-06-15', now)).toBe(18);
    expect(ageOnChileDay('1990-01-01', now)).toBe(36);
  });

  it('uses the Chile calendar day, not the UTC day', () => {
    // 02:00 UTC on Oct 8 is still Oct 7 in Santiago (UTC-3).
    const now = new Date('2026-10-08T02:00:00Z');
    expect(ageOnChileDay('2008-10-08', now)).toBe(17);
    expect(ageOnChileDay('2008-10-07', now)).toBe(18);
  });

  it('returns null for an empty or malformed date', () => {
    expect(ageOnChileDay('')).toBeNull();
    expect(ageOnChileDay('08/10/2008')).toBeNull();
  });
});

describe('isMinorOnChileDay', () => {
  it('is true the day before the 18th birthday and false on it', () => {
    const now = new Date('2026-06-15T15:00:00Z');
    expect(isMinorOnChileDay('2008-06-16', now)).toBe(true);
    expect(isMinorOnChileDay('2008-06-15', now)).toBe(false);
  });

  it('is false for an invalid date', () => {
    expect(isMinorOnChileDay('')).toBe(false);
  });
});
