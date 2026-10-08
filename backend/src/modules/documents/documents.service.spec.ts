import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { DocumentEncryptionService } from './document-encryption.service';
import { UNPAGINATED_SAFETY_LIMIT } from '../../common/dto/pagination.dto';
import { assertFileContentMatchesMimetype } from '../../common/utils/file-signature.util';
import * as patientDocumentStorage from '../../common/utils/patient-document-storage.util';

jest.mock('../../common/utils/file-signature.util');
jest.mock('../../common/utils/patient-document-storage.util');

const mockAssertFileContentMatchesMimetype =
  assertFileContentMatchesMimetype as jest.MockedFunction<
    typeof assertFileContentMatchesMimetype
  >;
const mockWritePatientDocumentBuffer =
  patientDocumentStorage.writePatientDocumentBuffer as jest.MockedFunction<
    typeof patientDocumentStorage.writePatientDocumentBuffer
  >;
const mockReadPatientDocumentBuffer =
  patientDocumentStorage.readPatientDocumentBuffer as jest.MockedFunction<
    typeof patientDocumentStorage.readPatientDocumentBuffer
  >;

// isPatientDocumentNotFoundError es lógica pura (no I/O) -- se usa la
// implementación real en vez de mockearla, así estos tests siguen probando
// la traducción real de errores de B2 a 404, no un mock que siempre dice lo
// que el test quiere (mismo patrón que shared-files.service.spec.ts).
const { isPatientDocumentNotFoundError } = jest.requireActual<
  typeof patientDocumentStorage
>('../../common/utils/patient-document-storage.util');
(
  patientDocumentStorage.isPatientDocumentNotFoundError as jest.Mock
).mockImplementation(isPatientDocumentNotFoundError);

function buildFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'consentimiento.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%mock'),
    size: 100,
    ...overrides,
  } as Express.Multer.File;
}

/**
 * Issue #131 (review R3-001): uploadDocument() dispara recordConsent()
 * automáticamente para tipos de documento de consentimiento, envuelto en un
 * try/catch que solo loguea si falla -- el upload igual se considera exitoso
 * (fail "cerrado": sin el evento en el ledger, el guardrail de #131 sigue
 * bloqueando el tratamiento).
 *
 * Issue #158: migración de disco local a Backblaze B2 -- los mocks de
 * filesystem se reemplazan por mocks del storage util, mismo patrón que
 * `shared-files.service.spec.ts`.
 */
