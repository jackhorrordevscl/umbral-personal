import { buildTestClinicalCrypto } from '../../common/crypto/clinical-text-crypto.testing';
import { encryptDischargeTexts } from './util/discharge-text.util';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TreatmentDischarge } from '@prisma/client';
import { DischargesService } from './discharges.service';
import { DischargeCancellationNotifier } from './discharge-cancellation-notifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from '../availability/availability.service';
import { PaymentsService } from '../payments/payments.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { DocumentsService } from '../documents/documents.service';
import {
  computeDischargeHash,
  dischargeHashInputFromRow,
} from './util/discharge-hash.util';
import * as pdfBuilder from './pdf/discharge-pdf.builder';

// Envuelve el builder real para poder inspeccionar con qué datos se invoca sin
// perder la generación de bytes reales.
jest.mock('./pdf/discharge-pdf.builder', () => {
  const actual = jest.requireActual<
    typeof import('./pdf/discharge-pdf.builder')
  >('./pdf/discharge-pdf.builder');
  return { ...actual, buildDischargePdf: jest.fn(actual.buildDischargePdf) };
});

const buildPdfSpy = pdfBuilder.buildDischargePdf as jest.MockedFunction<
  typeof pdfBuilder.buildDischargePdf
>;

const ISSUED_AT = new Date('2026-10-11T18:04:00.000Z');

