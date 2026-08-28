import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConsultationRangeQueryDto } from './consultation-range-query.dto';

async function validateRange(from: string, to: string) {
  const dto = plainToInstance(ConsultationRangeQueryDto, { from, to });
  return validate(dto);
}

describe('ConsultationRangeQueryDto', () => {
  it('accepts ISO instants with explicit offset', async () => {
    const errors = await validateRange(
      '2026-09-01T00:00:00-04:00',
      '2026-10-01T00:00:00-03:00',
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts ISO instants with Z (UTC)', async () => {
    const errors = await validateRange(
      '2026-09-01T00:00:00Z',
      '2026-10-01T00:00:00Z',
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects date-only strings even though they are valid ISO8601', async () => {
    const errors = await validateRange('2026-09-01', '2026-10-01');
    expect(errors).toHaveLength(2);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('rejects a garbage string', async () => {
    const errors = await validateRange('not-a-date', '2026-10-01T00:00:00Z');
    expect(errors.length).toBeGreaterThan(0);
  });
});
