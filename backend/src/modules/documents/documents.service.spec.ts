import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { DocumentEncryptionService } from './document-encryption.service';
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
  let service: DocumentsService;
  let prisma: {
    patientDocument: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let patientsService: {
    assertAccess: jest.Mock;
    recordConsent: jest.Mock;
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
    };
    patientsService = {
      assertAccess: jest.fn().mockResolvedValue({ id: 'patient-1' }),
      recordConsent: jest.fn().mockResolvedValue({ id: 'consent-1' }),
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
      );
    });

    it('INFORMED_ASSENT: NO registra consentimiento automático (Art. 25)', async () => {
      await service.uploadDocument(
        'patient-1',
        'therapist-1',
        buildFile({ originalname: 'asentimiento.pdf' }),
        'INFORMED_ASSENT',
      );

      expect(patientsService.recordConsent).not.toHaveBeenCalled();
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
});
