import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BookPublicSlotDto } from './book-public-slot.dto';
import { chileDayKeyFromInstant } from '../../../common/utils/chile-time.util';

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

  // Issue #299: el endpoint es anónimo, así que rut/strings necesitan formato
  // y tope de largo.
  describe('límites y formato de patient (issue #299)', () => {
    async function patientErrorProps(patient: Record<string, unknown>) {
      const dto = plainToInstance(BookPublicSlotDto, {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient,
      });
      const errors = await validate(dto);
      return (
        errors
          .find((e) => e.property === 'patient')
          ?.children?.map((c) => c.property) ?? []
      );
    }

    it.each(['12345678-5', '12.345.678-5', '1.234.567-4', '7654321-6'])(
      'acepta el RUT %s',
      async (rut) => {
        expect(await patientErrorProps({ ...validPatient, rut })).toEqual([]);
      },
    );

    it.each(['arbitrario', '123', '12345678', '12.345.678', "1-1'; DROP--"])(
      'rechaza el RUT con formato inválido %s',
      async (rut) => {
        expect(await patientErrorProps({ ...validPatient, rut })).toContain(
          'rut',
        );
      },
    );

    // Issue #289: el DTO público valida solo la forma; el dígito verificador lo
    // exige el servicio al crear un paciente nuevo (una ficha existente puede
    // tenerlo inválido y debe poder autoagendarse).
    it('acepta un RUT con forma válida aunque el dígito verificador no coincida', async () => {
      expect(
        await patientErrorProps({ ...validPatient, rut: '12345678-9' }),
      ).toEqual([]);
    });

    it('rechaza una birthDate futura y acepta la de hoy', async () => {
      const today = chileDayKeyFromInstant(new Date());
      const tomorrow = chileDayKeyFromInstant(
        new Date(Date.now() + 86_400_000),
      );
      expect(
        await patientErrorProps({ ...validPatient, birthDate: tomorrow }),
      ).toContain('birthDate');
      expect(
        await patientErrorProps({ ...validPatient, birthDate: today }),
      ).toEqual([]);
    });

    it('rechaza fullName con más de 200 caracteres', async () => {
      expect(
        await patientErrorProps({ ...validPatient, fullName: 'x'.repeat(201) }),
      ).toContain('fullName');
    });

    it('rechaza email con más de 254 caracteres', async () => {
      const email = `${'a'.repeat(250)}@ejemplo.cl`;
      expect(await patientErrorProps({ ...validPatient, email })).toContain(
        'email',
      );
    });

    it('rechaza address, phone y ocupación por encima de su tope', async () => {
      const props = await patientErrorProps({
        ...validPatient,
        address: 'x'.repeat(301),
        phone: '1'.repeat(31),
        occupation: 'x'.repeat(201),
      });
      expect(props).toEqual(
        expect.arrayContaining(['address', 'phone', 'occupation']),
      );
    });
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
