import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BookPublicSlotDto } from './book-public-slot.dto';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.7): valida slotStart +
// patient anidado (con @ValidateNested + @Type, mismo patrón que
// schedule-update.dto.spec.ts en availability/dto).
describe('BookPublicSlotDto', () => {
  const validPatient = {
    fullName: 'Paciente Público',
    rut: '11.111.111-1',
    birthDate: '1990-01-01',
    email: 'paciente@ejemplo.cl',
  };

  it('acepta slotStart + un patient válido', async () => {
    const dto = plainToInstance(BookPublicSlotDto, {
      slotStart: '2026-09-05T13:00:00.000Z',
      patient: validPatient,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza si patient no trae email (obligatorio para resolver identidad)', async () => {
    const { email: _email, ...withoutEmail } = validPatient;
    const dto = plainToInstance(BookPublicSlotDto, {
      slotStart: '2026-09-05T13:00:00.000Z',
      patient: withoutEmail,
    });
    const errors = await validate(dto);

    const patientErrors = errors.find((e) => e.property === 'patient');
    expect(patientErrors).toBeDefined();
    expect(patientErrors?.children?.some((c) => c.property === 'email')).toBe(
      true,
    );
  });

  it('rechaza si patient trae un email con formato inválido', async () => {
    const dto = plainToInstance(BookPublicSlotDto, {
      slotStart: '2026-09-05T13:00:00.000Z',
      patient: { ...validPatient, email: 'no-es-un-email' },
    });
    const errors = await validate(dto);

    const patientErrors = errors.find((e) => e.property === 'patient');
    expect(patientErrors?.children?.some((c) => c.property === 'email')).toBe(
      true,
    );
  });

  // issue #157: origin es opcional -- clientes viejos (o navegadores sin
  // referrer) siguen pudiendo reservar sin mandarlo.
  describe('origin', () => {
    it('sigue siendo válido si origin está ausente', async () => {
      const dto = plainToInstance(BookPublicSlotDto, {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: validPatient,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('acepta origin con source y referrer dentro de los límites', async () => {
      const dto = plainToInstance(BookPublicSlotDto, {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: validPatient,
        origin: { source: 'google', referrer: 'https://google.com/search' },
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rechaza origin.source con más de 120 caracteres', async () => {
      const dto = plainToInstance(BookPublicSlotDto, {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: validPatient,
        origin: { source: 'x'.repeat(121) },
      });
      const errors = await validate(dto);

      const originErrors = errors.find((e) => e.property === 'origin');
      expect(originErrors?.children?.some((c) => c.property === 'source')).toBe(
        true,
      );
    });

    it('rechaza origin.referrer con más de 500 caracteres', async () => {
      const dto = plainToInstance(BookPublicSlotDto, {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: validPatient,
        origin: { referrer: 'https://x.cl/' + 'y'.repeat(500) },
      });
      const errors = await validate(dto);

      const originErrors = errors.find((e) => e.property === 'origin');
      expect(
        originErrors?.children?.some((c) => c.property === 'referrer'),
      ).toBe(true);
    });
  });
});
