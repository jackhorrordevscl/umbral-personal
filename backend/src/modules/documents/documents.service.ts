import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConsentAction, ConsentPurpose, DocumentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { DocumentEncryptionService } from './document-encryption.service';
import { assertFileContentMatchesMimetype } from '../../common/utils/file-signature.util';
import * as path from 'path';
import * as fs from 'fs/promises';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'documents');

// Issue #131: subir uno de estos tipos es la forma válida de consentimiento
// (Art. 1° N°2, Ley 20.584) -- registrarlo también en el ledger PatientConsent
// evita que el terapeuta tenga que hacerlo a mano en un segundo paso.
// INFORMED_ASSENT (asentimiento de un menor) queda fuera a propósito: el
// asentimiento del menor no reemplaza el consentimiento del representante
// legal (Art. 25) -- ese flujo no está implementado todavía (ver T4/#131).
const CONSENT_DOCUMENT_PURPOSE: Partial<Record<DocumentType, ConsentPurpose>> =
  {
    INFORMED_CONSENT: ConsentPurpose.TREATMENT,
    TELEMED_AGREEMENT: ConsentPurpose.TELEMEDICINE,
  };

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private patientsService: PatientsService,
    private encryption: DocumentEncryptionService,
  ) {}

  // T8.1 (issue #58): el archivo llega en memoria (memoryStorage en el
  // controller, no diskStorage) para poder cifrarlo con AES-256-GCM antes de
  // que exista cualquier bytes sin cifrar en disco. `storagePath` sigue
  // siendo relativo a `process.cwd()`, igual que antes con diskStorage.
  async uploadDocument(
    patientId: string,
    userId: string,
    file: Express.Multer.File,
    type: DocumentType,
    consultationGroupId?: string,
  ) {
    // Lanza NotFoundException si el paciente no existe o el usuario no
    // tiene acceso a él -- se valida ANTES de escribir nada a disco, así no
    // queda un archivo huérfano que limpiar.
    await this.patientsService.assertAccess(patientId, userId);

    // El `fileFilter` del controller solo mira el header `mimetype`
    // declarado por el cliente (spoofable); esta es la validación real de
    // contenido (issue #51), corre sobre el buffer ya completo.
    assertFileContentMatchesMimetype(file.buffer, file.mimetype);

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const storedName = `${uniqueSuffix}${path.extname(file.originalname)}.enc`;
    const storagePath = path.join('uploads', 'documents', storedName);

    const encrypted = this.encryption.encrypt(file.buffer);
    try {
      await fs.writeFile(path.join(process.cwd(), storagePath), encrypted);
    } catch (err) {
      this.logger.error(
        `Fallo al escribir documento cifrado a disco: patientId=${patientId} storagePath=${storagePath} — ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }

    const doc = await this.prisma.patientDocument.create({
      data: {
        patientId,
        uploadedBy: userId,
        type,
        fileName: file.originalname,
        storagePath,
        consultationGroupId,
      },
    });
    this.logger.log(
      `Documento subido: id=${doc.id} patientId=${patientId} userId=${userId}`,
    );

    const purpose = CONSENT_DOCUMENT_PURPOSE[type];
    if (purpose) {
      try {
        await this.patientsService.recordConsent(
          patientId,
          {
            purpose,
            action: ConsentAction.GRANT,
            evidence: `Documento subido: ${file.originalname} (id ${doc.id})`,
          },
          userId,
        );
      } catch (err) {
        // No revertimos el documento ya subido -- si esto falla, el
        // paciente queda igual que antes de este cambio (sin evento en el
        // ledger), y el guardrail de #131 sigue bloqueando el tratamiento
        // hasta que se resuelva. Fallar "cerrado", no "abierto".
        this.logger.error(
          `Fallo al registrar consentimiento automático: documentId=${doc.id} patientId=${patientId} — ${err instanceof Error ? err.message : err}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    return doc;
  }

  // Devuelve el contenido ya descifrado, listo para servir. La validación de
  // acceso ya la hace `getDocument` (vía `patientsService.findOne`).
  async getDecryptedFile(id: string, userId: string) {
    const doc = await this.getDocument(id, userId);
    try {
      const encrypted = await fs.readFile(
        path.join(process.cwd(), doc.storagePath),
      );
      return { doc, buffer: this.encryption.decrypt(encrypted) };
    } catch (err) {
      this.logger.error(
        `Fallo al leer/descifrar documento: id=${id} storagePath=${doc.storagePath} — ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  async findByPatient(patientId: string, userId: string) {
    // Lanza NotFoundException si el usuario no tiene acceso a este paciente
    await this.patientsService.assertAccess(patientId, userId);

    return this.prisma.patientDocument.findMany({
      where: { patientId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async getDocument(id: string, userId: string) {
    const doc = await this.prisma.patientDocument.findUnique({
      where: { id },
    });

    if (!doc) throw new NotFoundException('Documento no encontrado');

    // Lanza NotFoundException si el usuario no tiene acceso al paciente dueño del documento
    await this.patientsService.assertAccess(doc.patientId, userId);

    return doc;
  }
}
