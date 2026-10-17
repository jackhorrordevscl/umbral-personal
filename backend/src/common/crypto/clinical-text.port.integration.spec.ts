import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { buildClinicalPort } from './clinical-text.port';
import { buildKeyring } from './keyring';
import { runReencrypt } from './reencrypt';

// ADR 0004 + ADR 0005: el recifrado manual cubre las columnas de texto clínico
// y los textos dentro de los snapshots de ConsultationHistory.
describe('clinical text reencrypt port (integration, real Prisma)', () => {
  let prisma: PrismaService;
  const runId = Date.now();
  const keyring = buildKeyring(
    Buffer.alloc(32, 33).toString('base64'),
    undefined,
    undefined,
    'CLINICAL_TEXT_ENCRYPTION_KEY',
  );

  let therapistId: string;
  let patientId: string;
  let consultationId: string;
  let historyId: string;
  let dischargeId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    therapistId = (
      await prisma.user.create({
        data: {
          email: `clinical-port-${runId}@example.com`,
          passwordHash: await argon2.hash('TestPass123!'),
          name: 'Dra. Recifrado',
        },
      })
    ).id;
    patientId = (
      await prisma.patient.create({
        data: {
          fullName: 'Paciente Recifrado',
          rut: `${runId}-r`,
          birthDate: new Date('1990-01-01T12:00:00.000Z'),
          therapistId,
        },
      })
    ).id;
    // Texto plano heredado, como el que dejó cualquier versión previa al cifrado.
    consultationId = (
      await prisma.consultation.create({
        data: {
          groupId: `g-${runId}`,
          patientId,
          therapistId,
          sessionDate: new Date('2026-01-10T15:00:00.000Z'),
          scheduledAt: new Date('2026-01-10T15:00:00.000Z'),
          durationMinutes: 50,
          patientRut: `${runId}-r`,
          consultReason: 'Motivo plano',
          intervention: 'Intervención plana',
          agreements: null,
        },
      })
    ).id;
    historyId = (
      await prisma.consultationHistory.create({
        data: {
          consultationId,
          editedById: therapistId,
          snapshot: {
            sessionType: 'IN_PERSON',
            consultReason: 'Motivo previo plano',
            intervention: 'Intervención previa plana',
            agreements: null,
          },
        },
      })
    ).id;
    dischargeId = (
      await prisma.treatmentDischarge.create({
        data: {
          groupId: `d-${runId}`,
          patientId,
          therapistId,
          closureReason: 'DISCHARGED',
          admissionDate: new Date('2026-01-01'),
          dischargeDate: new Date('2026-02-01'),
          sessionCount: 3,
          consultReason: 'Motivo alta plano',
          diagnosis: null,
          evolutionSummary: 'Evolución plana',
          statusAtDischarge: 'Estado plano',
          recommendations: 'Recomendaciones planas',
          dropoutNote: 'Nota plana',
        },
      })
    ).id;
  }, 30000);

  afterAll(async () => {
    await prisma.consultationHistory.deleteMany({ where: { id: historyId } });
    await prisma.treatmentDischarge.deleteMany({ where: { id: dischargeId } });
    await prisma.consultation.deleteMany({ where: { therapistId } });
    await prisma.patient.deleteMany({ where: { id: patientId } });
    await prisma.user.deleteMany({ where: { id: therapistId } });
    await prisma.$disconnect();
  });

  it('dry-run no escribe; apply recifra columnas y snapshots; la segunda corrida no encuentra nada', async () => {
    const port = () => buildClinicalPort(prisma, keyring);

    const dry = await runReencrypt([port()], { apply: false });
    // Solo cuento las filas lógicas de este test: la base puede tener más.
    expect(dry.datasets[0].wouldReencrypt).toBeGreaterThanOrEqual(9);
    const untouched = await prisma.consultation.findUniqueOrThrow({
      where: { id: consultationId },
    });
    expect(untouched.consultReason).toBe('Motivo plano');

    const applied = await runReencrypt([port()], { apply: true });
    expect(applied.datasets[0].failed).toBe(0);
    expect(applied.datasets[0].reencrypted).toBeGreaterThanOrEqual(9);

    const consultation = await prisma.consultation.findUniqueOrThrow({
      where: { id: consultationId },
    });
    expect(consultation.consultReason).toMatch(/^enc:v3:0:/);
    expect(consultation.intervention).toMatch(/^enc:v3:0:/);
    expect(consultation.agreements).toBeNull();

    const history = await prisma.consultationHistory.findUniqueOrThrow({
      where: { id: historyId },
    });
    const snapshot = history.snapshot as Record<string, unknown>;
    expect(snapshot.consultReason).toMatch(/^enc:v3:0:/);
    expect(snapshot.intervention).toMatch(/^enc:v3:0:/);
    expect(snapshot.agreements).toBeNull();
    expect(snapshot.sessionType).toBe('IN_PERSON');

    const discharge = await prisma.treatmentDischarge.findUniqueOrThrow({
      where: { id: dischargeId },
    });
    for (const field of [
      'consultReason',
      'evolutionSummary',
      'statusAtDischarge',
      'recommendations',
      'dropoutNote',
    ] as const) {
      expect(discharge[field]).toMatch(/^enc:v3:0:/);
    }
    expect(discharge.diagnosis).toBeNull();
    expect(JSON.stringify([consultation, snapshot, discharge])).not.toContain(
      'plan',
    );

    const again = await runReencrypt([port()], { apply: true });
    expect(again.datasets[0].reencrypted).toBe(0);
    expect(again.datasets[0].wouldReencrypt).toBe(0);
    expect(again.datasets[0].failed).toBe(0);
  }, 30000);

  it('writeIfUnchanged rechaza la escritura si el valor cambió en paralelo (columna y snapshot)', async () => {
    const port = buildClinicalPort(prisma, keyring);

    const column = await port.writeIfUnchanged(
      { id: `consultation/${consultationId}/consultReason` },
      'valor que ya no está',
      'nuevo',
    );
    const inSnapshot = await port.writeIfUnchanged(
      { id: `history/${historyId}/consultReason` },
      'valor que ya no está',
      'nuevo',
    );

    expect(column).toBe(false);
    expect(inSnapshot).toBe(false);
    const consultation = await prisma.consultation.findUniqueOrThrow({
      where: { id: consultationId },
    });
    expect(consultation.consultReason).not.toBe('nuevo');
  }, 30000);
});
