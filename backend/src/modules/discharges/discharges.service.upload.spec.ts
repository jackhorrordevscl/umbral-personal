import { buildTestClinicalCrypto } from '../../common/crypto/clinical-text-crypto.testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TreatmentDischarge } from '@prisma/client';
import { createHash } from 'crypto';
import { DischargesService } from './discharges.service';
import { DischargeCancellationNotifier } from './discharge-cancellation-notifier.service';
import { encryptDischargeTexts } from './util/discharge-text.util';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from '../availability/availability.service';
import { PaymentsService } from '../payments/payments.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { DocumentsService } from '../documents/documents.service';
import type { UploadDischargeDto } from './dto/upload-discharge.dto';

const PDF_BYTES = Buffer.from('%PDF-1.4\ncontenido propio\n%%EOF', 'latin1');
const PDF_SHA = createHash('sha256').update(PDF_BYTES).digest('hex');

function pdfFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    originalname: 'mi informe.pdf',
    mimetype: 'application/pdf',
    size: PDF_BYTES.length,
    buffer: PDF_BYTES,
    ...overrides,
  } as Express.Multer.File;
}

function uploadedRow(overrides: Partial<TreatmentDischarge> = {}) {
  return {
    id: 'dis-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    groupId: 'dis-1',
    version: 1,
    correctsId: null,
    source: 'UPLOADED',
    status: 'ISSUED',
    closureReason: 'DISCHARGED',
    dropoutReason: null,
    dropoutNote: null,
    referralDestination: null,
    admissionDate: new Date('2026-03-02T00:00:00.000Z'),
    dischargeDate: new Date('2026-03-30T00:00:00.000Z'),
    sessionCount: 4,
    consultReason: '',
    diagnosis: null,
    evolutionSummary: '',
    statusAtDischarge: '',
    recommendations: '',
    signerName: 'Ana Pérez',
    signerRut: null,
    signerProfessionalRegistration: null,
    issuedAt: new Date('2026-03-30T12:00:00.000Z'),
    contentHash: PDF_SHA,
    pdfSha256: PDF_SHA,
    documentId: 'doc-old',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TreatmentDischarge;
}

const dto = (extra: Partial<UploadDischargeDto> = {}): UploadDischargeDto =>
  ({ closureReason: 'DISCHARGED', ...extra }) as UploadDischargeDto;

describe('DischargesService T3b (PDF propio)', () => {
  let service: DischargesService;
  let prisma: {
    patient: { findFirst: jest.Mock; update: jest.Mock };
    treatmentDischarge: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
    };
    consultation: {
      count: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    bookedSlot: { deleteMany: jest.Mock };
    user: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let patientsService: {
    assertAccess: jest.Mock;
    assertTreatmentConsent: jest.Mock;
  };
  let documentsService: {
    storeGeneratedDocument: jest.Mock;
    discardGeneratedDocument: jest.Mock;
    voidDischargeDocument: jest.Mock;
    getDecryptedFile: jest.Mock;
  };
  let auditService: { log: jest.Mock };
  let availabilityService: { invalidate: jest.Mock };
  let paymentsService: { cancelUnpaid: jest.Mock };
  let calendarSync: { deleteEventsForGroups: jest.Mock };

  beforeEach(() => {
    prisma = {
      patient: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'patient-1', treatmentStatus: 'ACTIVE' }),
        update: jest.fn().mockResolvedValue({}),
      },
      treatmentDischarge: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          issuedAt: new Date('2026-01-10T12:00:00.000Z'),
        }),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: object }) =>
            Promise.resolve(uploadedRow(data as Partial<TreatmentDischarge>)),
          ),
      },
      consultation: {
        count: jest.fn().mockResolvedValue(4),
        findFirst: jest.fn().mockResolvedValue({
          sessionDate: new Date('2026-03-02T15:00:00.000Z'),
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      bookedSlot: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Ana Pérez',
          rut: null,
          professionalRegistration: null,
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
    patientsService = {
      assertAccess: jest.fn().mockResolvedValue({ id: 'patient-1' }),
      assertTreatmentConsent: jest.fn().mockResolvedValue(undefined),
    };
    documentsService = {
      storeGeneratedDocument: jest.fn().mockResolvedValue({ id: 'doc-new' }),
      discardGeneratedDocument: jest.fn().mockResolvedValue(undefined),
      voidDischargeDocument: jest.fn().mockResolvedValue({}),
      getDecryptedFile: jest.fn(),
    };
    auditService = { log: jest.fn().mockResolvedValue({}) };
    availabilityService = { invalidate: jest.fn() };
    paymentsService = { cancelUnpaid: jest.fn().mockResolvedValue(undefined) };
    calendarSync = {
      deleteEventsForGroups: jest.fn().mockResolvedValue(undefined),
    };
    service = new DischargesService(
      prisma as unknown as PrismaService,
      patientsService as unknown as PatientsService,
      auditService as unknown as AuditService,
      availabilityService as unknown as AvailabilityService,
      paymentsService as unknown as PaymentsService,
      calendarSync as unknown as CalendarSyncService,
      documentsService as unknown as DocumentsService,
      { notify: jest.fn() } as unknown as DischargeCancellationNotifier,

      buildTestClinicalCrypto(),
    );
  });

  describe('uploadReport', () => {
    it('sube, emite directo como UPLOADED con el SHA-256 de los bytes y cierra el tratamiento', async () => {
      const result = await service.uploadReport(
        'patient-1',
        dto(),
        pdfFile(),
        'therapist-1',
      );

      expect(documentsService.storeGeneratedDocument).toHaveBeenCalledWith({
        patientId: 'patient-1',
        userId: 'therapist-1',
        type: 'DISCHARGE_REPORT',
        fileName: 'mi informe.pdf',
        buffer: PDF_BYTES,
      });
      const data = (
        prisma.treatmentDischarge.create.mock.calls as {
          data: Record<string, unknown>;
        }[][]
      )[0][0].data;
      expect(data).toMatchObject({
        source: 'UPLOADED',
        status: 'ISSUED',
        version: 1,
        closureReason: 'DISCHARGED',
        contentHash: PDF_SHA,
        pdfSha256: PDF_SHA,
        documentId: 'doc-new',
        sessionCount: 4,
        signerName: 'Ana Pérez',
        signerRut: null,
      });
      expect(data.groupId).toBe(data.id);
      // Sin contenido clínico: el contenido vive en el PDF.
      expect(data).not.toHaveProperty('consultReason');
      expect(data).not.toHaveProperty('evolutionSummary');
      expect(prisma.patient.update).toHaveBeenCalledWith({
        where: { id: 'patient-1' },
        data: { treatmentStatus: 'DISCHARGED' },
      });
      expect(result.cancelledConsultations).toBe(0);
    });

    it('no exige RUT del terapeuta (la regla aplica solo a GENERATED)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        name: 'Ana',
        rut: null,
        professionalRegistration: null,
      });
      await expect(
        service.uploadReport('patient-1', dto(), pdfFile(), 'therapist-1'),
      ).resolves.toBeDefined();
    });

    it('toma los locks User y luego Patient antes de decidir', async () => {
      await service.uploadReport('patient-1', dto(), pdfFile(), 'therapist-1');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      const sql = (prisma.$queryRaw.mock.calls as unknown[][]).map((c) =>
        (c[0] as string[]).join(''),
      );
      expect(sql[0]).toContain('"User"');
      expect(sql[1]).toContain('"Patient"');
    });

    it('cancela las consultas futuras y registra auditoría con source=UPLOADED', async () => {
      prisma.consultation.findMany.mockResolvedValue([
        { id: 'c1', groupId: 'g1' },
      ]);
      const result = await service.uploadReport(
        'patient-1',
        dto(),
        pdfFile(),
        'therapist-1',
      );
      expect(prisma.consultation.updateMany).toHaveBeenCalled();
      expect(prisma.bookedSlot.deleteMany).toHaveBeenCalledWith({
        where: { groupId: { in: ['g1'] } },
      });
      expect(result.cancelledConsultations).toBe(1);
      expect(paymentsService.cancelUnpaid).toHaveBeenCalledWith('g1');
      expect(availabilityService.invalidate).toHaveBeenCalledWith(
        'therapist-1',
      );
      const actions = (
        auditService.log.mock.calls as { action: string }[][]
      ).map((c) => c[0].action);
      expect(actions).toEqual([
        'DISCHARGE_ISSUE',
        'TREATMENT_CLOSED',
        'CONSULTATION_CANCELLED',
      ]);
      const issue = (
        auditService.log.mock.calls as { action: string; detail: string }[][]
      )[0][0];
      expect(issue.detail).toContain('source=UPLOADED');
      expect(issue.detail).not.toContain('mi informe');
    });

    it('da 403 sin consentimiento de tratamiento y descarta el documento huérfano', async () => {
      patientsService.assertTreatmentConsent.mockRejectedValue(
        new ForbiddenException('sin consentimiento'),
      );
      await expect(
        service.uploadReport('patient-1', dto(), pdfFile(), 'therapist-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.treatmentDischarge.create).not.toHaveBeenCalled();
      expect(documentsService.discardGeneratedDocument).toHaveBeenCalledWith(
        'doc-new',
      );
    });

    it('da 409 si el paciente ya está cerrado (subidas concurrentes) y descarta el documento', async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: 'patient-1',
        treatmentStatus: 'DISCHARGED',
      });
      await expect(
        service.uploadReport('patient-1', dto(), pdfFile(), 'therapist-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.treatmentDischarge.create).not.toHaveBeenCalled();
      expect(prisma.patient.update).not.toHaveBeenCalled();
      expect(documentsService.discardGeneratedDocument).toHaveBeenCalledWith(
        'doc-new',
      );
    });

    it('descarta el documento huérfano si falla la creación y conserva el error original', async () => {
      const boom = new Error('db caída');
      prisma.treatmentDischarge.create.mockRejectedValue(boom);
      await expect(
        service.uploadReport('patient-1', dto(), pdfFile(), 'therapist-1'),
      ).rejects.toBe(boom);
      expect(documentsService.discardGeneratedDocument).toHaveBeenCalledWith(
        'doc-new',
      );
    });

    it('si el descarte también falla, igual propaga el error de la transacción', async () => {
      prisma.treatmentDischarge.create.mockRejectedValue(new Error('db caída'));
      documentsService.discardGeneratedDocument.mockRejectedValue(
        new Error('b2 caído'),
      );
      await expect(
        service.uploadReport('patient-1', dto(), pdfFile(), 'therapist-1'),
      ).rejects.toThrow('db caída');
    });

    it.each([
      ['archivo ausente', undefined],
      ['mime falso', pdfFile({ buffer: Buffer.from('MZ\x90\x00binario') })],
      ['vacío', pdfFile({ buffer: Buffer.alloc(0) })],
      ['otro mimetype', pdfFile({ mimetype: 'image/png' })],
    ])('rechaza con 400 sin tocar el storage: %s', async (_name, file) => {
      await expect(
        service.uploadReport('patient-1', dto(), file, 'therapist-1'),
      ).rejects.toThrow(BadRequestException);
      expect(documentsService.storeGeneratedDocument).not.toHaveBeenCalled();
    });

    it('aplica las reglas de cierre de T2c (deserción sin motivo, motivo con otro cierre)', async () => {
      await expect(
        service.uploadReport(
          'patient-1',
          dto({ closureReason: 'DROPPED_OUT' }),
          pdfFile(),
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.uploadReport(
          'patient-1',
          dto({ closureReason: 'DISCHARGED', dropoutReason: 'COST' }),
          pdfFile(),
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(documentsService.storeGeneratedDocument).not.toHaveBeenCalled();
    });

    it('rechaza una fecha de alta futura antes de guardar nada', async () => {
      await expect(
        service.uploadReport(
          'patient-1',
          dto({ dischargeDate: '2999-01-01' }),
          pdfFile(),
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(documentsService.storeGeneratedDocument).not.toHaveBeenCalled();
    });

    it('propaga el 404 uniforme de un paciente ajeno sin guardar nada', async () => {
      patientsService.assertAccess.mockRejectedValue(new NotFoundException());
      await expect(
        service.uploadReport('patient-x', dto(), pdfFile(), 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
      expect(documentsService.storeGeneratedDocument).not.toHaveBeenCalled();
    });
  });

  describe('correctUpload', () => {
    beforeEach(() => {
      // findOwned y relecturas: el informe vigente; sin corrección previa.
      prisma.treatmentDischarge.findFirst.mockImplementation(
        ({ where }: { where: { id?: string; correctsId?: string } }) =>
          Promise.resolve(where.correctsId ? null : uploadedRow()),
      );
      prisma.patient.findFirst.mockResolvedValue({
        id: 'patient-1',
        treatmentStatus: 'DISCHARGED',
      });
    });

    it('crea la versión siguiente emitida y anula el documento anterior', async () => {
      const result = await service.correctUpload(
        'dis-1',
        dto({ closureReason: 'REFERRED' }),
        pdfFile(),
        'therapist-1',
      );
      const data = (
        prisma.treatmentDischarge.create.mock.calls as {
          data: Record<string, unknown>;
        }[][]
      )[0][0].data;
      expect(data).toMatchObject({
        groupId: 'dis-1',
        version: 2,
        correctsId: 'dis-1',
        source: 'UPLOADED',
        status: 'ISSUED',
        documentId: 'doc-new',
        contentHash: PDF_SHA,
      });
      expect(documentsService.voidDischargeDocument).toHaveBeenCalledWith(
        'doc-old',
        { reason: 'Reemplazado por una nueva versión del informe' },
        'therapist-1',
      );
      // Paciente cerrado y cambió el motivo: el estado se reescribe.
      expect(prisma.patient.update).toHaveBeenCalledWith({
        where: { id: 'patient-1' },
        data: { treatmentStatus: 'REFERRED' },
      });
      expect(result.version).toBe(2);
      const actions = (
        auditService.log.mock.calls as { action: string }[][]
      ).map((c) => c[0].action);
      expect(actions).toEqual([
        'DOCUMENT_VOID',
        'DISCHARGE_ISSUE',
        'DISCHARGE_CORRECT',
        'TREATMENT_CLOSED',
      ]);
    });

    it('registra DOCUMENT_VOID del PDF reemplazado, sin el motivo ni datos personales', async () => {
      await service.correctUpload(
        'dis-1',
        dto({ closureReason: 'REFERRED' }),
        pdfFile(),
        'therapist-1',
        { ipAddress: '10.0.0.1', userAgent: 'jest' },
      );
      const voidEntry = (
        auditService.log.mock.calls as Record<string, unknown>[][]
      )
        .map((c) => c[0])
        .find((e) => e.action === 'DOCUMENT_VOID');
      expect(voidEntry).toEqual({
        userId: 'therapist-1',
        action: 'DOCUMENT_VOID',
        resource: 'Document',
        resourceId: 'doc-old',
        detail: 'patientId=patient-1 dischargeId=dis-1 replacedBy=doc-new',
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
      });
    });

    it('con el paciente reabierto registra la versión sin tocar su estado ni sus consultas', async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: 'patient-1',
        treatmentStatus: 'ACTIVE',
      });
      await service.correctUpload('dis-1', dto(), pdfFile(), 'therapist-1');
      expect(prisma.patient.update).not.toHaveBeenCalled();
      expect(prisma.consultation.findMany).not.toHaveBeenCalled();
      expect(documentsService.voidDischargeDocument).toHaveBeenCalled();
      const actions = (
        auditService.log.mock.calls as { action: string }[][]
      ).map((c) => c[0].action);
      expect(actions).not.toContain('TREATMENT_CLOSED');
    });

    it('con un cierre posterior de otro grupo registra la versión sin tocar el estado vigente ni las consultas', async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: 'patient-1',
        treatmentStatus: 'REFERRED',
      });
      prisma.treatmentDischarge.count.mockResolvedValue(1);
      prisma.consultation.findMany.mockResolvedValue([
        { id: 'c-1', groupId: 'g-1' },
      ]);

      const result = await service.correctUpload(
        'dis-1',
        dto({ closureReason: 'DISCHARGED' }),
        pdfFile(),
        'therapist-1',
      );

      expect(result.version).toBe(2);
      expect(prisma.patient.update).not.toHaveBeenCalled();
      expect(prisma.consultation.findMany).not.toHaveBeenCalled();
      expect(documentsService.voidDischargeDocument).toHaveBeenCalled();
      const actions = (
        auditService.log.mock.calls as { action: string }[][]
      ).map((c) => c[0].action);
      expect(actions).toEqual([
        'DOCUMENT_VOID',
        'DISCHARGE_ISSUE',
        'DISCHARGE_CORRECT',
      ]);
    });

    it('da 409 si la versión ya fue corregida, sin guardar ni anular nada', async () => {
      prisma.treatmentDischarge.findFirst.mockImplementation(
        ({ where }: { where: { correctsId?: string } }) =>
          Promise.resolve(where.correctsId ? { id: 'dis-2' } : uploadedRow()),
      );
      await expect(
        service.correctUpload('dis-1', dto(), pdfFile(), 'therapist-1'),
      ).rejects.toThrow(ConflictException);
      expect(documentsService.storeGeneratedDocument).not.toHaveBeenCalled();
      expect(documentsService.voidDischargeDocument).not.toHaveBeenCalled();
    });

    it('traduce el P2002 de correctsId a 409, descarta el documento nuevo y no anula el anterior', async () => {
      prisma.treatmentDischarge.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.correctUpload('dis-1', dto(), pdfFile(), 'therapist-1'),
      ).rejects.toThrow(ConflictException);
      expect(documentsService.discardGeneratedDocument).toHaveBeenCalledWith(
        'doc-new',
      );
      expect(documentsService.voidDischargeDocument).not.toHaveBeenCalled();
    });

    it('da 409 al reemplazar con archivo un informe GENERATED', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        uploadedRow({ source: 'GENERATED' }),
      );
      await expect(
        service.correctUpload('dis-1', dto(), pdfFile(), 'therapist-1'),
      ).rejects.toThrow(/corrección normal/);
      expect(documentsService.storeGeneratedDocument).not.toHaveBeenCalled();
    });

    it('da 409 si el informe es un borrador', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        uploadedRow({ status: 'DRAFT' }),
      );
      await expect(
        service.correctUpload('dis-1', dto(), pdfFile(), 'therapist-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('da 404 uniforme si el informe es de otro terapeuta', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(null);
      await expect(
        service.correctUpload('dis-1', dto(), pdfFile(), 'otro'),
      ).rejects.toThrow(NotFoundException);
      expect(documentsService.storeGeneratedDocument).not.toHaveBeenCalled();
    });

    it('un fallo al anular el documento anterior no revierte la corrección', async () => {
      documentsService.voidDischargeDocument.mockRejectedValue(
        new Error('fallo'),
      );
      await expect(
        service.correctUpload('dis-1', dto(), pdfFile(), 'therapist-1'),
      ).resolves.toMatchObject({ version: 2 });
      const actions = (
        auditService.log.mock.calls as { action: string }[][]
      ).map((c) => c[0].action);
      expect(actions).not.toContain('DOCUMENT_VOID');
    });
  });

  describe('corrección normal sobre un informe subido', () => {
    it('da 409 indicando usar correct-upload', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(uploadedRow());
      await expect(service.correct('dis-1', 'therapist-1')).rejects.toThrow(
        /correct-upload/,
      );
      expect(prisma.treatmentDischarge.create).not.toHaveBeenCalled();
    });
  });

  describe('verify de un informe subido', () => {
    it('es válido si el SHA-256 de los bytes coincide y se marca como aportado por el terapeuta', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue({
        ...uploadedRow(),
        correctedBy: null,
      });
      documentsService.getDecryptedFile.mockResolvedValue({
        doc: {},
        buffer: PDF_BYTES,
      });
      const res = await service.verify('dis-1', 'therapist-1');
      expect(res).toMatchObject({
        valid: true,
        source: 'UPLOADED',
        providedByTherapist: true,
        contentHash: PDF_SHA,
        pdf: { present: true, intact: true },
      });
    });

    it('no descifra los textos: un campo ilegible no impide verificar el archivo', async () => {
      const good = encryptDischargeTexts(
        { consultReason: 'Motivo' },
        buildTestClinicalCrypto(),
      ).consultReason;
      prisma.treatmentDischarge.findFirst.mockResolvedValue({
        ...uploadedRow({ consultReason: `${good.slice(0, -4)}AAAA` }),
        correctedBy: null,
      });
      documentsService.getDecryptedFile.mockResolvedValue({
        doc: {},
        buffer: PDF_BYTES,
      });

      const res = await service.verify('dis-1', 'therapist-1');

      expect(res).toMatchObject({
        valid: true,
        source: 'UPLOADED',
        pdf: { present: true, intact: true },
      });
    });

    it('es inválido si los bytes guardados cambiaron', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue({
        ...uploadedRow(),
        correctedBy: null,
      });
      documentsService.getDecryptedFile.mockResolvedValue({
        doc: {},
        buffer: Buffer.from('%PDF-1.4 alterado'),
      });
      const res = await service.verify('dis-1', 'therapist-1');
      expect(res.valid).toBe(false);
      expect(res.pdf).toEqual({ present: true, intact: false });
    });

    it('es inválido si el objeto ya no existe en el storage', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue({
        ...uploadedRow(),
        correctedBy: null,
      });
      documentsService.getDecryptedFile.mockRejectedValue(
        new NotFoundException(),
      );
      const res = await service.verify('dis-1', 'therapist-1');
      expect(res.valid).toBe(false);
      expect(res.pdf).toEqual({ present: true, intact: false });
    });

    it('un fallo de infraestructura se propaga en vez de afirmar que es inválido', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue({
        ...uploadedRow(),
        correctedBy: null,
      });
      documentsService.getDecryptedFile.mockRejectedValue(new Error('b2'));
      await expect(service.verify('dis-1', 'therapist-1')).rejects.toThrow(
        'b2',
      );
    });
  });

  describe('ensurePdf', () => {
    it('es un no-op para un informe subido', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(uploadedRow());
      const row = await service.ensurePdf('dis-1', 'therapist-1');
      expect(row.documentId).toBe('doc-old');
      expect(documentsService.storeGeneratedDocument).not.toHaveBeenCalled();
    });
  });
});
