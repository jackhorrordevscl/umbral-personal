import {
  resolvePatientPayerEmail,
  resolvePatientRecipient,
  type RecipientGuardian,
  type RecipientPatient,
} from './resolve-patient-recipient';

const NOW = new Date('2026-10-08T15:00:00Z');

function guardian(
  overrides: Partial<RecipientGuardian> = {},
): RecipientGuardian {
  return {
    fullName: 'Guardian One',
    email: 'g1@example.com',
    isPayer: false,
    receivesCommunications: true,
    ...overrides,
  };
}

function patient(overrides: Partial<RecipientPatient> = {}): RecipientPatient {
  return {
    fullName: 'Pat Ient',
    email: 'patient@example.com',
    birthDate: new Date('1990-01-01'),
    guardians: [],
    ...overrides,
  };
}

const MINOR = new Date('2015-05-05');

describe('resolvePatientRecipient', () => {
  it('returns the patient for an adult, ignoring guardians', () => {
    const result = resolvePatientRecipient(
      patient({ guardians: [guardian()] }),
      NOW,
    );
    expect(result).toEqual({
      kind: 'PATIENT',
      email: 'patient@example.com',
      recipientName: 'Pat Ient',
      patientName: 'Pat Ient',
    });
  });

  it('returns a null email for an adult without email', () => {
    expect(
      resolvePatientRecipient(patient({ email: null }), NOW).email,
    ).toBeNull();
  });

  it('prefers the payer guardian that receives communications', () => {
    const result = resolvePatientRecipient(
      patient({
        birthDate: MINOR,
        guardians: [
          guardian(),
          guardian({
            fullName: 'Payer',
            email: 'p@example.com',
            isPayer: true,
          }),
        ],
      }),
      NOW,
    );
    expect(result).toMatchObject({
      kind: 'GUARDIAN',
      email: 'p@example.com',
      recipientName: 'Payer',
      patientName: 'Pat Ient',
    });
  });

  it('falls back to the first eligible guardian when none is payer', () => {
    const result = resolvePatientRecipient(
      patient({
        birthDate: MINOR,
        guardians: [
          guardian({ email: null }),
          guardian({ fullName: 'Second', email: 's@example.com' }),
        ],
      }),
      NOW,
    );
    expect(result.email).toBe('s@example.com');
  });

  it('skips guardians that do not receive communications', () => {
    const result = resolvePatientRecipient(
      patient({
        birthDate: MINOR,
        guardians: [guardian({ receivesCommunications: false })],
      }),
      NOW,
    );
    expect(result).toMatchObject({ kind: 'GUARDIAN', email: null });
  });

  it('never falls back to the minor own email', () => {
    const result = resolvePatientRecipient(
      patient({ birthDate: MINOR, guardians: [] }),
      NOW,
    );
    expect(result.kind).toBe('GUARDIAN');
    expect(result.email).toBeNull();
  });

  it('treats a patient turning 18 today as an adult', () => {
    const result = resolvePatientRecipient(
      patient({ birthDate: new Date('2008-10-08'), guardians: [guardian()] }),
      NOW,
    );
    expect(result.kind).toBe('PATIENT');
  });
});

describe('resolvePatientPayerEmail', () => {
  it('returns the patient email for an adult', () => {
    expect(resolvePatientPayerEmail(patient(), NOW)).toBe(
      'patient@example.com',
    );
  });

  it('prefers the payer guardian even if it does not receive communications', () => {
    const result = resolvePatientPayerEmail(
      patient({
        birthDate: MINOR,
        guardians: [
          guardian(),
          guardian({
            email: 'p@example.com',
            isPayer: true,
            receivesCommunications: false,
          }),
        ],
      }),
      NOW,
    );
    expect(result).toBe('p@example.com');
  });

  it('uses the first guardian with email when none is payer', () => {
    const result = resolvePatientPayerEmail(
      patient({
        birthDate: MINOR,
        guardians: [guardian({ email: null }), guardian({ email: 'x@e.com' })],
      }),
      NOW,
    );
    expect(result).toBe('x@e.com');
  });

  it('returns null for a minor without guardian emails', () => {
    expect(
      resolvePatientPayerEmail(patient({ birthDate: MINOR }), NOW),
    ).toBeNull();
  });
});
