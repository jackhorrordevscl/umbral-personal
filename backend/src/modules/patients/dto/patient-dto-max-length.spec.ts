import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePatientDto } from './create-patient.dto';
import { UpdatePatientDto } from './update-patient.dto';
import { RecordConsentDto } from './record-consent.dto';
import { BulkDeclareConsentDto } from './bulk-declare-consent.dto';

// Issue #195: los campos de texto libre se clonan completos en
// PatientHistory.snapshot/diff en cada edición, así que se acotan.
describe('límites de longitud en DTOs de patients', () => {
  const validCreate = {
    fullName: 'Ana Pérez',
    rut: '12345678-5',
    birthDate: '1990-01-01',
  };

  it('acepta un paciente con valores dentro de los límites', async () => {
    const dto = plainToInstance(CreatePatientDto, validCreate);

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    'fullName',
    'occupation',
    'address',
    'phone',
    'emergencyContactName',
    'emergencyContactPhone',
    'treatingPsychiatrist',
    'treatingDoctor',
  ])('CreatePatientDto rechaza %s de 5000 caracteres', async (field) => {
    const dto = plainToInstance(CreatePatientDto, {
      ...validCreate,
      [field]: 'x'.repeat(5000),
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain(field);
  });

  it('CreatePatientDto rechaza un email de 300 caracteres', async () => {
    const dto = plainToInstance(CreatePatientDto, {
      ...validCreate,
      email: `${'a'.repeat(300)}@example.com`,
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('UpdatePatientDto rechaza un motivo de 5000 caracteres', async () => {
    const dto = plainToInstance(UpdatePatientDto, {
      reason: 'x'.repeat(5000),
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('RecordConsentDto rechaza evidencia de 5000 caracteres', async () => {
    const dto = plainToInstance(RecordConsentDto, {
      purpose: 'TREATMENT',
      action: 'GRANT',
      evidence: 'x'.repeat(5000),
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain('evidence');
  });

  it('BulkDeclareConsentDto rechaza evidencia de 5000 caracteres', async () => {
    const dto = plainToInstance(BulkDeclareConsentDto, {
      patientIds: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
      purpose: 'TREATMENT',
      evidence: 'x'.repeat(5000),
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain('evidence');
  });
});