function issuedRow(overrides: Partial<TreatmentDischarge> = {}) {
  const base = {
    id: 'dis-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    groupId: 'dis-1',
    version: 1,
    correctsId: null,
    source: 'GENERATED',
    status: 'ISSUED',
    closureReason: 'DISCHARGED',
    dropoutReason: null,
    dropoutNote: null,
    referralDestination: null,
    admissionDate: new Date('2026-03-02T00:00:00.000Z'),
    dischargeDate: new Date('2026-09-30T00:00:00.000Z'),
    sessionCount: 10,
    consultReason: 'Ansiedad',
    diagnosis: null,
    evolutionSummary: 'Evolución favorable',
    statusAtDischarge: 'Estable',
    recommendations: 'Control en 3 meses',
    signerName: 'Ana Pérez',
    signerRut: '12.345.678-5',
    signerProfessionalRegistration: null,
    issuedAt: ISSUED_AT,
    contentHash: null as string | null,
    documentId: null,
    pdfSha256: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TreatmentDischarge;
  if (overrides.contentHash === undefined) {
    base.contentHash = computeDischargeHash(dischargeHashInputFromRow(base));
  }
  return base;
}

const ADULT = {
  fullName: 'Luis Soto',
  rut: '9.876.543-3',
  birthDate: new Date('1990-05-20T00:00:00.000Z'),
};
const MINOR = { ...ADULT, birthDate: new Date('2015-05-20T00:00:00.000Z') };

describe('DischargesService PDF (T3)', () => {
  let service: DischargesService;
  let prisma: {
    patient: { findFirst: jest.Mock };
    legalGuardian: { findMany: jest.Mock };
    treatmentDischarge: { findFirst: jest.Mock; updateMany: jest.Mock };
  };
  let documents: {
    storeGeneratedDocument: jest.Mock;
    discardGeneratedDocument: jest.Mock;
    getDecryptedFile: jest.Mock;
  };

  beforeEach(() => {
    buildPdfSpy.mockClear();
    prisma = {
      patient: { findFirst: jest.fn().mockResolvedValue(ADULT) },
      legalGuardian: { findMany: jest.fn().mockResolvedValue([]) },
      treatmentDischarge: {
        findFirst: jest.fn().mockResolvedValue(issuedRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    documents = {
      storeGeneratedDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      discardGeneratedDocument: jest.fn().mockResolvedValue(undefined),
      getDecryptedFile: jest.fn(),
    };
    service = new DischargesService(
      prisma as unknown as PrismaService,
      {} as unknown as PatientsService,
      { log: jest.fn() } as unknown as AuditService,
      {} as unknown as AvailabilityService,
      {} as unknown as PaymentsService,
      {} as unknown as CalendarSyncService,
      documents as unknown as DocumentsService,
      { notify: jest.fn() } as unknown as DischargeCancellationNotifier,

      buildTestClinicalCrypto(),
    );
  });

  describe('ensurePdf', () => {
    it('un borrador da 409 y no genera nada', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        issuedRow({ status: 'DRAFT', issuedAt: null, contentHash: 'x' }),
      );
      await expect(service.ensurePdf('dis-1', 'therapist-1')).rejects.toThrow(
        ConflictException,
      );
      expect(documents.storeGeneratedDocument).not.toHaveBeenCalled();
    });

    it('un informe ajeno o inexistente da 404 uniforme, filtrando por terapeuta', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(null);
      await expect(service.ensurePdf('dis-1', 'intruso')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.treatmentDischarge.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'dis-1',
          therapistId: 'intruso',
        }) as unknown,
      });
      expect(documents.storeGeneratedDocument).not.toHaveBeenCalled();
    });

    it('genera el PDF, lo guarda como DISCHARGE_REPORT y fija documentId y pdfSha256', async () => {
      const winner = issuedRow({ documentId: 'doc-1', pdfSha256: 'z' });
      prisma.treatmentDischarge.findFirst
        .mockResolvedValueOnce(issuedRow())
        .mockResolvedValueOnce(winner);

      const result = await service.ensurePdf('dis-1', 'therapist-1');

      expect(documents.storeGeneratedDocument).toHaveBeenCalledTimes(1);
      const stored = (
        documents.storeGeneratedDocument.mock.calls as unknown[][]
      )[0][0] as {
        patientId: string;
        userId: string;
        type: string;
        fileName: string;
        buffer: Buffer;
      };
      expect(stored.type).toBe('DISCHARGE_REPORT');
      expect(stored.patientId).toBe('patient-1');
      expect(stored.userId).toBe('therapist-1');
      // 11 oct 2026 15:04 en Chile.
      expect(stored.fileName).toBe('informe-alta-v1-2026-10-11.pdf');
      expect(stored.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');

      const expectedSha = createHash('sha256')
        .update(stored.buffer)
        .digest('hex');
      expect(prisma.treatmentDischarge.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'dis-1',
          therapistId: 'therapist-1',
          status: 'ISSUED',
          documentId: null,
        },
        data: { documentId: 'doc-1', pdfSha256: expectedSha },
      });
      expect(documents.discardGeneratedDocument).not.toHaveBeenCalled();
      expect(result).toEqual(winner);
    });

    it('es la única mutación sobre una fila ISSUED: no toca contentHash ni el contenido', async () => {
      await service.ensurePdf('dis-1', 'therapist-1');
      const call = (
        prisma.treatmentDischarge.updateMany.mock.calls as unknown[][]
      )[0][0] as {
        data: Record<string, unknown>;
      };
      expect(Object.keys(call.data).sort()).toEqual([
        'documentId',
        'pdfSha256',
      ]);
    });

    it('descifra los textos antes de armar el PDF (ADR 0004)', async () => {
      const crypto = buildTestClinicalCrypto();
      prisma.treatmentDischarge.findFirst
        .mockResolvedValueOnce(
          issuedRow({
            ...encryptDischargeTexts(
              {
                consultReason: 'Motivo reservado',
                evolutionSummary: 'Evolución reservada',
                statusAtDischarge: 'Estado reservado',
                recommendations: 'Recomendaciones reservadas',
              },
              crypto,
              'patient-1',
            ),
            contentHash: 'x',
          }),
        )
        .mockResolvedValueOnce(issuedRow({ documentId: 'doc-1' }));

      await service.ensurePdf('dis-1', 'therapist-1');

      const arg = buildPdfSpy.mock.calls[0][0];
      expect(arg.discharge).toMatchObject({
        consultReason: 'Motivo reservado',
        evolutionSummary: 'Evolución reservada',
        statusAtDischarge: 'Estado reservado',
        recommendations: 'Recomendaciones reservadas',
      });
    });

    it('es idempotente: si ya hay documentId no genera ni escribe', async () => {
      const row = issuedRow({ documentId: 'doc-existente', pdfSha256: 'abc' });
      prisma.treatmentDischarge.findFirst.mockResolvedValue(row);

      const result = await service.ensurePdf('dis-1', 'therapist-1');

      expect(result).toEqual(row);
      expect(buildPdfSpy).not.toHaveBeenCalled();
      expect(documents.storeGeneratedDocument).not.toHaveBeenCalled();
      expect(prisma.treatmentDischarge.updateMany).not.toHaveBeenCalled();
    });

    it('un informe UPLOADED (T3b) no se genera: trae su propio PDF', async () => {
      const row = issuedRow({ source: 'UPLOADED' });
      prisma.treatmentDischarge.findFirst.mockResolvedValue(row);
      expect(await service.ensurePdf('dis-1', 'therapist-1')).toEqual(row);
      expect(buildPdfSpy).not.toHaveBeenCalled();
    });

    describe('carrera entre dos generaciones', () => {
      it('si pierde (count 0) descarta su documento sobrante y devuelve al ganador', async () => {
        const winner = issuedRow({ documentId: 'doc-ganador', pdfSha256: 'w' });
        prisma.treatmentDischarge.findFirst
          .mockResolvedValueOnce(issuedRow())
          .mockResolvedValueOnce(winner);
        prisma.treatmentDischarge.updateMany.mockResolvedValue({ count: 0 });

        const result = await service.ensurePdf('dis-1', 'therapist-1');

        expect(documents.discardGeneratedDocument).toHaveBeenCalledWith(
          'doc-1',
        );
        expect(result.documentId).toBe('doc-ganador');
      });

      it('dos llamadas concurrentes dejan un solo documento vigente', async () => {
        // Simula la base: solo el primer updateMany condicionado a documentId
        // null gana; el segundo ve count 0.
        let claimedBy: string | null = null;
        let nextDoc = 0;
        documents.storeGeneratedDocument.mockImplementation(() =>
          Promise.resolve({ id: `doc-${++nextDoc}` }),
        );
        prisma.treatmentDischarge.updateMany.mockImplementation(
          (args: { data: { documentId: string } }) => {
            if (claimedBy) return Promise.resolve({ count: 0 });
            claimedBy = args.data.documentId;
            return Promise.resolve({ count: 1 });
          },
        );
        prisma.treatmentDischarge.findFirst.mockImplementation(() =>
          Promise.resolve(
            issuedRow(
              claimedBy ? { documentId: claimedBy, pdfSha256: 'x' } : {},
            ),
          ),
        );

        // Ambas leen documentId null antes de que alguna reclame.
        const [a, b] = await Promise.all([
          service.ensurePdf('dis-1', 'therapist-1'),
          service.ensurePdf('dis-1', 'therapist-1'),
        ]);

        const discarded = (
          documents.discardGeneratedDocument.mock.calls as unknown[][]
        ).map((c) => c[0] as string);
        expect(documents.storeGeneratedDocument).toHaveBeenCalledTimes(2);
        expect(discarded).toHaveLength(1);
        expect(discarded[0]).not.toBe(claimedBy);
        expect(a.documentId).toBe(claimedBy);
        expect(b.documentId).toBe(claimedBy);
      });

      it('si descartar el sobrante falla, solo se registra y se devuelve al ganador', async () => {
        prisma.treatmentDischarge.updateMany.mockResolvedValue({ count: 0 });
        documents.discardGeneratedDocument.mockRejectedValue(new Error('b2'));
        const errorLog = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);

        await expect(
          service.ensurePdf('dis-1', 'therapist-1'),
        ).resolves.toBeDefined();
        expect(errorLog).toHaveBeenCalledWith(
          expect.stringContaining('PDF sobrante'),
        );
        errorLog.mockRestore();
      });

      it('si el updateMany lanza, descarta el documento y relanza', async () => {
        const boom = new Error('db');
        prisma.treatmentDischarge.updateMany.mockRejectedValue(boom);
        await expect(service.ensurePdf('dis-1', 'therapist-1')).rejects.toBe(
          boom,
        );
        expect(documents.discardGeneratedDocument).toHaveBeenCalledWith(
          'doc-1',
        );
      });
    });

    it('si falla el storage, no toca el informe', async () => {
      const boom = new Error('b2 caído');
      documents.storeGeneratedDocument.mockRejectedValue(boom);
      await expect(service.ensurePdf('dis-1', 'therapist-1')).rejects.toBe(
        boom,
      );
      expect(prisma.treatmentDischarge.updateMany).not.toHaveBeenCalled();
    });

    describe('representante legal', () => {
      it('adulto: no consulta representantes', async () => {
        await service.ensurePdf('dis-1', 'therapist-1');
        expect(prisma.legalGuardian.findMany).not.toHaveBeenCalled();
        const input = buildPdfSpy.mock.calls[0][0];
        expect(input.guardians).toEqual([]);
      });

      it('NNA al emitir: pasa solo los representantes con canAccessReports', async () => {
        prisma.patient.findFirst.mockResolvedValue(MINOR);
        const guardians = [
          {
            fullName: 'María Rojas',
            rut: '7.654.321-6',
            relationship: 'MOTHER',
          },
        ];
        prisma.legalGuardian.findMany.mockResolvedValue(guardians);

        await service.ensurePdf('dis-1', 'therapist-1');

        expect(prisma.legalGuardian.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { patientId: 'patient-1', canAccessReports: true },
          }),
        );
        expect(buildPdfSpy.mock.calls[0][0].guardians).toEqual(guardians);
      });

      it('la edad se mide al emitir, no hoy: quien era NNA al emitir sigue con representante', async () => {
        // Cumplió 18 el 2026-10-05: era NNA al emitir (2026-09-01) y hoy
        // (2026-10-11 o después) ya es mayor.
        prisma.treatmentDischarge.findFirst.mockResolvedValue(
          issuedRow({ issuedAt: new Date('2026-09-01T15:00:00.000Z') }),
        );
        prisma.patient.findFirst.mockResolvedValue({
          ...ADULT,
          birthDate: new Date('2008-10-05T00:00:00.000Z'),
        });
        prisma.legalGuardian.findMany.mockResolvedValue([
          { fullName: 'Pedro', rut: '1-9', relationship: 'FATHER' },
        ]);
        await service.ensurePdf('dis-1', 'therapist-1');
        expect(buildPdfSpy.mock.calls[0][0].guardians).toHaveLength(1);
      });

      it('NNA sin representantes con acceso: la lista va vacía y la sección se omite', async () => {
        prisma.patient.findFirst.mockResolvedValue(MINOR);
        await service.ensurePdf('dis-1', 'therapist-1');
        expect(buildPdfSpy.mock.calls[0][0].guardians).toEqual([]);
      });
    });

    it('no pasa dropoutReason ni dropoutNote al builder', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        issuedRow({
          closureReason: 'DROPPED_OUT',
          dropoutReason: 'OTHER',
          dropoutNote: 'NOTA-PRIVADA',
        }),
      );
      await service.ensurePdf('dis-1', 'therapist-1');
      const serialized = JSON.stringify(buildPdfSpy.mock.calls[0][0]);
      expect(serialized).not.toContain('NOTA-PRIVADA');
      expect(serialized).not.toContain('dropoutReason');
    });
  });

  describe('getPdf', () => {
    it('devuelve los bytes descifrados, el nombre y el paciente', async () => {
      const row = issuedRow({ documentId: 'doc-1', pdfSha256: 'x' });
      prisma.treatmentDischarge.findFirst.mockResolvedValue(row);
      documents.getDecryptedFile.mockResolvedValue({
        doc: { fileName: 'informe.pdf' },
        buffer: Buffer.from('%PDF-descifrado'),
      });

      const file = await service.getPdf('dis-1', 'therapist-1');

      expect(documents.getDecryptedFile).toHaveBeenCalledWith(
        'doc-1',
        'therapist-1',
      );
      expect(file.fileName).toBe('informe.pdf');
      expect(file.patientId).toBe('patient-1');
      expect(file.buffer.toString()).toBe('%PDF-descifrado');
    });

    it('un borrador da 409', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        issuedRow({ status: 'DRAFT', issuedAt: null, contentHash: 'x' }),
      );
      await expect(service.getPdf('dis-1', 'therapist-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('un informe UPLOADED sin PDF vinculado da 404', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        issuedRow({ source: 'UPLOADED' }),
      );
      await expect(service.getPdf('dis-1', 'therapist-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('si aún no hay PDF lo genera y lo sirve', async () => {
      prisma.treatmentDischarge.findFirst
        .mockResolvedValueOnce(issuedRow())
        .mockResolvedValueOnce(
          issuedRow({ documentId: 'doc-1', pdfSha256: 'x' }),
        );
      documents.getDecryptedFile.mockResolvedValue({
        doc: { fileName: 'informe.pdf' },
        buffer: Buffer.from('%PDF-'),
      });
      await service.getPdf('dis-1', 'therapist-1');
      expect(documents.storeGeneratedDocument).toHaveBeenCalledTimes(1);
    });
  });

  describe('verify: pdf', () => {
    const pdfBytes = Buffer.from('%PDF-1.7 contenido');
    const sha = createHash('sha256').update(pdfBytes).digest('hex');

    function verifyRow(overrides: Partial<TreatmentDischarge> = {}) {
      return { ...issuedRow(overrides), correctedBy: null };
    }

    it('sin PDF: present false, intact null, y el contrato existente intacto', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(verifyRow());
      const result = await service.verify('dis-1', 'therapist-1');
      expect(result.valid).toBe(true);
      expect(result.pdf).toEqual({ present: false, intact: null });
      expect(result).toEqual(
        expect.objectContaining({
          dischargeId: 'dis-1',
          groupId: 'dis-1',
          version: 1,
          status: 'ISSUED',
          isCurrent: true,
        }),
      );
    });

    it('PDF íntegro: intact true y valid sigue basado en contentHash', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        verifyRow({ documentId: 'doc-1', pdfSha256: sha }),
      );
      documents.getDecryptedFile.mockResolvedValue({
        doc: {},
        buffer: pdfBytes,
      });
      const result = await service.verify('dis-1', 'therapist-1');
      expect(result.valid).toBe(true);
      expect(result.pdf).toEqual({ present: true, intact: true });
      expect(result).not.toHaveProperty('pdfSha256');
    });

    it('PDF alterado: intact false sin invalidar el hash del contenido', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        verifyRow({ documentId: 'doc-1', pdfSha256: sha }),
      );
      documents.getDecryptedFile.mockResolvedValue({
        doc: {},
        buffer: Buffer.from('%PDF-1.7 alterado'),
      });
      const result = await service.verify('dis-1', 'therapist-1');
      expect(result.valid).toBe(true);
      expect(result.pdf).toEqual({ present: true, intact: false });
    });

    it('el contentHash no depende de documentId ni de pdfSha256', () => {
      const without = verifyRow();
      const withPdf = verifyRow({
        documentId: 'doc-1',
        pdfSha256: sha,
        contentHash: without.contentHash,
      });
      expect(computeDischargeHash(dischargeHashInputFromRow(withPdf))).toBe(
        without.contentHash,
      );
    });

    it('objeto ausente en el storage: intact false', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        verifyRow({ documentId: 'doc-1', pdfSha256: sha }),
      );
      documents.getDecryptedFile.mockRejectedValue(new NotFoundException());
      expect((await service.verify('dis-1', 'therapist-1')).pdf).toEqual({
        present: true,
        intact: false,
      });
    });

    it('fallo de infraestructura: intact null y se registra', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        verifyRow({ documentId: 'doc-1', pdfSha256: sha }),
      );
      documents.getDecryptedFile.mockRejectedValue(new Error('timeout'));
      const errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      expect((await service.verify('dis-1', 'therapist-1')).pdf).toEqual({
        present: true,
        intact: null,
      });
      expect(errorLog).toHaveBeenCalled();
      errorLog.mockRestore();
    });

    it('PDF vinculado sin hash guardado: intact null', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        verifyRow({ documentId: 'doc-1', pdfSha256: null }),
      );
      expect((await service.verify('dis-1', 'therapist-1')).pdf).toEqual({
        present: true,
        intact: null,
      });
      expect(documents.getDecryptedFile).not.toHaveBeenCalled();
    });
  });
});
