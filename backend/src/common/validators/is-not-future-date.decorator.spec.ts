import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IsNotFutureDate } from './is-not-future-date.decorator';
import { chileDayKeyFromInstant } from '../utils/chile-time.util';

class Sample {
  @IsNotFutureDate()
  birthDate: string;
}

const check = async (birthDate: unknown) =>
  (await validate(plainToInstance(Sample, { birthDate }))).length === 0;

const dayKeyOffset = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return chileDayKeyFromInstant(d);
};

describe('IsNotFutureDate', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts a past date', async () => {
    expect(await check('1990-01-01')).toBe(true);
  });

  it('accepts today (Chile calendar day)', async () => {
    expect(await check(dayKeyOffset(0))).toBe(true);
  });

  it('rejects tomorrow', async () => {
    expect(await check(dayKeyOffset(1))).toBe(false);
  });

  it('rejects a far future date', async () => {
    expect(await check('2999-01-01')).toBe(false);
  });

  it('compares by Chile calendar day, not by UTC day', async () => {
    // 2026-06-16T01:00Z is still 2026-06-15 21:00 in Santiago (UTC-4 in
    // winter); the UTC day is already the 16th.
    jest.useFakeTimers().setSystemTime(new Date('2026-06-16T01:00:00Z'));
    expect(await check('2026-06-15')).toBe(true);
    expect(await check('2026-06-16')).toBe(false);
  });

  it('accepts an ISO datetime whose UTC day is not in the future', async () => {
    expect(await check('1990-01-01T10:00:00.000Z')).toBe(true);
  });

  it('rejects non-string values', async () => {
    expect(await check(undefined)).toBe(false);
    expect(await check(12345)).toBe(false);
  });

  it('rejects an unparseable string', async () => {
    expect(await check('nope')).toBe(false);
  });

  it('reports a Spanish message', async () => {
    const errors = await validate(
      plainToInstance(Sample, { birthDate: '2999-01-01' }),
    );
    expect(Object.values(errors[0].constraints ?? {})[0]).toBe(
      'La fecha no puede ser futura',
    );
  });
});
