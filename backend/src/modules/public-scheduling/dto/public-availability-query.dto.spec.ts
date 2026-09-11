import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublicAvailabilityQueryDto } from './public-availability-query.dto';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.7): mismo criterio de test
// que consultation-range-query.dto (patrón ya establecido en este código
// base) -- from/to deben ser instantes ISO CON offset explícito.
describe('PublicAvailabilityQueryDto', () => {
  it('acepta from/to como instantes ISO con offset explícito', async () => {
    const dto = plainToInstance(PublicAvailabilityQueryDto, {
      from: '2026-09-01T00:00:00-04:00',
      to: '2026-09-10T00:00:00-03:00',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza una fecha sin hora/offset (ambigua)', async () => {
    const dto = plainToInstance(PublicAvailabilityQueryDto, {
      from: '2026-09-01',
      to: '2026-09-10T00:00:00-03:00',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('from');
  });
});
