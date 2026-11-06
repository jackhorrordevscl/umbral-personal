import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CorrectConsultationDto } from './correct-consultation.dto';
import {
  CONSULTATION_LIMITS,
  CreateConsultationDto,
} from './create-consultation.dto';

const baseCreate = {
  patientId: 'patient-1',
  sessionDate: '2026-11-01T15:00:00-03:00',
  consultReason: 'Motivo',
  intervention: 'Intervención',
};

const fields = ['consultReason', 'intervention', 'agreements'] as const;

describe('límites de texto de la consulta (issue #634)', () => {
  describe.each(fields)('%s', (field) => {
    const max = CONSULTATION_LIMITS[field];

    it('create acepta el largo máximo', async () => {
      const dto = plainToInstance(CreateConsultationDto, {
        ...baseCreate,
        [field]: 'a'.repeat(max),
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('create rechaza un texto más largo que el máximo', async () => {
      const dto = plainToInstance(CreateConsultationDto, {
        ...baseCreate,
        [field]: 'a'.repeat(max + 1),
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toEqual([field]);
      expect(errors[0].constraints).toHaveProperty('maxLength');
    });

    it('la corrección acepta el largo máximo', async () => {
      const dto = plainToInstance(CorrectConsultationDto, {
        [field]: 'a'.repeat(max),
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('la corrección rechaza un texto más largo que el máximo', async () => {
      const dto = plainToInstance(CorrectConsultationDto, {
        [field]: 'a'.repeat(max + 1),
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toEqual([field]);
      expect(errors[0].constraints).toHaveProperty('maxLength');
    });
  });
});
