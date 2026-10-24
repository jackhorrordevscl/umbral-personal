import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { DocumentEncryptionService } from './document-encryption.service';
import { DocumentsService } from './documents.service';

/**
 * Issue #499: la anulación concurrente de dos documentos de consentimiento del
 * mismo propósito no debe dejar un GRANT sin REVOKE. Postgres real.
 *
 * Determinismo: un "holder" retiene Patient FOR UPDATE; se encolan las dos
 * anulaciones, se espera en pg_stat_activity a que ambas estén bloqueadas y
 * recién entonces se suelta el holder. Sin el lock del fix las anulaciones no
 * se encolan y la espera falla por tiempo.
 */
describe('DocumentsService.voidDocument (integration, anulación concurrente de consentimientos)', () => {
  let prisma: PrismaService;
  let service: DocumentsService;
  const runId = Date.now();
  let therapistId: string;
  let patientId: string;
  const documentIds: string[] = [];

  async function waitForBlockedLocks(
    table: 'Patient' | 'User' | 'any',
    count: number,
  ): Promise<void> {
    const deadline = Date.now() + 10000;
    const pattern = table === 'any' ? '%' : `%"${table}"%`;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE ${pattern}`;
      if ((rows[0]?.n ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Las anulaciones no quedaron bloqueadas a tiempo');
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    const therapist = await prisma.user.create({
      data: {
        email: `documents-void-concurrency-${runId}@example.com`,
        passwordHash: await argon2.hash('TestPass123!'),
        name: 'Dra. Anulación Concurrente',
        rut: '12345678-5',
      },
    });
    therapistId = therapist.id;

    const patient = await prisma.patient.create({
      data: {
        fullName: 'Paciente Anulación Concurrente',
        rut: `${runId}-1`,
        birthDate: new Date('1990-01-01T12:00:00.000Z'),
        therapistId,
      },
    });
    patientId = patient.id;

    service = new DocumentsService(
      prisma,
      {
        assertAccess: jest.fn().mockResolvedValue(patient),
      } as unknown as PatientsService,
      {} as unknown as DocumentEncryptionService,
    );
  }, 30000);

  afterAll(async () => {
    await prisma.patientConsent.deleteMany({ where: { patientId } });
    await prisma.patientDocument.deleteMany({ where: { patientId } });
    await prisma.patient.deleteMany({ where: { id: patientId } });
    // AuditLog es append-only y su FK al User es Restrict: se da de baja.
    await prisma.user.updateMany({
      where: { id: therapistId },
      data: { deletedAt: new Date() },
    });
    await prisma.onModuleDestroy();
  }, 30000);

  it('dos anulaciones simultáneas de los únicos documentos vigentes dejan exactamente un REVOKE', async () => {
    for (const n of [1, 2]) {
      const doc = await prisma.patientDocument.create({
        data: {
          patientId,
          type: 'INFORMED_CONSENT',
          fileName: `consentimiento-${n}.pdf`,
          storagePath: `test/${runId}/consentimiento-${n}.pdf`,
          uploadedBy: therapistId,
        },
      });
      documentIds.push(doc.id);
    }
    await prisma.patientConsent.create({
      data: {
        patientId,
        purpose: 'TREATMENT',
        action: 'GRANT',
        recordedById: therapistId,
        documentId: documentIds[0],
        evidence: 'GRANT de fixture (integration)',
      },
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${patientId} FOR UPDATE`;
        markLocked();
        await gate;
      },
      { timeout: 30000, maxWait: 10000 },
    );
    await locked;

    const voids = documentIds.map((id) =>
      service.voidDocument(
        id,
        { reason: 'Anulación concurrente' },
        therapistId,
      ),
    );
    try {
      // Las dos anulaciones son del mismo terapeuta: se serializan primero en
      // el lock de User (orden User -> Patient). Una pasa y espera al holder en
      // Patient; la otra espera en User.
      await waitForBlockedLocks('Patient', 1);
      await waitForBlockedLocks('User', 1);
    } finally {
      release();
      await holder;
    }
    const results = await Promise.allSettled(voids);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);

    const events = await prisma.patientConsent.findMany({
      where: { patientId, purpose: 'TREATMENT' },
      orderBy: { recordedAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['GRANT', 'REVOKE']);
  }, 30000);

  // Judgment-day #504: otra transacción del terapeuta (discharges, consultations)
  // toma User y luego Patient. Si la anulación tomara Patient y luego insertara
  // el REVOKE (recordedById, FK a User), las dos se esperarían entre sí y
  // Postgres abortaría una por interbloqueo.
  it('una transacción que toma User y luego Patient no se interbloquea con la anulación', async () => {
    const doc = await prisma.patientDocument.create({
      data: {
        patientId,
        type: 'INFORMED_CONSENT',
        fileName: 'consentimiento-3.pdf',
        storagePath: `test/${runId}/consentimiento-3.pdf`,
        uploadedBy: therapistId,
      },
    });
    documentIds.push(doc.id);
    // El GRANT depende de este documento: al anularlo se inserta el REVOKE.
    await prisma.patientConsent.create({
      data: {
        patientId,
        purpose: 'TREATMENT',
        action: 'GRANT',
        recordedById: therapistId,
        documentId: doc.id,
        evidence: 'GRANT de fixture (integration, orden de locks)',
      },
    });

    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    let proceed!: () => void;
    const gate = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const other = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${therapistId} FOR UPDATE`;
        markLocked();
        await gate;
        await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${patientId} FOR UPDATE`;
      },
      { timeout: 30000, maxWait: 10000 },
    );
    await locked;

    const voided = service.voidDocument(
      doc.id,
      { reason: 'Orden de locks' },
      therapistId,
    );
    try {
      // Cualquier espera de lock: el orden viejo bloquea en la FK de User, el
      // nuevo en el lock de User; en ambos casos la anulación ya espera a `other`.
      await waitForBlockedLocks('any', 1);
    } finally {
      proceed();
    }
    const results = await Promise.allSettled([other, voided]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  }, 30000);
});
