import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupDto } from '../../modules/auth/dto/signup.dto';
import { UpdateProfileDto } from '../../modules/profile/dto/update-profile.dto';
import { CreatePatientDto } from '../../modules/patients/dto/create-patient.dto';
import { UpdatePatientDto } from '../../modules/patients/dto/update-patient.dto';
import { PublicBookingPatientDto } from '../../modules/public-scheduling/dto/public-booking-patient.dto';

// Issue #300: los nombres se acotan, se recortan y no admiten caracteres de
// control.
type Case = {
  label: string;
  field: string;
  build: (name: unknown) => object;
};

const patientBase = { rut: '12345678-5', birthDate: '1990-01-01' };

const cases: Case[] = [
  {
    label: 'SignupDto.name',
    field: 'name',
    build: (name) =>
      plainToInstance(SignupDto, {
        email: 'a@b.cl',
        password: '12345678',
        inviteCode: 'abc',
        name,
      }),
  },
  {
    label: 'UpdateProfileDto.name',
    field: 'name',
    build: (name) => plainToInstance(UpdateProfileDto, { name }),
  },
  {
    label: 'CreatePatientDto.fullName',
    field: 'fullName',
    build: (fullName) =>
      plainToInstance(CreatePatientDto, { ...patientBase, fullName }),
  },
  {
    label: 'UpdatePatientDto.fullName',
    field: 'fullName',
    build: (fullName) =>
      plainToInstance(UpdatePatientDto, {
        fullName,
        reason: 'Corrección del nombre',
      }),
  },
  {
    label: 'PublicBookingPatientDto.fullName',
    field: 'fullName',
    build: (fullName) =>
      plainToInstance(PublicBookingPatientDto, {
        ...patientBase,
        email: 'a@b.cl',
        fullName,
      }),
  },
];

describe.each(cases)('$label', ({ field, build }) => {
  const props = async (name: unknown) =>
    (await validate(build(name))).map((e) => e.property);

  it.each(['José Núñez', "O'Brien", 'Ana María de los Ángeles'])(
    'acepta %s',
    async (name) => {
      expect(await props(name)).not.toContain(field);
    },
  );

  it('rechaza un nombre de 201 caracteres', async () => {
    expect(await props('x'.repeat(201))).toContain(field);
  });

  it('acepta un nombre de exactamente 200 caracteres', async () => {
    expect(await props('x'.repeat(200))).not.toContain(field);
  });

  it.each(['Ana\nPérez', 'Ana\u0000', 'Ana\tPérez', 'Ana\u0085'])(
    'rechaza caracteres de control (%j)',
    async (name) => {
      expect(await props(name)).toContain(field);
    },
  );

  it('recorta espacios al inicio y al final', async () => {
    const dto = build('  Ana Pérez  ') as Record<string, string>;

    expect(dto[field]).toBe('Ana Pérez');
    expect(await props('  Ana Pérez  ')).not.toContain(field);
  });

  it('rechaza valores que no son string', async () => {
    expect(await props(123)).toContain(field);
  });
});

describe('nombre vacío tras recortar', () => {
  it('SignupDto rechaza un name solo con espacios', async () => {
    const dto = plainToInstance(SignupDto, {
      email: 'a@b.cl',
      password: '12345678',
      inviteCode: 'abc',
      name: '   ',
    });

    expect((await validate(dto)).map((e) => e.property)).toContain('name');
  });

  it('UpdateProfileDto rechaza un name solo con espacios', async () => {
    const dto = plainToInstance(UpdateProfileDto, { name: '   ' });

    expect((await validate(dto)).map((e) => e.property)).toContain('name');
  });
});
