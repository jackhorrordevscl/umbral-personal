import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DischargeDeliveriesService } from './discharge-deliveries.service';
import { CreateDischargeDeliveryDto } from './dto/create-discharge-delivery.dto';

const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

/**
 * T4: registro de entregas del informe de alta contra Postgres real. Los unit
 * specs usan mocks; aquí se comprueban las consultas de aislamiento
 * (paciente, tipo de documento, anulación) y las FK reales.
 */
describe('DischargeDeliveriesService (integration)', () => {
  let prisma: PrismaService;
  let service: DischargeDeliveriesService;
  let therapistId: string;
  const runId = Date.now();
  const patientIds: string[] = [];

  async function createPatient(label: string, birthDate: Date) {
    const patient = await prisma.patient.create({
      data: {
        fullName: `Paciente ${label}`,
        rut: `${runId}-${patientIds.length + 1}`,
        birthDate,
        therapistId,
      },
    });
    patientIds.push(patient.id);
    return patient;
  }

  async function createIssuedDischarge(patientId: string) {
    const id = randomUUID();
    return prisma.treatmentDischarge.create({
      data: {
        id,
        groupId: id,
        patientId,
        therapistId,
        status: 'ISSUED',
        closureReason: 'DISCHARGED',
        admissionDate: new Date('2026-01-10T00:00:00.000Z'),
        dischargeDate: new Date('2026-10-10T00:00:00.000Z'),
        sessionCount: 10,
        issuedAt: new Date('2026-10-10T15:00:00.000Z'),
      },
    });
  }

  async function createDocument(
    patientId: string,
    type: 'DELIVERY_AUTHORIZATION' | 'OTHER',
    voided = false,
  ) {
    return prisma.patientDocument.create({
      data: {
        patientId,
        type,
        fileName: 'autorizacion.pdf',
        storagePath: `test/${runId}/${randomUUID()}`,
        uploadedBy: therapistId,
        voidedAt: voided ? new Date() : null,
      },
    });
  }

  function dto(
    overrides: Partial<CreateDischargeDeliveryDto>,
  ): CreateDischargeDeliveryDto {
    return {
      purpose: 'Entrega del informe',
      channel: 'IN_PERSON',
      ...overrides,
    } as CreateDischargeDeliveryDto;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const therapist = await prisma.user.create({
      data: {
        email: `discharge-deliveries-${runId}@example.com`,
        passwordHash: await argon2.hash('TestPass123!'),
        name: 'Dra. Entregas',
      },
    });
    therapistId = therapist.id;
    service = new DischargeDeliveriesService(prisma, new AuditService(prisma));
  }, 30000);

  afterAll(async () => {
    await prisma.dischargeDelivery.deleteMany({
      where: { discharge: { therapistId } },
    });
    await prisma.treatmentDischarge.deleteMany({ where: { therapistId } });
    await prisma.patientDocument.deleteMany({
      where: { patientId: { in: patientIds } },
    });
    await prisma.legalGuardian.deleteMany({
      where: { patientId: { in: patientIds } },
    });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    // AuditLog es append-only y su FK al User es Restrict: se da de baja.
    await prisma.user.updateMany({
      where: { id: therapistId },
      data: { deletedAt: new Date() },
    });
    await prisma.onModuleDestroy();
  }, 30000);

  it('registra la entrega a un paciente adulto y la lista', async () => {
    const patient = await createPatient('Adulto', new Date('1990-01-01'));
    const discharge = await createIssuedDischarge(patient.id);

    const delivery = await service.record(
      discharge.id,
      dto({ recipientType: 'PATIENT' }),
      therapistId,
      ctx,
    );

    expect(delivery).toMatchObject({
      dischargeId: discharge.id,
      recipientType: 'PATIENT',
      recipientName: 'Paciente Adulto',
      recordedById: therapistId,
    });
    const listed = await service.list(discharge.id, therapistId);
    expect(listed.map((d) => d.id)).toEqual([delivery.id]);
    const audits = await prisma.auditLog.count({
      where: { action: 'DISCHARGE_DELIVER', resourceId: discharge.id },
    });
    expect(audits).toBe(1);
  });

  it('a un menor solo se entrega a un representante con acceso a informes', async () => {
    const minor = await createPatient('Menor', new Date('2015-05-20'));
    const other = await createPatient('Otro', new Date('2015-05-20'));
    const discharge = await createIssuedDischarge(minor.id);
    const allowed = await prisma.legalGuardian.create({
      data: {
        patientId: minor.id,
        fullName: 'María Soto',
        rut: '11111111-1',
        relationship: 'MOTHER',
        canAccessReports: true,
      },
    });
    const noReports = await prisma.legalGuardian.create({
      data: {
        patientId: minor.id,
        fullName: 'Pedro Soto',
        rut: '22222222-2',
        relationship: 'FATHER',
        canAccessReports: false,
      },
    });
    const ofOtherPatient = await prisma.legalGuardian.create({
      data: {
        patientId: other.id,
        fullName: 'Ana Ajena',
        rut: '33333333-3',
        relationship: 'MOTHER',
        canAccessReports: true,
      },
    });

    await expect(
      service.record(
        discharge.id,
        dto({ recipientType: 'PATIENT' }),
        therapistId,
        ctx,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    for (const guardianId of [noReports.id, ofOtherPatient.id]) {
      await expect(
        service.record(
          discharge.id,
          dto({ recipientType: 'GUARDIAN', guardianId }),
          therapistId,
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    const delivery = await service.record(
      discharge.id,
      dto({ recipientType: 'GUARDIAN', guardianId: allowed.id }),
      therapistId,
      ctx,
    );
    expect(delivery).toMatchObject({
      recipientType: 'GUARDIAN',
      recipientName: 'María Soto',
      guardianId: allowed.id,
    });
  });

  it('a un tercero solo con una autorización vigente del mismo paciente', async () => {
    const patient = await createPatient('Tercero', new Date('1990-01-01'));
    const other = await createPatient('Ajeno', new Date('1990-01-01'));
    const discharge = await createIssuedDischarge(patient.id);
    const valid = await createDocument(patient.id, 'DELIVERY_AUTHORIZATION');
    const wrongType = await createDocument(patient.id, 'OTHER');
    const voided = await createDocument(
      patient.id,
      'DELIVERY_AUTHORIZATION',
      true,
    );
    const ofOtherPatient = await createDocument(
      other.id,
      'DELIVERY_AUTHORIZATION',
    );

    for (const authorizationDocumentId of [
      wrongType.id,
      voided.id,
      ofOtherPatient.id,
    ]) {
      await expect(
        service.record(
          discharge.id,
          dto({
            recipientType: 'THIRD_PARTY',
            recipientName: 'Colegio Sur',
            authorizationDocumentId,
            authorizationAttested: true,
          }),
          therapistId,
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    await expect(
      service.record(
        discharge.id,
        dto({
          recipientType: 'THIRD_PARTY',
          recipientName: 'Colegio Sur',
          authorizationDocumentId: valid.id,
        }),
        therapistId,
        ctx,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const delivery = await service.record(
      discharge.id,
      dto({
        recipientType: 'THIRD_PARTY',
        recipientName: 'Colegio Sur',
        authorizationDocumentId: valid.id,
        authorizationAttested: true,
        channel: 'POSTAL',
      }),
      therapistId,
      ctx,
    );
    expect(delivery).toMatchObject({
      recipientType: 'THIRD_PARTY',
      recipientName: 'Colegio Sur',
      authorizationDocumentId: valid.id,
      authorizationAttested: true,
      channel: 'POSTAL',
    });

    // La autorización usada queda protegida: no se puede borrar el documento.
    await expect(
      prisma.patientDocument.delete({ where: { id: valid.id } }),
    ).rejects.toThrow();
  });

  it('un informe de otro terapeuta responde 404 al registrar y al listar', async () => {
    const patient = await createPatient('Aislado', new Date('1990-01-01'));
    const discharge = await createIssuedDischarge(patient.id);

    await expect(
      service.record(
        discharge.id,
        dto({ recipientType: 'PATIENT' }),
        randomUUID(),
        ctx,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.list(discharge.id, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
