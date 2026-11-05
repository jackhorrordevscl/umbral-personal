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

  // Issue #635: @IsDateString() no estricto aceptaba fechas que no existen y
  // terminaban en un 500 (RangeError al armar la clave de caché).
  it.each([
    ['from', { from: '2026-02-30T00:00:00Z', to: '2026-09-10T00:00:00Z' }],
    ['to', { from: '2026-09-01T00:00:00Z', to: '2026-02-30T00:00:00Z' }],
    ['from', { from: '2026-09-31T00:00:00-04:00', to: '2026-10-05T00:00:00Z' }],
  ])(
    'rechaza una fecha que no existe en el calendario (%s)',
    async (property, body) => {
      const errors = await validate(
        plainToInstance(PublicAvailabilityQueryDto, body),
      );
      expect(errors.map((e) => e.property)).toEqual([property]);
    },
  );
});
