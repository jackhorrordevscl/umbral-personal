import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ConsentAction,
  ConsentPurpose,
  DocumentType,
  Prisma,
  type PatientDocument,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { VoidDocumentDto } from './dto/void-document.dto';
import { DocumentEncryptionService } from './document-encryption.service';
import { assertFileContentMatchesMimetype } from '../../common/utils/file-signature.util';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import {
  readPatientDocumentBuffer,
  writePatientDocumentBuffer,
  isPatientDocumentNotFoundError,
} from '../../common/utils/patient-document-storage.util';

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

  // Issue #158: el archivo llega en memoria (memoryStorage en el
  // controller, no diskStorage) para poder cifrarlo con AES-256-GCM antes de
  // que exista cualquier byte sin cifrar. El cifrado se sube directo a B2 --
  // ya no toca disco local en ningún punto (mismo problema de disco efímero
  // de Render que #170 resolvió para avatares/shared-files, `documents`
  // había quedado fuera de ese alcance). `storagePath` se reusa como
  // objectKey de B2, sin cambio de schema.
  async uploadDocument(
    patientId: string,
    userId: string,
    file: Express.Multer.File,
    type: DocumentType,
    consultationGroupId?: string,
  ) {
    // Lanza NotFoundException si el paciente no existe o el usuario no
    // tiene acceso a él -- se valida ANTES de subir nada a B2, así no queda
    // un objeto huérfano que limpiar.
    await this.patientsService.assertAccess(patientId, userId);

    // El `fileFilter` del controller solo mira el header `mimetype`
    // declarado por el cliente (spoofable); esta es la validación real de
    // contenido (issue #51), corre sobre el buffer ya completo.
    assertFileContentMatchesMimetype(file.buffer, file.mimetype);

    const storagePath = `${randomUUID()}${extname(file.originalname)}.enc`;
    const encrypted = this.encryption.encrypt(file.buffer);
    try {
      await writePatientDocumentBuffer(storagePath, encrypted);
    } catch (err) {
      this.logger.error(
        `Fallo al subir documento cifrado a B2: patientId=${patientId} storagePath=${storagePath} — ${err instanceof Error ? err.message : err}`,
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
          doc.id,
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
    let encrypted: Buffer;
    try {
      encrypted = await readPatientDocumentBuffer(doc.storagePath);
    } catch (err) {
      // El registro en DB puede sobrevivir aunque el objeto en B2 ya no
      // exista (documentos subidos antes de esta migración, perdidos con el
      // disco efímero de Render -- no hay backfill posible, mismo criterio
      // que shared-files/avatares). Se trata como 404, no como 500.
      if (isPatientDocumentNotFoundError(err)) {
        throw new NotFoundException(
          'Documento físico no encontrado en el servidor',
        );
      }
      this.logger.error(
        `Fallo al leer documento desde B2: id=${id} storagePath=${doc.storagePath} — ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }

    return { doc, buffer: this.encryption.decrypt(encrypted) };
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

  // Issue #270: anulación con motivo obligatorio, sin borrado físico (custodia
  // de 15 años, Ley 20.584). El objeto cifrado en B2 no se toca y la descarga
  // sigue permitida. Todo ocurre en una transacción: la marca de anulación y
  // el eventual REVOKE del ledger se confirman juntos o no se confirma nada.
  async voidDocument(id: string, dto: VoidDocumentDto, userId: string) {
    const existing = await this.prisma.patientDocument.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Documento no encontrado');

    // Mismo 404 uniforme que el resto del módulo si el documento es ajeno.
    await this.patientsService.assertAccess(existing.patientId, userId);

    const voided = await this.prisma.$transaction(async (tx) => {
      // Condición en el WHERE: dos anulaciones concurrentes no pueden pasar
      // ambas; la segunda ve count 0 y recibe 409.
      const { count } = await tx.patientDocument.updateMany({
        where: { id, voidedAt: null },
        data: {
          voidedAt: new Date(),
          voidedById: userId,
          voidReason: dto.reason,
        },
      });
      if (count === 0) {
        throw new ConflictException('El documento ya está anulado.');
      }

      const doc = await tx.patientDocument.findUniqueOrThrow({
        where: { id },
      });
      const purpose = CONSENT_DOCUMENT_PURPOSE[doc.type];
      if (purpose) {
        await this.revokeConsentIfOrphaned(tx, doc, purpose, userId);
      }
      return doc;
    });

    this.logger.log(
      `Documento anulado: id=${id} patientId=${voided.patientId} userId=${userId}`,
    );
    return voided;
  }

  // Agrega un REVOKE solo cuando el consentimiento vigente depende de un
  // documento anulado y no queda otro documento vigente del mismo propósito.
  // Un GRANT manual/en bloque (documentId null) o un REVOKE previo no se tocan.
  private async revokeConsentIfOrphaned(
    tx: Prisma.TransactionClient,
    doc: PatientDocument,
    purpose: ConsentPurpose,
    userId: string,
  ) {
    const typesForPurpose = (
      Object.keys(CONSENT_DOCUMENT_PURPOSE) as DocumentType[]
    ).filter((t) => CONSENT_DOCUMENT_PURPOSE[t] === purpose);

    const otherActive = await tx.patientDocument.findFirst({
      where: {
        patientId: doc.patientId,
        type: { in: typesForPurpose },
        voidedAt: null,
        id: { not: doc.id },
      },
      select: { id: true },
    });
    if (otherActive) return;

    const latest = await tx.patientConsent.findFirst({
      where: { patientId: doc.patientId, purpose },
      orderBy: { recordedAt: 'desc' },
      include: { document: { select: { voidedAt: true } } },
    });
    if (
      !latest ||
      latest.action !== ConsentAction.GRANT ||
      !latest.document?.voidedAt
    ) {
      return;
    }

    await tx.patientConsent.create({
      data: {
        patientId: doc.patientId,
        purpose,
        action: ConsentAction.REVOKE,
        recordedById: userId,
        documentId: doc.id,
        evidence: `Documento anulado: ${doc.fileName} (id ${doc.id}). Motivo: ${doc.voidReason}`,
      },
    });
  }
}
