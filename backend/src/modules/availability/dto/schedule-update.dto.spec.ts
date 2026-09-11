// class-transformer's @Type() reads Reflect.getMetadata -- Nest's bootstrap
// (main.ts, via @nestjs/core) loads this polyfill process-wide, but an
// isolated DTO unit test never goes through bootstrap, so it needs its own
// import (must run before class-transformer's decorators execute).
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ScheduleUpdateDto } from './schedule-update.dto';

// sdd/patient-self-scheduling PR 2 (tasks.md 2.5): valida el body completo de
// `PUT /availability/schedule` -- sessionDurationMinutes + la grilla de
// entries, cada una con startMinute < endMinute (spec.md "Invalid time range
// is rejected").
describe('ScheduleUpdateDto', () => {
  function buildPlain(overrides: Record<string, unknown> = {}) {
    return {
      sessionDurationMinutes: 50,
      entries: [{ dayOfWeek: 1, startMinute: 540, endMinute: 780 }],
      ...overrides,
    };
  }

  it('acepta un schedule válido', async () => {
    const dto = plainToInstance(ScheduleUpdateDto, buildPlain());

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rechaza una entrada con startMinute >= endMinute', async () => {
    const dto = plainToInstance(
      ScheduleUpdateDto,
      buildPlain({
        entries: [{ dayOfWeek: 1, startMinute: 780, endMinute: 780 }],
      }),
    );

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza sessionDurationMinutes <= 0', async () => {
    const dto = plainToInstance(
      ScheduleUpdateDto,
      buildPlain({ sessionDurationMinutes: 0 }),
    );

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'sessionDurationMinutes')).toBe(
      true,
    );
  });

  // Triangulación: distinto campo inválido (dayOfWeek fuera de 1..7), mismo mecanismo.
  it('rechaza dayOfWeek fuera de rango 1..7', async () => {
    const dto = plainToInstance(
      ScheduleUpdateDto,
      buildPlain({
        entries: [{ dayOfWeek: 8, startMinute: 540, endMinute: 780 }],
      }),
    );

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('acepta múltiples entries válidas', async () => {
    const dto = plainToInstance(
      ScheduleUpdateDto,
      buildPlain({
        entries: [
          { dayOfWeek: 1, startMinute: 540, endMinute: 780 },
          { dayOfWeek: 3, startMinute: 840, endMinute: 1080 },
        ],
      }),
    );

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
