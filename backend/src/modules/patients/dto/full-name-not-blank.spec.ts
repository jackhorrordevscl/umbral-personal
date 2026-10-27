import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePatientDto } from './create-patient.dto';
import { UpdatePatientDto } from './update-patient.dto';
import { CreateGuardianDto } from './create-guardian.dto';
import { UpdateGuardianDto } from './update-guardian.dto';

const patient = {
  fullName: 'Ana Pérez',
  rut: '12345678-5',
  birthDate: '1990-01-01',
};
const guardian = {
  fullName: 'María Soto',
  rut: '12345678-5',
  relationship: 'MOTHER',
};
const reason = { reason: 'Corrección de datos del paciente' };

async function failedProperties(cls: new () => object, plain: object) {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('fullName no puede quedar vacío ni solo con espacios', () => {
  it.each(['', '   '])('CreatePatientDto rechaza %j', async (fullName) => {
    expect(
      await failedProperties(CreatePatientDto, { ...patient, fullName }),
    ).toContain('fullName');
  });

  it.each(['', '   '])('UpdatePatientDto rechaza %j', async (fullName) => {
    expect(
      await failedProperties(UpdatePatientDto, { ...reason, fullName }),
    ).toContain('fullName');
  });

  it.each(['', '   '])('CreateGuardianDto rechaza %j', async (fullName) => {
    expect(
      await failedProperties(CreateGuardianDto, { ...guardian, fullName }),
    ).toContain('fullName');
  });

  it.each(['', '   '])('UpdateGuardianDto rechaza %j', async (fullName) => {
    expect(await failedProperties(UpdateGuardianDto, { fullName })).toContain(
      'fullName',
    );
  });

  it('un nombre normal sigue pasando en los cuatro DTO', async () => {
    expect(await failedProperties(CreatePatientDto, patient)).toEqual([]);
    expect(
      await failedProperties(UpdatePatientDto, {
        ...reason,
        fullName: 'Ana Pérez',
      }),
    ).toEqual([]);
    expect(await failedProperties(CreateGuardianDto, guardian)).toEqual([]);
    expect(
      await failedProperties(UpdateGuardianDto, { fullName: 'María Soto' }),
    ).toEqual([]);
  });
});
