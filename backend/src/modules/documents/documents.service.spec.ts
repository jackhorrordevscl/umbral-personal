import * as fs from 'fs/promises';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { DocumentEncryptionService } from './document-encryption.service';
import { assertFileContentMatchesMimetype } from '../../common/utils/file-signature.util';

jest.mock('fs/promises');
jest.mock('../../common/utils/file-signature.util');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockAssertFileContentMatchesMimetype =
  assertFileContentMatchesMimetype as jest.MockedFunction<
    typeof assertFileContentMatchesMimetype
  >;

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
 * bloqueando el tratamiento). Este archivo no existía antes de #131; se crea
 * ahora para cubrir esa rama, además del flujo feliz.
 */
describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: {
    patientDocument: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
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
      decrypt: jest.fn(),
    };
    mockAssertFileContentMatchesMimetype.mockImplementation(() => undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

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

    it('valida acceso al paciente antes de escribir nada', async () => {
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
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(prisma.patientDocument.create).not.toHaveBeenCalled();
    });
  });
});
