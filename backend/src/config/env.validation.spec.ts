import { readFileSync } from 'fs';
import { join } from 'path';
import { validateEnv } from './env.validation';

// Se extraen del archivo real en vez de copiarlas como literales para (a) no
// gatillar escaneo de secretos con un string con forma de credencial y (b)
// detectar si README.md/install.sh cambian su valor de ejemplo sin actualizar
// env.validation.ts.
function extractExample(filePath: string, varName: string): string {
  const content = readFileSync(filePath, 'utf-8');
  const pattern = new RegExp(`${varName}="([^"]+)"`, 'g');
  const matches = [...content.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Se esperaba exactamente un ${varName} de ejemplo en ${filePath}, se encontraron ${matches.length}`,
    );
  }
  return matches[0][1];
}

const readmePath = join(__dirname, '../../../README.md');
const installShPath = join(__dirname, '../../../install.sh');

const readmeExampleSecret = extractExample(readmePath, 'JWT_SECRET');
const installShExampleSecret = extractExample(installShPath, 'JWT_SECRET');

const readmeExampleDocumentKey = extractExample(
  readmePath,
  'DOCUMENT_ENCRYPTION_KEY',
);
const installShExampleDocumentKey = extractExample(
  installShPath,
  'DOCUMENT_ENCRYPTION_KEY',
);

// sdd/google-calendar-integration PR 1: mismo criterio que
// DOCUMENT_ENCRYPTION_KEY -- el valor de ejemplo de README.md/install.sh es
// público, así que se rechaza igual en producción.
const readmeExampleGoogleTokenKey = extractExample(
  readmePath,
  'GOOGLE_TOKEN_ENCRYPTION_KEY',
);
const installShExampleGoogleTokenKey = extractExample(
  installShPath,
  'GOOGLE_TOKEN_ENCRYPTION_KEY',
);

// sdd/online-payment-integration PR 1: mismo criterio que
// GOOGLE_TOKEN_ENCRYPTION_KEY -- el valor de ejemplo del README es público,
// así que se rechaza igual en producción.
const readmeExamplePaymentKey = extractExample(
  readmePath,
  'PAYMENT_CREDENTIALS_ENCRYPTION_KEY',
);

// Clave válida (32 bytes en base64) para no interferir con los tests de
// JWT_SECRET, que no le conciernen a DOCUMENT_ENCRYPTION_KEY.
const validDocumentKey = Buffer.alloc(32, 7).toString('base64');

// Idem para GOOGLE_TOKEN_ENCRYPTION_KEY -- valor distinto al de
// validDocumentKey para no confundir cuál validación falla si un test se
// rompe.
const validGoogleTokenKey = Buffer.alloc(32, 11).toString('base64');

// Idem para PAYMENT_CREDENTIALS_ENCRYPTION_KEY -- valor distinto a los
// anteriores.
const validPaymentKey = Buffer.alloc(32, 13).toString('base64');

// Issue #302 (part 2): idem para MFA_SECRET_ENCRYPTION_KEY, cuyo valor de
// ejemplo público (README.md/install.sh) también se rechaza en producción.
const readmeExampleMfaKey = extractExample(
  readmePath,
  'MFA_SECRET_ENCRYPTION_KEY',
);
const installShExampleMfaKey = extractExample(
  installShPath,
  'MFA_SECRET_ENCRYPTION_KEY',
);
const validMfaKey = Buffer.alloc(32, 17).toString('base64');

// ADR 0004 (opción B): idem para CLINICAL_TEXT_ENCRYPTION_KEY, cuyo valor de
// ejemplo público (README.md/install.sh) también se rechaza en producción.
const readmeExampleClinicalKey = extractExample(
  readmePath,
  'CLINICAL_TEXT_ENCRYPTION_KEY',
);
const installShExampleClinicalKey = extractExample(
  installShPath,
  'CLINICAL_TEXT_ENCRYPTION_KEY',
);
const validClinicalKey = Buffer.alloc(32, 19).toString('base64');

// Issue #287: variables que en producción son obligatorias además de las
// claves de cifrado (valores ficticios, sin forma de credencial real).
const b2Vars = (prefix: string) => ({
  [`${prefix}_ENDPOINT`]: 'https://s3.us-west-004.backblazeb2.com',
  [`${prefix}_REGION`]: 'us-west-004',
  [`${prefix}_BUCKET`]: 'bucket-de-prueba',
  [`${prefix}_KEY_ID`]: 'key-id-de-prueba',
  [`${prefix}_APPLICATION_KEY`]: 'application-key-de-prueba',
});

const productionRequiredVars: Record<string, string> = {
  CLINICAL_TEXT_ENCRYPTION_KEY: validClinicalKey,
  FRONTEND_URL: 'https://umbral.example.com',
  FLOW_API_BASE_URL: 'https://www.flow.cl/api',
  DATABASE_URL: 'postgresql://usuario:clave@db.example.com:5432/umbral',
  RESEND_API_KEY: 'resend-api-key-de-prueba',
  RESEND_WEBHOOK_SECRET: 'webhook-secret-de-prueba',
  MAIL_FROM: 'Umbral <no-reply@example.com>',
  ...b2Vars('B2_AVATARS'),
  ...b2Vars('B2_SHARED_FILES'),
  ...b2Vars('B2_PATIENT_DOCUMENTS'),
};

describe('validateEnv', () => {
  it('permite un JWT_SECRET largo y no genérico en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: validPaymentKey,
      MFA_SECRET_ENCRYPTION_KEY: validMfaKey,
      ...productionRequiredVars,
    };

    expect(validateEnv(config)).toBe(config);
  });

  it('rechaza un JWT_SECRET demasiado corto en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'corto',
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(/JWT_SECRET inválido/);
  });

  it('rechaza el valor de ejemplo de README.md en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: readmeExampleSecret,
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(/JWT_SECRET inválido/);
  });

  it('rechaza el valor de ejemplo de install.sh en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: installShExampleSecret,
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(/JWT_SECRET inválido/);
  });

  it('rechaza JWT_SECRET ausente en producción', () => {
    const config = {
      NODE_ENV: 'production',
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(/JWT_SECRET inválido/);
  });

  it('no valida JWT_SECRET fuera de producción', () => {
    const config = { NODE_ENV: 'test', JWT_SECRET: 'corto' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite un DOCUMENT_ENCRYPTION_KEY válido en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: validPaymentKey,
      MFA_SECRET_ENCRYPTION_KEY: validMfaKey,
      ...productionRequiredVars,
    };

    expect(validateEnv(config)).toBe(config);
  });

  it('rechaza un DOCUMENT_ENCRYPTION_KEY que no decodifica a 32 bytes en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString('base64'),
    };

    expect(() => validateEnv(config)).toThrow(
      /DOCUMENT_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza el valor de ejemplo de README.md/install.sh para DOCUMENT_ENCRYPTION_KEY en producción', () => {
    expect(readmeExampleDocumentKey).toBe(installShExampleDocumentKey);

    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: readmeExampleDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(
      /DOCUMENT_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza DOCUMENT_ENCRYPTION_KEY ausente en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
    };

    expect(() => validateEnv(config)).toThrow(
      /DOCUMENT_ENCRYPTION_KEY inválida/,
    );
  });

  it('no valida DOCUMENT_ENCRYPTION_KEY fuera de producción', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  // sdd/google-calendar-integration PR 1: GOOGLE_TOKEN_ENCRYPTION_KEY sigue
  // exactamente el mismo criterio que DOCUMENT_ENCRYPTION_KEY (design.md
  // "Dedicated GOOGLE_TOKEN_ENCRYPTION_KEY, not DOCUMENT_ENCRYPTION_KEY") --
  // clave AES-256-GCM propia, distinta, requerida en producción.
  it('permite un GOOGLE_TOKEN_ENCRYPTION_KEY válido en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: validPaymentKey,
      MFA_SECRET_ENCRYPTION_KEY: validMfaKey,
      ...productionRequiredVars,
    };

    expect(validateEnv(config)).toBe(config);
  });

  it('rechaza un GOOGLE_TOKEN_ENCRYPTION_KEY que no decodifica a 32 bytes en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 11).toString('base64'),
    };

    expect(() => validateEnv(config)).toThrow(
      /GOOGLE_TOKEN_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza el valor de ejemplo de README.md/install.sh para GOOGLE_TOKEN_ENCRYPTION_KEY en producción', () => {
    expect(readmeExampleGoogleTokenKey).toBe(installShExampleGoogleTokenKey);

    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: readmeExampleGoogleTokenKey,
    };

    expect(() => validateEnv(config)).toThrow(
      /GOOGLE_TOKEN_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza GOOGLE_TOKEN_ENCRYPTION_KEY ausente en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(
      /GOOGLE_TOKEN_ENCRYPTION_KEY inválida/,
    );
  });

  it('no valida GOOGLE_TOKEN_ENCRYPTION_KEY fuera de producción', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite PORT/FRONTEND_URL/LAN_DEV_URL/RUN_MIGRATIONS válidos', () => {
    const config = {
      NODE_ENV: 'test',
      PORT: '3001',
      FRONTEND_URL: 'https://umbral.example.com',
      LAN_DEV_URL: 'http://192.168.1.100:5173',
      RUN_MIGRATIONS: 'true',
    };

    expect(validateEnv(config)).toBe(config);
  });

  it('rechaza un PORT que no es un puerto válido', () => {
    const config = { NODE_ENV: 'test', PORT: 'abc' };

    expect(() => validateEnv(config)).toThrow(/PORT inválido/);
  });

  it('rechaza un PORT fuera de rango', () => {
    const config = { NODE_ENV: 'test', PORT: '70000' };

    expect(() => validateEnv(config)).toThrow(/PORT inválido/);
  });

  it('rechaza un FRONTEND_URL que no es una URL válida', () => {
    const config = { NODE_ENV: 'test', FRONTEND_URL: 'no-es-una-url' };

    expect(() => validateEnv(config)).toThrow(/FRONTEND_URL inválida/);
  });

  it('rechaza un LAN_DEV_URL que no es una URL válida', () => {
    const config = { NODE_ENV: 'test', LAN_DEV_URL: 'no-es-una-url' };

    expect(() => validateEnv(config)).toThrow(/LAN_DEV_URL inválida/);
  });

  it('rechaza un RUN_MIGRATIONS que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', RUN_MIGRATIONS: 'ture' };

    expect(() => validateEnv(config)).toThrow(/RUN_MIGRATIONS inválido/);
  });

  it('permite RUN_MIGRATIONS="false"', () => {
    const config = { NODE_ENV: 'test', RUN_MIGRATIONS: 'false' };

    expect(validateEnv(config)).toBe(config);
  });

  // sdd/session-reminders PR 2 (T4.5): REMINDERS_ENABLED es opcional
  // (RemindersService trata "ausente" como habilitado por default), pero si
  // está presente debe ser exactamente "true" o "false" -- mismo criterio
  // que RUN_MIGRATIONS, para que un typo falle rápido en el arranque en vez
  // de silenciosamente desactivar el cron.
  it('rechaza un REMINDERS_ENABLED que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', REMINDERS_ENABLED: 'nope' };

    expect(() => validateEnv(config)).toThrow(/REMINDERS_ENABLED inválido/);
  });

  it('permite REMINDERS_ENABLED="false"', () => {
    const config = { NODE_ENV: 'test', REMINDERS_ENABLED: 'false' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite REMINDERS_ENABLED ausente', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  // sdd/google-calendar-integration PR 1 (design.md, "Migration / Rollout"):
  // mismo criterio que REMINDERS_ENABLED -- opcional, GOOGLE_CALENDAR_SYNC_ENABLED
  // ausente lo trata CalendarSyncService (PR 2) como habilitado por default,
  // pero un typo en el valor debe fallar rápido en el arranque.
  it('rechaza un GOOGLE_CALENDAR_SYNC_ENABLED que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', GOOGLE_CALENDAR_SYNC_ENABLED: 'nope' };

    expect(() => validateEnv(config)).toThrow(
      /GOOGLE_CALENDAR_SYNC_ENABLED inválido/,
    );
  });

  it('permite GOOGLE_CALENDAR_SYNC_ENABLED="false"', () => {
    const config = { NODE_ENV: 'test', GOOGLE_CALENDAR_SYNC_ENABLED: 'false' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite GOOGLE_CALENDAR_SYNC_ENABLED ausente', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  // sdd/online-payment-integration PR 1: mismo criterio que
  // REMINDERS_ENABLED/GOOGLE_CALENDAR_SYNC_ENABLED -- opcional, PaymentsService
  // (PR 2) trata "ausente" como habilitado por default, pero un typo en el
  // valor debe fallar rápido en el arranque en vez de desactivar el flujo de
  // pagos en silencio.
  it('rechaza un PAYMENTS_ENABLED que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', PAYMENTS_ENABLED: 'nope' };

    expect(() => validateEnv(config)).toThrow(/PAYMENTS_ENABLED inválido/);
  });

  it('permite PAYMENTS_ENABLED="false"', () => {
    const config = { NODE_ENV: 'test', PAYMENTS_ENABLED: 'false' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite PAYMENTS_ENABLED ausente', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  // Issue #287: SESSION_PURGE_ENABLED es opcional (ausente = purga habilitada),
  // pero un typo debe fallar rápido en el arranque.
  it('rechaza un SESSION_PURGE_ENABLED que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', SESSION_PURGE_ENABLED: 'nope' };

    expect(() => validateEnv(config)).toThrow(/SESSION_PURGE_ENABLED inválido/);
  });

  it.each(['true', 'false'])('permite SESSION_PURGE_ENABLED="%s"', (value) => {
    const config = { NODE_ENV: 'test', SESSION_PURGE_ENABLED: value };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite SESSION_PURGE_ENABLED ausente', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  // Issue #290: las variables de la purga de notificaciones son opcionales
  // (ausente = default), pero un valor inválido debe fallar en el arranque.
  it('rechaza un NOTIFICATIONS_PURGE_ENABLED que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', NOTIFICATIONS_PURGE_ENABLED: 'nope' };

    expect(() => validateEnv(config)).toThrow(
      /NOTIFICATIONS_PURGE_ENABLED inválido/,
    );
  });

  it.each(['true', 'false'])(
    'permite NOTIFICATIONS_PURGE_ENABLED="%s"',
    (value) => {
      const config = { NODE_ENV: 'test', NOTIFICATIONS_PURGE_ENABLED: value };

      expect(validateEnv(config)).toBe(config);
    },
  );

  it.each([
    'NOTIFICATIONS_PURGE_RETENTION_DAYS',
    'NOTIFICATIONS_PURGE_MAX_BATCHES',
  ])('rechaza un %s que no es un entero positivo', (name) => {
    for (const value of ['abc', '0', '-5', '1.5', '']) {
      const config = { NODE_ENV: 'test', [name]: value };

      expect(() => validateEnv(config)).toThrow(new RegExp(`${name} inválido`));
    }
  });

  it.each([
    'NOTIFICATIONS_PURGE_RETENTION_DAYS',
    'NOTIFICATIONS_PURGE_MAX_BATCHES',
  ])('permite %s como entero positivo', (name) => {
    const config = { NODE_ENV: 'test', [name]: '45' };

    expect(validateEnv(config)).toBe(config);
  });

  // sdd/patient-self-scheduling PR 1 (tasks.md 1.3, design.md "Migration /
  // Rollout"): un solo flag gatea tanto el endpoint público de
  // disponibilidad como el de booking (PR 3) -- mismo criterio que
  // PAYMENTS_ENABLED/REMINDERS_ENABLED/GOOGLE_CALENDAR_SYNC_ENABLED, opcional
  // (PublicSchedulingModule, PR 3, trata "ausente" como deshabilitado por
  // default -- superficie pública nueva, a diferencia de las anteriores), pero
  // un typo en el valor debe fallar rápido en el arranque.
  it('rechaza un PUBLIC_SCHEDULING_ENABLED que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', PUBLIC_SCHEDULING_ENABLED: 'nope' };

    expect(() => validateEnv(config)).toThrow(
      /PUBLIC_SCHEDULING_ENABLED inválido/,
    );
  });

  it('permite PUBLIC_SCHEDULING_ENABLED="true"', () => {
    const config = { NODE_ENV: 'test', PUBLIC_SCHEDULING_ENABLED: 'true' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite PUBLIC_SCHEDULING_ENABLED ausente', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  // sdd/online-payment-integration PR 1: mismo criterio que
  // GOOGLE_TOKEN_ENCRYPTION_KEY -- clave AES-256-GCM propia (cifra
  // PaymentAccount.credentialEncrypted, PR 2), requerida siempre en
  // producción sin importar si ya hay una cuenta Flow conectada.
  it('permite un PAYMENT_CREDENTIALS_ENCRYPTION_KEY válido en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: validPaymentKey,
      MFA_SECRET_ENCRYPTION_KEY: validMfaKey,
      ...productionRequiredVars,
    };

    expect(validateEnv(config)).toBe(config);
  });

  it('rechaza un PAYMENT_CREDENTIALS_ENCRYPTION_KEY que no decodifica a 32 bytes en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(16, 13).toString(
        'base64',
      ),
    };

    expect(() => validateEnv(config)).toThrow(
      /PAYMENT_CREDENTIALS_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza el valor de ejemplo de README.md para PAYMENT_CREDENTIALS_ENCRYPTION_KEY en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: readmeExamplePaymentKey,
    };

    expect(() => validateEnv(config)).toThrow(
      /PAYMENT_CREDENTIALS_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza PAYMENT_CREDENTIALS_ENCRYPTION_KEY ausente en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
    };

    expect(() => validateEnv(config)).toThrow(
      /PAYMENT_CREDENTIALS_ENCRYPTION_KEY inválida/,
    );
  });

  it('no valida PAYMENT_CREDENTIALS_ENCRYPTION_KEY fuera de producción', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  // Issue #302 (part 2): MFA_SECRET_ENCRYPTION_KEY cifra User.mfaSecret.
  const productionBase = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(32),
    DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
    PAYMENT_CREDENTIALS_ENCRYPTION_KEY: validPaymentKey,
  };

  it('rechaza MFA_SECRET_ENCRYPTION_KEY ausente en producción', () => {
    expect(() => validateEnv({ ...productionBase })).toThrow(
      /MFA_SECRET_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza un MFA_SECRET_ENCRYPTION_KEY que no decodifica a 32 bytes en producción', () => {
    expect(() =>
      validateEnv({
        ...productionBase,
        MFA_SECRET_ENCRYPTION_KEY: Buffer.alloc(16, 17).toString('base64'),
      }),
    ).toThrow(/MFA_SECRET_ENCRYPTION_KEY inválida/);
  });

  it.each([
    ['README.md', readmeExampleMfaKey],
    ['install.sh', installShExampleMfaKey],
  ])(
    'rechaza el valor de ejemplo de %s para MFA_SECRET_ENCRYPTION_KEY en producción',
    (_file, example) => {
      expect(() =>
        validateEnv({ ...productionBase, MFA_SECRET_ENCRYPTION_KEY: example }),
      ).toThrow(/MFA_SECRET_ENCRYPTION_KEY inválida/);
    },
  );

  it('permite un MFA_SECRET_ENCRYPTION_KEY válido en producción', () => {
    const config = {
      ...productionBase,
      MFA_SECRET_ENCRYPTION_KEY: validMfaKey,
      ...productionRequiredVars,
    };

    expect(validateEnv(config)).toBe(config);
  });

  // ADR 0004 (opción B): CLINICAL_TEXT_ENCRYPTION_KEY cifra los textos
  // clínicos libres (consultas e informe de alta).
  const productionWithMfa = {
    ...productionBase,
    MFA_SECRET_ENCRYPTION_KEY: validMfaKey,
  };

  it('rechaza CLINICAL_TEXT_ENCRYPTION_KEY ausente en producción', () => {
    expect(() => validateEnv({ ...productionWithMfa })).toThrow(
      /CLINICAL_TEXT_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza un CLINICAL_TEXT_ENCRYPTION_KEY que no decodifica a 32 bytes en producción', () => {
    expect(() =>
      validateEnv({
        ...productionWithMfa,
        CLINICAL_TEXT_ENCRYPTION_KEY: Buffer.alloc(16, 19).toString('base64'),
      }),
    ).toThrow(/CLINICAL_TEXT_ENCRYPTION_KEY inválida/);
  });

  it.each([
    ['README.md', readmeExampleClinicalKey],
    ['install.sh', installShExampleClinicalKey],
  ])(
    'rechaza el valor de ejemplo de %s para CLINICAL_TEXT_ENCRYPTION_KEY en producción',
    (_file, example) => {
      expect(() =>
        validateEnv({
          ...productionWithMfa,
          CLINICAL_TEXT_ENCRYPTION_KEY: example,
        }),
      ).toThrow(/CLINICAL_TEXT_ENCRYPTION_KEY inválida/);
    },
  );

  it('permite un CLINICAL_TEXT_ENCRYPTION_KEY válido en producción', () => {
    const config = { ...productionWithMfa, ...productionRequiredVars };

    expect(validateEnv(config)).toBe(config);
  });

  it('valida el llavero opcional de CLINICAL_TEXT_ENCRYPTION_KEY en cualquier entorno', () => {
    expect(() =>
      validateEnv({
        CLINICAL_TEXT_ENCRYPTION_KEY_KEYRING: 'sin-formato-id-base64',
      }),
    ).toThrow(/CLINICAL_TEXT_ENCRYPTION_KEY_KEYRING/);
  });

  // Issue #287: variables obligatorias en producción.
  describe('variables obligatorias en producción (issue #287)', () => {
    const validProduction = {
      ...productionBase,
      MFA_SECRET_ENCRYPTION_KEY: validMfaKey,
      ...productionRequiredVars,
    };

    const without = (varName: string) => {
      const config: Record<string, unknown> = { ...validProduction };
      delete config[varName];
      return config;
    };

    it('permite la configuración completa de producción', () => {
      expect(validateEnv(validProduction)).toBe(validProduction);
    });

    it.each(Object.keys(productionRequiredVars))(
      'rechaza %s ausente en producción',
      (varName) => {
        expect(() => validateEnv(without(varName))).toThrow(
          new RegExp(`${varName} (requerida|inválida)`),
        );
      },
    );

    it.each(
      Object.keys(productionRequiredVars).filter(
        (name) =>
          name !== 'FRONTEND_URL' &&
          name !== 'FLOW_API_BASE_URL' &&
          name !== 'CLINICAL_TEXT_ENCRYPTION_KEY' &&
          !name.endsWith('_ENDPOINT'),
      ),
    )('rechaza %s vacía en producción', (varName) => {
      expect(() =>
        validateEnv({ ...validProduction, [varName]: '   ' }),
      ).toThrow(new RegExp(`${varName} requerida`));
    });

    it('rechaza un FRONTEND_URL que no es una URL en producción', () => {
      expect(() =>
        validateEnv({ ...validProduction, FRONTEND_URL: 'no-es-una-url' }),
      ).toThrow(/FRONTEND_URL inválida/);
    });

    it('rechaza un FRONTEND_URL con esquema distinto de http/https en producción', () => {
      expect(() =>
        validateEnv({ ...validProduction, FRONTEND_URL: 'ftp://example.com' }),
      ).toThrow(/FRONTEND_URL inválida/);
    });

    it.each(['B2_AVATARS', 'B2_SHARED_FILES', 'B2_PATIENT_DOCUMENTS'])(
      'rechaza un %s_ENDPOINT sin esquema https:// en producción',
      (prefix) => {
        expect(() =>
          validateEnv({
            ...validProduction,
            [`${prefix}_ENDPOINT`]: 's3.us-west-004.backblazeb2.com',
          }),
        ).toThrow(new RegExp(`${prefix}_ENDPOINT inválida`));
        expect(() =>
          validateEnv({
            ...validProduction,
            [`${prefix}_ENDPOINT`]: 'http://s3.example.com',
          }),
        ).toThrow(new RegExp(`${prefix}_ENDPOINT inválida`));
      },
    );

    it('no exige estas variables fuera de producción', () => {
      const config = { NODE_ENV: 'test' };

      expect(validateEnv(config)).toBe(config);
    });

    // Issue #494: sin FLOW_API_BASE_URL el cliente de Flow cae al sandbox, y
    // en producción eso cobra contra un entorno de prueba sin avisar.
    describe('FLOW_API_BASE_URL (issue #494)', () => {
      it.each(['', '   ', 'no-es-una-url', 'ftp://flow.example.com'])(
        'rechaza un FLOW_API_BASE_URL %j en producción',
        (value) => {
          expect(() =>
            validateEnv({ ...validProduction, FLOW_API_BASE_URL: value }),
          ).toThrow(/FLOW_API_BASE_URL inválida/);
        },
      );

      it('rechaza un FLOW_API_BASE_URL con http:// en producción', () => {
        expect(() =>
          validateEnv({
            ...validProduction,
            FLOW_API_BASE_URL: 'http://www.flow.cl/api',
          }),
        ).toThrow(/FLOW_API_BASE_URL inválida/);
      });

      it('no la exige en producción con PAYMENTS_ENABLED="false"', () => {
        const config = {
          ...without('FLOW_API_BASE_URL'),
          PAYMENTS_ENABLED: 'false',
        };

        expect(validateEnv(config)).toBe(config);
      });

      it('rechaza un FLOW_API_BASE_URL que no es una URL en cualquier entorno', () => {
        expect(() =>
          validateEnv({ NODE_ENV: 'test', FLOW_API_BASE_URL: 'no-es-una-url' }),
        ).toThrow(/FLOW_API_BASE_URL inválida/);
      });

      it('permite http:// fuera de producción (Flow falso de los e2e)', () => {
        const config = {
          NODE_ENV: 'test',
          FLOW_API_BASE_URL: 'http://127.0.0.1:4010',
        };

        expect(validateEnv(config)).toBe(config);
      });
    });
  });

  // Issue #382 (ADR 0005): <NOMBRE>_KEYRING y <NOMBRE>_ACTIVE_KEY_ID son
  // opcionales, pero si se definen se validan con las mismas reglas que el
  // llavero de runtime, en cualquier entorno.
  describe('llaveros de cifrado (issue #382)', () => {
    const names = [
      'DOCUMENT_ENCRYPTION_KEY',
      'GOOGLE_TOKEN_ENCRYPTION_KEY',
      'PAYMENT_CREDENTIALS_ENCRYPTION_KEY',
      'MFA_SECRET_ENCRYPTION_KEY',
    ];
    const extraKey = Buffer.alloc(32, 21).toString('base64');
    const otherKey = Buffer.alloc(32, 22).toString('base64');

    it('no exige ninguna de las variables nuevas', () => {
      const config = { NODE_ENV: 'test' };

      expect(validateEnv(config)).toBe(config);
    });

    it.each(names)(
      'acepta un llavero válido y su clave activa para %s',
      (name) => {
        const config = {
          NODE_ENV: 'test',
          [`${name}_KEYRING`]: `1:${extraKey}, 2:${otherKey}`,
          [`${name}_ACTIVE_KEY_ID`]: '2',
        };

        expect(validateEnv(config)).toBe(config);
      },
    );

    it.each(names)(
      'acepta como activa la clave id 0 sin llavero para %s',
      (name) => {
        const config = { NODE_ENV: 'test', [`${name}_ACTIVE_KEY_ID`]: '0' };

        expect(validateEnv(config)).toBe(config);
      },
    );

    it.each(names)(
      'rechaza una entrada sin formato id:base64 en %s_KEYRING',
      (name) => {
        expect(() =>
          validateEnv({ NODE_ENV: 'test', [`${name}_KEYRING`]: extraKey }),
        ).toThrow(new RegExp(`${name}_KEYRING inválida`));
      },
    );

    it.each(names)(
      'rechaza un id fuera de 1-255 o no entero en %s_KEYRING',
      (name) => {
        for (const id of ['0', '256', 'x', '1.5']) {
          expect(() =>
            validateEnv({
              NODE_ENV: 'test',
              [`${name}_KEYRING`]: `${id}:${extraKey}`,
            }),
          ).toThrow(new RegExp(`${name}_KEYRING inválida`));
        }
      },
    );

    it.each(names)('rechaza ids duplicados en %s_KEYRING', (name) => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'test',
          [`${name}_KEYRING`]: `1:${extraKey},1:${otherKey}`,
        }),
      ).toThrow(/duplicado/);
    });

    it.each(names)(
      'rechaza una clave que no decodifica a 32 bytes en %s_KEYRING',
      (name) => {
        expect(() =>
          validateEnv({
            NODE_ENV: 'test',
            [`${name}_KEYRING`]: `1:${Buffer.alloc(16, 1).toString('base64')}`,
          }),
        ).toThrow(new RegExp(`${name}_KEYRING inválida`));
      },
    );

    it.each(names)(
      'rechaza una %s_ACTIVE_KEY_ID que no existe en el llavero',
      (name) => {
        expect(() =>
          validateEnv({
            NODE_ENV: 'test',
            [`${name}_KEYRING`]: `1:${extraKey}`,
            [`${name}_ACTIVE_KEY_ID`]: '2',
          }),
        ).toThrow(new RegExp(`${name}_ACTIVE_KEY_ID inválida`));
        expect(() =>
          validateEnv({ NODE_ENV: 'test', [`${name}_ACTIVE_KEY_ID`]: '1' }),
        ).toThrow(new RegExp(`${name}_ACTIVE_KEY_ID inválida`));
      },
    );

    it.each(names)('rechaza una %s_ACTIVE_KEY_ID no numérica', (name) => {
      for (const id of ['abc', '-1', '256']) {
        expect(() =>
          validateEnv({ NODE_ENV: 'test', [`${name}_ACTIVE_KEY_ID`]: id }),
        ).toThrow(new RegExp(`${name}_ACTIVE_KEY_ID inválida`));
      }
    });

    it('también valida el llavero en producción', () => {
      expect(() =>
        validateEnv({
          ...productionBase,
          MFA_SECRET_ENCRYPTION_KEY: validMfaKey,
          ...productionRequiredVars,
          DOCUMENT_ENCRYPTION_KEY_KEYRING: 'basura',
        }),
      ).toThrow(/DOCUMENT_ENCRYPTION_KEY_KEYRING inválida/);
    });

    // Issue #398: la variable base (clave id 0) puede faltar en producción si
    // el llavero define otra clave y <NOMBRE>_ACTIVE_KEY_ID apunta a ella.
    describe('clave id 0 retirada en producción (issue #398)', () => {
      const productionKeys: Record<string, string> = {
        DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
        GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
        PAYMENT_CREDENTIALS_ENCRYPTION_KEY: validPaymentKey,
        MFA_SECRET_ENCRYPTION_KEY: validMfaKey,
      };
      const retiring = (name: string, extra: Record<string, string> = {}) => {
        const { [name]: _retired, ...rest } = productionKeys;
        void _retired;
        return {
          NODE_ENV: 'production',
          JWT_SECRET: 'a'.repeat(32),
          ...productionRequiredVars,
          ...rest,
          [`${name}_KEYRING`]: `1:${extraKey}`,
          [`${name}_ACTIVE_KEY_ID`]: '1',
          ...extra,
        };
      };

      it.each(names)(
        'acepta %s ausente si el llavero define la clave activa',
        (name) => {
          const config = retiring(name);

          expect(validateEnv(config)).toBe(config);
        },
      );

      it.each(names)('rechaza %s ausente sin llavero ni id activo', (name) => {
        const { [name]: _retired, ...rest } = productionKeys;
        void _retired;

        expect(() =>
          validateEnv({
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(32),
            ...productionRequiredVars,
            ...rest,
          }),
        ).toThrow(new RegExp(`${name} inválida`));
      });

      it.each(names)(
        'rechaza %s ausente si la clave activa sigue siendo la 0',
        (name) => {
          for (const activeId of ['0', '']) {
            expect(() =>
              validateEnv(
                retiring(name, { [`${name}_ACTIVE_KEY_ID`]: activeId }),
              ),
            ).toThrow(new RegExp(`${name} inválida`));
          }
        },
      );

      it.each(names)(
        'rechaza %s ausente si el id activo no está en el llavero',
        (name) => {
          expect(() =>
            validateEnv(retiring(name, { [`${name}_ACTIVE_KEY_ID`]: '2' })),
          ).toThrow(new RegExp(`${name}_ACTIVE_KEY_ID inválida`));
        },
      );

      it.each(names)(
        'sigue rechazando el valor de ejemplo público de %s si está definida',
        (name) => {
          const exampleByName: Record<string, string> = {
            DOCUMENT_ENCRYPTION_KEY: readmeExampleDocumentKey,
            GOOGLE_TOKEN_ENCRYPTION_KEY: readmeExampleGoogleTokenKey,
            PAYMENT_CREDENTIALS_ENCRYPTION_KEY: readmeExamplePaymentKey,
            MFA_SECRET_ENCRYPTION_KEY: readmeExampleMfaKey,
          };

          expect(() =>
            validateEnv(
              retiring(name, {
                [name]: exampleByName[name],
              }),
            ),
          ).toThrow(new RegExp(`${name} inválida`));
        },
      );
    });
  });
});