describe('DocumentsService', () => {
  const ADULT_BIRTH_DATE = new Date('1990-01-01T12:00:00.000Z');
  const GUARDIAN_ID = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';
  // With the system time pinned to 2026-10-08 these are an 11-year-old
  // (UNDER_14) and a 16-year-old (AGE_14_17).
  const MINOR_BIRTH_DATE = new Date('2015-01-01T12:00:00.000Z');
  const TEENAGER_BIRTH_DATE = new Date('2010-01-01T12:00:00.000Z');
  let service: DocumentsService;
  let prisma: {
    patientDocument: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    patientAssent: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let patientsService: {
    assertAccess: jest.Mock;
    recordConsent: jest.Mock;
    assertGuardianCanSign: jest.Mock;
  };
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      patientDocument: {
        create: jest.fn().mockResolvedValue({
          id: 'doc-1',
          patientId: 'patient-1',
        }),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      patientAssent: {
        create: jest.fn().mockResolvedValue({ id: 'assent-1' }),
      },
      // Callback form only: the document and its assent share the tx client.
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    patientsService = {
      assertAccess: jest.fn().mockResolvedValue({
        id: 'patient-1',
        birthDate: ADULT_BIRTH_DATE,
      }),
      recordConsent: jest.fn().mockResolvedValue({ id: 'consent-1' }),
      assertGuardianCanSign: jest.fn().mockResolvedValue(undefined),
    };
    encryption = {
      encrypt: jest.fn().mockReturnValue(Buffer.from('encrypted')),
      decrypt: jest.fn().mockReturnValue(Buffer.from('decrypted')),
    };
    mockAssertFileContentMatchesMimetype.mockImplementation(() => undefined);
    mockWritePatientDocumentBuffer.mockResolvedValue(undefined);

    service = new DocumentsService(
      prisma as unknown as PrismaService,
      patientsService as unknown as PatientsService,
      encryption as unknown as DocumentEncryptionService,
    );
  });

  describe('findByPatient', () => {
    it('acota la lista con el cap de seguridad (issue #290)', async () => {
      prisma.patientDocument.findMany.mockResolvedValue([]);

      await service.findByPatient('patient-1', 'therapist-1');

      expect(patientsService.assertAccess).toHaveBeenCalledWith(
        'patient-1',
        'therapist-1',
      );
      expect(prisma.patientDocument.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { uploadedAt: 'desc' },
        take: UNPAGINATED_SAFETY_LIMIT,
      });
    });
  });

  describe('uploadDocument', () => {
    it('INFORMED_CONSENT: registra el evento GRANT/TREATMENT en el ledger tras subir el documento', async () => {
      await service.uploadDocument(
        'patient-1',
        'therapist-1',
        buildFile(),
        'INFORMED_CONSENT',
      );

      expect(patientsService.recordConsent).toHaveBeenCalledWith(
        'patient-1',
        expect.objectContaining({
          purpose: 'TREATMENT',
          action: 'GRANT',
          evidence: expect.stringContaining('consentimiento.pdf') as unknown,
        }),
        'therapist-1',
        'doc-1',
      );
    });

    it('TELEMED_AGREEMENT: registra el evento GRANT/TELEMEDICINE', async () => {
      await service.uploadDocument(
        'patient-1',
        'therapist-1',
        buildFile({ originalname: 'acuerdo-telemed.pdf' }),
        'TELEMED_AGREEMENT',
      );

      expect(patientsService.recordConsent).toHaveBeenCalledWith(
        'patient-1',
        expect.objectContaining({ purpose: 'TELEMEDICINE', action: 'GRANT' }),
        'therapist-1',
        'doc-1',
      );
    });

    it('INFORMED_ASSENT: NO registra consentimiento automático', async () => {
      await service.uploadDocument(
        'patient-1',
        'therapist-1',
        buildFile({ originalname: 'asentimiento.pdf' }),
        'INFORMED_ASSENT',
      );

      expect(patientsService.recordConsent).not.toHaveBeenCalled();
    });

    it('INFORMED_ASSENT de un adulto: solo guarda el documento, sin asentimiento', async () => {
      await service.uploadDocument(
        'patient-1',
        'therapist-1',
        buildFile(),
        'INFORMED_ASSENT',
      );

      expect(prisma.patientAssent.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('paciente menor de edad (M2b)', () => {
      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-08T15:00:00Z'));
        patientsService.assertAccess.mockResolvedValue({
          id: 'patient-1',
          birthDate: MINOR_BIRTH_DATE,
        });
      });
      afterEach(() => jest.useRealTimers());

      it('INFORMED_CONSENT sin guardianId: 400 antes de guardar el archivo', async () => {
        await expect(
          service.uploadDocument(
            'patient-1',
            'therapist-1',
            buildFile(),
            'INFORMED_CONSENT',
          ),
        ).rejects.toThrow(BadRequestException);

        expect(mockWritePatientDocumentBuffer).not.toHaveBeenCalled();
        expect(prisma.patientDocument.create).not.toHaveBeenCalled();
        expect(patientsService.recordConsent).not.toHaveBeenCalled();
      });

      it('TELEMED_AGREEMENT sin guardianId: 400 antes de guardar el archivo', async () => {
        await expect(
          service.uploadDocument(
            'patient-1',
            'therapist-1',
            buildFile(),
            'TELEMED_AGREEMENT',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(mockWritePatientDocumentBuffer).not.toHaveBeenCalled();
      });

      it('un representante ajeno o sin canConsent: rechaza antes de guardar el archivo', async () => {
        patientsService.assertGuardianCanSign.mockRejectedValue(
          new BadRequestException('no pertenece'),
        );

        await expect(
          service.uploadDocument(
            'patient-1',
            'therapist-1',
            buildFile(),
            'INFORMED_CONSENT',
            undefined,
            GUARDIAN_ID,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(patientsService.assertGuardianCanSign).toHaveBeenCalledWith(
          'patient-1',
          GUARDIAN_ID,
          true,
        );
        expect(mockWritePatientDocumentBuffer).not.toHaveBeenCalled();
      });

      it('INFORMED_CONSENT con guardianId: el GRANT se registra otorgado por el representante', async () => {
        await service.uploadDocument(
          'patient-1',
          'therapist-1',
          buildFile(),
          'INFORMED_CONSENT',
          undefined,
          GUARDIAN_ID,
        );

        expect(patientsService.recordConsent).toHaveBeenCalledWith(
          'patient-1',
          expect.objectContaining({
            purpose: 'TREATMENT',
            action: 'GRANT',
            grantedBy: 'GUARDIAN',
            guardianId: GUARDIAN_ID,
          }),
          'therapist-1',
          'doc-1',
        );
      });

      it('otros tipos de documento no exigen representante', async () => {
        await service.uploadDocument(
          'patient-1',
          'therapist-1',
          buildFile(),
          'OTHER',
        );

        expect(prisma.patientDocument.create).toHaveBeenCalledTimes(1);
        expect(patientsService.assertGuardianCanSign).not.toHaveBeenCalled();
      });

      it('INFORMED_ASSENT (menor de 14): guarda el documento y un asentimiento GRANTED en la misma transaccion', async () => {
        await service.uploadDocument(
          'patient-1',
          'therapist-1',
          buildFile({ originalname: 'asentimiento.pdf' }),
          'INFORMED_ASSENT',
        );

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.patientAssent.create).toHaveBeenCalledWith({
          data: {
            patientId: 'patient-1',
            ageBand: 'UNDER_14',
            action: 'GRANTED',
            documentId: 'doc-1',
            recordedById: 'therapist-1',
          },
        });
        expect(patientsService.recordConsent).not.toHaveBeenCalled();
      });

      it('INFORMED_ASSENT (14 a 17): el tramo se calcula en el servidor', async () => {
        patientsService.assertAccess.mockResolvedValue({
          id: 'patient-1',
          birthDate: TEENAGER_BIRTH_DATE,
        });

        await service.uploadDocument(
          'patient-1',
          'therapist-1',
          buildFile(),
          'INFORMED_ASSENT',
        );

        expect(prisma.patientAssent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ ageBand: 'AGE_14_17' }) as unknown,
        });
      });
    });

    it('adulto con guardianId: lo ignora y el consentimiento queda otorgado por el paciente', async () => {
      await service.uploadDocument(
        'patient-1',
        'therapist-1',
        buildFile(),
        'INFORMED_CONSENT',
        undefined,
        GUARDIAN_ID,
      );

      const dto = (
        patientsService.recordConsent.mock.calls as unknown[][]
      )[0][1] as Record<string, unknown>;
      expect(dto.grantedBy).toBeUndefined();
      expect(dto.guardianId).toBeUndefined();
      expect(patientsService.assertGuardianCanSign).not.toHaveBeenCalled();
    });

    it('OTHER: NO registra consentimiento automático', async () => {
      await service.uploadDocument(
        'patient-1',
        'therapist-1',
        buildFile({ originalname: 'informe.pdf' }),
        'OTHER',
      );

      expect(patientsService.recordConsent).not.toHaveBeenCalled();
    });

    it('review R3-001: si recordConsent() falla, el upload igual se resuelve (fail "cerrado", no revierte el documento)', async () => {
      patientsService.recordConsent.mockRejectedValue(
        new Error('DB caída durante el registro del consentimiento'),
      );

      const result = await service.uploadDocument(
        'patient-1',
        'therapist-1',
        buildFile(),
        'INFORMED_CONSENT',
      );

      // El documento se creó igual -- uploadDocument() no propaga el error
      // de recordConsent(), solo lo loguea.
      expect(result).toEqual(
        expect.objectContaining({ id: 'doc-1', patientId: 'patient-1' }),
      );
      expect(prisma.patientDocument.create).toHaveBeenCalledTimes(1);
    });

    it('valida acceso al paciente antes de subir nada a B2', async () => {
      patientsService.assertAccess.mockRejectedValue(
        new Error('Paciente no encontrado'),
      );

      await expect(
        service.uploadDocument(
          'patient-1',
          'therapist-1',
          buildFile(),
          'INFORMED_CONSENT',
        ),
      ).rejects.toThrow('Paciente no encontrado');
      expect(mockWritePatientDocumentBuffer).not.toHaveBeenCalled();
      expect(prisma.patientDocument.create).not.toHaveBeenCalled();
    });

    it('cifra el buffer con AES-256-GCM antes de subirlo a B2', async () => {
      const file = buildFile();
      await service.uploadDocument('patient-1', 'therapist-1', file, 'OTHER');

      expect(encryption.encrypt).toHaveBeenCalledWith(file.buffer);
      expect(mockWritePatientDocumentBuffer).toHaveBeenCalledWith(
        expect.stringMatching(/\.enc$/) as unknown,
        Buffer.from('encrypted'),
      );
    });
  });

  describe('getDecryptedFile', () => {
    it('descifra el buffer bajado de B2 y lo devuelve junto al documento', async () => {
      const doc = {
        id: 'doc-1',
        patientId: 'patient-1',
        storagePath: 'uuid.pdf.enc',
      };
      prisma.patientDocument.findUnique.mockResolvedValue(doc);
      const encryptedBuffer = Buffer.from('encrypted-from-b2');
      mockReadPatientDocumentBuffer.mockResolvedValue(encryptedBuffer);

      const result = await service.getDecryptedFile('doc-1', 'therapist-1');

      expect(mockReadPatientDocumentBuffer).toHaveBeenCalledWith(
        doc.storagePath,
      );
      expect(encryption.decrypt).toHaveBeenCalledWith(encryptedBuffer);
      expect(result).toEqual({ doc, buffer: Buffer.from('decrypted') });
    });

    // Mismo caso que shared-files/avatares (PR #169/#173): el registro
    // sobrevive en DB pero el objeto detrás en B2 ya no existe (documentos
    // subidos antes de esta migración, perdidos con el disco efímero de
    // Render) -- debe ser 404, no un 500.
    it('lanza 404 si el registro existe en DB pero el objeto no está en B2', async () => {
      const doc = {
        id: 'doc-1',
        patientId: 'patient-1',
        storagePath: 'uuid.pdf.enc',
      };
      prisma.patientDocument.findUnique.mockResolvedValue(doc);
      mockReadPatientDocumentBuffer.mockRejectedValue(
        Object.assign(new Error('not found'), { name: 'NoSuchKey' }),
      );

      await expect(
        service.getDecryptedFile('doc-1', 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('propaga errores de infraestructura que no son "no encontrado"', async () => {
      const doc = {
        id: 'doc-1',
        patientId: 'patient-1',
        storagePath: 'uuid.pdf.enc',
      };
      prisma.patientDocument.findUnique.mockResolvedValue(doc);
      mockReadPatientDocumentBuffer.mockRejectedValue(
        new Error('credenciales inválidas'),
      );

      await expect(
        service.getDecryptedFile('doc-1', 'therapist-1'),
      ).rejects.toThrow('credenciales inválidas');
    });
  });

  describe('voidDocument', () => {
    const dto = { reason: 'Archivo equivocado' };
    let tx: {
      patientDocument: {
        updateMany: jest.Mock;
        findUniqueOrThrow: jest.Mock;
        findFirst: jest.Mock;
      };
      patientConsent: { findFirst: jest.Mock; create: jest.Mock };
    };
    const consentDoc = {
      id: 'doc-1',
      patientId: 'patient-1',
      type: 'INFORMED_CONSENT',
      fileName: 'consentimiento.pdf',
      voidReason: dto.reason,
      voidedAt: new Date(),
    };

    beforeEach(() => {
      tx = {
        patientDocument: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue(consentDoc),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        patientConsent: {
          findFirst: jest.fn(),
          create: jest.fn().mockResolvedValue({ id: 'consent-2' }),
        },
      };
      (prisma as unknown as Record<string, unknown>).$transaction = jest.fn(
        (fn: (t: typeof tx) => unknown) => fn(tx),
      );
      prisma.patientDocument.findUnique.mockResolvedValue({
        ...consentDoc,
        voidedAt: null,
      });
    });

    it('404 si el documento no existe', async () => {
      prisma.patientDocument.findUnique.mockResolvedValue(null);
      await expect(
        service.voidDocument('doc-1', dto, 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('propaga el 404 uniforme de assertAccess y no escribe nada', async () => {
      patientsService.assertAccess.mockRejectedValue(new NotFoundException());
      await expect(
        service.voidDocument('doc-1', dto, 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
      expect(tx.patientDocument.updateMany).not.toHaveBeenCalled();
    });

    it('409 si el documento ya estaba anulado', async () => {
      tx.patientDocument.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.voidDocument('doc-1', dto, 'therapist-1'),
      ).rejects.toThrow(ConflictException);
      expect(tx.patientConsent.create).not.toHaveBeenCalled();
    });

    it('marca voidedAt/voidedById/voidReason', async () => {
      await service.voidDocument('doc-1', dto, 'therapist-1');
      expect(tx.patientDocument.updateMany).toHaveBeenCalledWith({
        where: { id: 'doc-1', voidedAt: null },
        data: {
          voidedAt: expect.any(Date) as unknown,
          voidedById: 'therapist-1',
          voidReason: dto.reason,
        },
      });
    });

    it('tipo sin propósito de consentimiento: no toca el ledger', async () => {
      tx.patientDocument.findUniqueOrThrow.mockResolvedValue({
        ...consentDoc,
        type: 'OTHER',
      });
      await service.voidDocument('doc-1', dto, 'therapist-1');
      expect(tx.patientConsent.findFirst).not.toHaveBeenCalled();
      expect(tx.patientConsent.create).not.toHaveBeenCalled();
    });

    it('queda otro documento vigente del mismo propósito: no escribe REVOKE', async () => {
      tx.patientDocument.findFirst.mockResolvedValue({ id: 'doc-2' });
      await service.voidDocument('doc-1', dto, 'therapist-1');
      expect(tx.patientConsent.create).not.toHaveBeenCalled();
    });

    it('era el único y el último evento es un GRANT de un documento anulado: agrega REVOKE con motivo', async () => {
      tx.patientConsent.findFirst.mockResolvedValue({
        action: 'GRANT',
        documentId: 'doc-1',
        document: { voidedAt: new Date() },
        grantedBy: 'PATIENT',
        guardianId: null,
      });
      await service.voidDocument('doc-1', dto, 'therapist-1');
      expect(tx.patientConsent.create).toHaveBeenCalledWith({
        data: {
          patientId: 'patient-1',
          purpose: 'TREATMENT',
          action: 'REVOKE',
          recordedById: 'therapist-1',
          documentId: 'doc-1',
          grantedBy: 'PATIENT',
          guardianId: null,
          evidence:
            'Documento anulado: consentimiento.pdf (id doc-1). Motivo: Archivo equivocado',
        },
      });
    });

    it('el REVOKE de un consentimiento de menor hereda grantedBy/guardianId del GRANT que revoca (M2b)', async () => {
      tx.patientConsent.findFirst.mockResolvedValue({
        action: 'GRANT',
        documentId: 'doc-1',
        document: { voidedAt: new Date() },
        grantedBy: 'GUARDIAN',
        guardianId: 'guardian-1',
      });
      await service.voidDocument('doc-1', dto, 'therapist-1');
      expect(tx.patientConsent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'REVOKE',
          grantedBy: 'GUARDIAN',
          guardianId: 'guardian-1',
        }) as unknown,
      });
    });

    it('el último evento es un GRANT manual (sin documento): no escribe REVOKE', async () => {
      tx.patientConsent.findFirst.mockResolvedValue({
        action: 'GRANT',
        documentId: null,
        document: null,
      });
      await service.voidDocument('doc-1', dto, 'therapist-1');
      expect(tx.patientConsent.create).not.toHaveBeenCalled();
    });

    it('el último evento ya es un REVOKE: no escribe otro', async () => {
      tx.patientConsent.findFirst.mockResolvedValue({
        action: 'REVOKE',
        documentId: 'doc-1',
        document: { voidedAt: new Date() },
      });
      await service.voidDocument('doc-1', dto, 'therapist-1');
      expect(tx.patientConsent.create).not.toHaveBeenCalled();
    });

    it('el último GRANT depende de un documento aún vigente: no escribe REVOKE', async () => {
      tx.patientConsent.findFirst.mockResolvedValue({
        action: 'GRANT',
        documentId: 'doc-9',
        document: { voidedAt: null },
      });
      await service.voidDocument('doc-1', dto, 'therapist-1');
      expect(tx.patientConsent.create).not.toHaveBeenCalled();
    });
  });
});
