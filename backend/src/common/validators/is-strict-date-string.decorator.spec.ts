import 'reflect-metadata';
import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePatientDto } from '../../modules/patients/dto/create-patient.dto';
import { CreateConsultationDto } from '../../modules/consultations/dto/create-consultation.dto';
import { CorrectConsultationDto } from '../../modules/consultations/dto/correct-consultation.dto';
import { UpdatePaymentAmountDto } from '../../modules/payments/dto/update-payment-amount.dto';
import { MAX_AMOUNT_CLP } from '../../modules/payments/payments.constants';

const consultationBase = {
  patientId: 'p-1',
  sessionDate: '2026-01-10',
  consultReason: 'Motivo',
  intervention: 'Intervención',
};
const patientBase = { fullName: 'Ana Pérez', rut: '12345678-5' };

async function failing(dto: object): Promise<string[]> {
  return (await validate(dto)).map((e) => e.property);
}

// Issue #289: @IsDateString() acepta 2026-02-30 y produce Invalid Date o un
// desplazamiento silencioso al mes siguiente.
describe('fechas estrictas en DTOs (issue #289)', () => {
  it.each([
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
    '2025-02-29',
    '2026-02-30T10:00:00Z',
    '2026-W05',
  ])('CreatePatientDto rechaza birthDate "%s"', async (birthDate) => {
    const dto = plainToInstance(CreatePatientDto, {
      ...patientBase,
      birthDate,
    });
    expect(await failing(dto)).toContain('birthDate');
  });

  it.each(['1990-02-28', '2024-02-29', '1990-01-01T10:00:00.000Z'])(
    'CreatePatientDto acepta birthDate "%s"',
    async (birthDate) => {
      const dto = plainToInstance(CreatePatientDto, {
        ...patientBase,
        birthDate,
      });
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  it.each(['sessionDate', 'nextSessionDate', 'scheduledAt'])(
    'CreateConsultationDto rechaza %s imposible',
    async (field) => {
      const dto = plainToInstance(CreateConsultationDto, {
        ...consultationBase,
        [field]: '2026-02-30',
      });
      expect(await failing(dto)).toContain(field);
    },
  );

  it('CreateConsultationDto acepta fechas reales', async () => {
    const dto = plainToInstance(CreateConsultationDto, {
      ...consultationBase,
      nextSessionDate: '2026-02-28',
      scheduledAt: '2026-01-10T15:00:00.000Z',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['sessionDate', 'nextSessionDate'])(
    'CorrectConsultationDto rechaza %s imposible',
    async (field) => {
      const dto = plainToInstance(CorrectConsultationDto, {
        [field]: '2026-02-30',
      });
      expect(await failing(dto)).toContain(field);
    },
  );
});

describe('montos acotados (issue #289)', () => {
  it('CreatePatientDto rechaza defaultSessionAmount sobre el máximo', async () => {
    const dto = plainToInstance(CreatePatientDto, {
      ...patientBase,
      birthDate: '1990-01-01',
      defaultSessionAmount: MAX_AMOUNT_CLP + 1,
    });
    expect(await failing(dto)).toContain('defaultSessionAmount');
  });

  it('CreatePatientDto acepta defaultSessionAmount en el máximo', async () => {
    const dto = plainToInstance(CreatePatientDto, {
      ...patientBase,
      birthDate: '1990-01-01',
      defaultSessionAmount: MAX_AMOUNT_CLP,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('el máximo queda por debajo del Int de Postgres', () => {
    expect(MAX_AMOUNT_CLP).toBeLessThan(2_147_483_647);
  });

  it.each([2_147_483_648, MAX_AMOUNT_CLP + 1])(
    'UpdatePaymentAmountDto rechaza amount %d',
    async (amount) => {
      const dto = plainToInstance(UpdatePaymentAmountDto, { amount });
      expect(await failing(dto)).toContain('amount');
    },
  );

  it('UpdatePaymentAmountDto acepta un monto normal', async () => {
    const dto = plainToInstance(UpdatePaymentAmountDto, { amount: 35000 });
    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('patientRut del cliente (issue #289)', () => {
  it('el ValidationPipe global rechaza patientRut en CreateConsultationDto', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: CreateConsultationDto,
    };

    await expect(
      pipe.transform({ ...consultationBase, patientRut: '1-9' }, metadata),
    ).rejects.toThrow();
    await expect(
      pipe.transform({ ...consultationBase }, metadata),
    ).resolves.toBeInstanceOf(CreateConsultationDto);
  });
});
