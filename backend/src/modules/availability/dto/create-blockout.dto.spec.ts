// Ver comentario en schedule-update.dto.spec.ts: @Type() de class-transformer
// necesita el polyfill de reflect-metadata, que un test unitario aislado
// (sin pasar por el bootstrap de Nest) debe importar explícitamente.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBlockoutDto } from './create-blockout.dto';

// sdd/patient-self-scheduling PR 2 (tasks.md 2.5, design.md Decision 4
// "Blockout shape"): un intervalo semiabierto [startsAt, endsAt) + kind
// presentacional. startsAt < endsAt (spec.md "Invalid time range is rejected").
describe('CreateBlockoutDto', () => {
  function buildPlain(overrides: Record<string, unknown> = {}) {
    return {
      startsAt: '2026-06-08T00:00:00.000Z',
      endsAt: '2026-06-09T00:00:00.000Z',
      kind: 'FULL_DAY',
      ...overrides,
    };
  }

  it('acepta un blockout válido', async () => {
    const dto = plainToInstance(CreateBlockoutDto, buildPlain());

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rechaza cuando endsAt no es posterior a startsAt', async () => {
    const dto = plainToInstance(
      CreateBlockoutDto,
      buildPlain({
        startsAt: '2026-06-08T12:00:00.000Z',
        endsAt: '2026-06-08T12:00:00.000Z',
      }),
    );

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza un kind fuera del enum', async () => {
    const dto = plainToInstance(
      CreateBlockoutDto,
      buildPlain({ kind: 'NOT_A_KIND' }),
    );

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'kind')).toBe(true);
  });

  // Triangulación: partial-day (rango corto, mismo día) también es válido.
  it('acepta un blockout parcial de un mismo día', async () => {
    const dto = plainToInstance(
      CreateBlockoutDto,
      buildPlain({
        startsAt: '2026-06-08T13:00:00.000Z',
        endsAt: '2026-06-08T14:00:00.000Z',
        kind: 'PARTIAL_DAY',
        reason: 'Reunión clínica',
      }),
    );

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
