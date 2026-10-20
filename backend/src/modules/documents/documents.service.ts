import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AssentAction,
  ConsentAction,
  ConsentGrantor,
  ConsentPurpose,
  DocumentType,
  Prisma,
  type PatientDocument,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { VoidDocumentDto } from './dto/void-document.dto';
import { DocumentEncryptionService } from './document-encryption.service';
import { UNPAGINATED_SAFETY_LIMIT } from '../../common/dto/pagination.dto';
import { getAgeBand } from '../../common/utils/age.util';
import { assertFileContentMatchesMimetype } from '../../common/utils/file-signature.util';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import {
  readPatientDocumentBuffer,
  writePatientDocumentBuffer,
  deletePatientDocumentObject,
  isPatientDocumentNotFoundError,
} from '../../common/utils/patient-document-storage.util';

// Issue #131: subir uno de estos tipos es la forma válida de consentimiento
// (Art. 1° N°2, Ley 20.584) -- registrarlo también en el ledger PatientConsent
// evita que el terapeuta tenga que hacerlo a mano en un segundo paso.
// INFORMED_ASSENT (asentimiento de un menor) queda fuera a propósito: el
// asentimiento del menor no reemplaza el consentimiento del representante
// legal (Ley 20.584 art. 14; el NNA debe ser informado y oído según los
// arts. 4 y 25 de la Ley 21.331 y la Ley 21.430). Se registra en el ledger
// PatientAssent, nunca como consentimiento. Para un menor, los tipos de
// consentimiento exigen el representante que firma (guardianId).
const CONSENT_DOCUMENT_PURPOSE: Partial<Record<DocumentType, ConsentPurpose>> =
  {
    INFORMED_CONSENT: ConsentPurpose.TREATMENT,
    TELEMED_AGREEMENT: ConsentPurpose.TELEMEDICINE,
  };

const DISCHARGE_REPORT_UPLOAD_MESSAGE =
  'Este tipo de documento solo se genera desde el informe de alta';

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
    guardianId?: string,
  ) {
    // T3: el informe de alta se genera desde el módulo discharges (o lo aporta
    // el terapeuta por su flujo propio), que lo vincula al informe y lo hashea.
    // Subirlo por aquí dejaría un PDF suelto, sin vínculo ni verificación.
    if (type === DocumentType.DISCHARGE_REPORT) {
      throw new BadRequestException(DISCHARGE_REPORT_UPLOAD_MESSAGE);
    }

    // Lanza NotFoundException si el paciente no existe o el usuario no
    // tiene acceso a él -- se valida ANTES de subir nada a B2, así no queda
    // un objeto huérfano que limpiar.
    const patient = await this.patientsService.assertAccess(patientId, userId);

    // M2b: la edad se calcula en el servidor. Para un menor, el documento de
    // consentimiento lo firma su representante: se exige y valida ANTES de
    // guardar el archivo (si no, quedaría un documento sin evento en el
    // ledger). Para un adulto el guardianId se ignora.
    const ageBand = getAgeBand(patient.birthDate);
    const minorAgeBand = ageBand === 'ADULT' ? null : ageBand;
    const purpose = CONSENT_DOCUMENT_PURPOSE[type];
    let consentGuardianId: string | undefined;
    if (purpose && minorAgeBand) {
      if (!guardianId) {
        throw new BadRequestException(
          'El paciente es menor de edad: indica el representante legal que firma el consentimiento.',
        );
      }
      await this.patientsService.assertGuardianCanSign(
        patientId,
        guardianId,
        true,
      );
      consentGuardianId = guardianId;
    }

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

    const createDocument = (client: PrismaService | Prisma.TransactionClient) =>
      client.patientDocument.create({
        data: {
          patientId,
          uploadedBy: userId,
          type,
          fileName: file.originalname,
          storagePath,
          consultationGroupId,
        },
      });
    // El asentimiento de un menor se registra junto con su documento: o
    // quedan ambos o ninguno. Para un adulto solo se guarda el documento.
    let doc: Awaited<ReturnType<typeof createDocument>>;
    try {
      doc =
        type === DocumentType.INFORMED_ASSENT && minorAgeBand
          ? await this.prisma.$transaction(async (tx) => {
              const created = await createDocument(tx);
              await tx.patientAssent.create({
                data: {
                  patientId,
                  ageBand: minorAgeBand,
                  action: AssentAction.GRANTED,
                  documentId: created.id,
                  recordedById: userId,
                },
              });
              return created;
            })
          : await createDocument(this.prisma);
    } catch (err) {
      // Sin fila en la BD el objeto cifrado queda inalcanzable (no se lista,
      // anula ni borra ante una solicitud de eliminación): se descarta, igual
      // que en storeGeneratedDocument.
      try {
        await deletePatientDocumentObject(storagePath);
      } catch (cleanupErr) {
        this.logger.error(
          `No se pudo borrar el objeto huérfano de B2 tras fallar el insert: storagePath=${storagePath}: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`,
        );
      }
      throw err;
    }
    this.logger.log(
      `Documento subido: id=${doc.id} patientId=${patientId} userId=${userId}`,
    );

    if (purpose) {
      try {
        await this.patientsService.recordConsent(
          patientId,
          {
            purpose,
            action: ConsentAction.GRANT,
            evidence: `Documento subido: ${file.originalname} (id ${doc.id})`,
            ...(consentGuardianId && {
              grantedBy: ConsentGrantor.GUARDIAN,
              guardianId: consentGuardianId,
            }),
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

  // T3: guarda un documento generado por el sistema (p. ej. el PDF del informe
  // de alta) con el mismo cifrado y almacenamiento que una subida. No pasa por
  // el fileFilter ni por la validación de mimetype del usuario, y no registra
  // consentimiento. El llamador ya decidió que este usuario puede escribir en
  // la ficha del paciente; igual se revalida el acceso por defensa en
  // profundidad. Si el insert falla tras escribir en B2 se intenta borrar el
  // objeto para no dejar huérfanos.
  async storeGeneratedDocument(input: {
    patientId: string;
    userId: string;
    type: DocumentType;
    fileName: string;
    buffer: Buffer;
    consultationGroupId?: string;
  }): Promise<PatientDocument> {
    await this.patientsService.assertAccess(input.patientId, input.userId);

    const storagePath = `${randomUUID()}${extname(input.fileName)}.enc`;
    const encrypted = this.encryption.encrypt(input.buffer);
    try {
      await writePatientDocumentBuffer(storagePath, encrypted);
    } catch (err) {
      this.logger.error(
        `Fallo al subir documento generado a B2: patientId=${input.patientId} storagePath=${storagePath}: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }

    try {
      const doc = await this.prisma.patientDocument.create({
        data: {
          patientId: input.patientId,
          uploadedBy: input.userId,
          type: input.type,
          fileName: input.fileName,
          storagePath,
          consultationGroupId: input.consultationGroupId,
        },
      });
      this.logger.log(
        `Documento generado: id=${doc.id} type=${input.type} patientId=${input.patientId} userId=${input.userId}`,
      );
      return doc;
    } catch (err) {
      try {
        await deletePatientDocumentObject(storagePath);
      } catch (cleanupErr) {
        this.logger.error(
          `No se pudo borrar el objeto huérfano de B2 tras fallar el insert: storagePath=${storagePath}: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`,
        );
      }
      throw err;
    }
  }

  // T3: descarta un documento generado que quedó sobrante (la carrera de dos
  // generaciones concurrentes del mismo PDF). Solo para DISCHARGE_REPORT y solo
  // si nada lo referencia: la FK Restrict de TreatmentDischarge.documentId
  // hace fallar el delete de uno vigente, y en ese caso el objeto no se toca.
  async discardGeneratedDocument(id: string): Promise<void> {
    const doc = await this.prisma.patientDocument.findUnique({ where: { id } });
    if (!doc) return;
    if (doc.type !== DocumentType.DISCHARGE_REPORT) {
      throw new ConflictException(
        'Solo se puede descartar un documento de informe de alta.',
      );
    }
    await this.prisma.patientDocument.delete({ where: { id } });
    await deletePatientDocumentObject(doc.storagePath);
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
      take: UNPAGINATED_SAFETY_LIMIT,
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
    return this.voidDocumentInternal(id, dto, userId, 'generic');
  }

  // T3: anulación de un PDF de informe de alta (p. ej. al reemplazarlo por una
  // versión nueva, T3b). Solo la invoca el módulo discharges; el endpoint
  // genérico de anulación lo rechaza con 409.
  async voidDischargeDocument(
    id: string,
    dto: VoidDocumentDto,
    userId: string,
  ) {
    return this.voidDocumentInternal(id, dto, userId, 'discharge');
  }

  private async voidDocumentInternal(
    id: string,
    dto: VoidDocumentDto,
    userId: string,
    caller: 'generic' | 'discharge',
  ) {
    const existing = await this.prisma.patientDocument.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Documento no encontrado');

    // Mismo 404 uniforme que el resto del módulo si el documento es ajeno.
    await this.patientsService.assertAccess(existing.patientId, userId);

    const isDischargeReport = existing.type === DocumentType.DISCHARGE_REPORT;
    if (caller === 'generic' && isDischargeReport) {
      throw new ConflictException(
        'El PDF de un informe de alta no se anula desde aquí: corrige el informe para reemplazarlo.',
      );
    }
    if (caller === 'discharge' && !isDischargeReport) {
      throw new ConflictException(
        'Solo se puede anular por esta vía un documento de informe de alta.',
      );
    }

    const voided = await this.prisma.$transaction(async (tx) => {
      // Lock de la fila del paciente (FOR UPDATE) antes de marcar la anulación:
      // revokeConsentIfOrphaned decide con un findFirst "¿queda otro documento
      // vigente?", y en READ COMMITTED dos anulaciones concurrentes de
      // documentos del mismo propósito se ven mutuamente como vigentes y
      // ninguna agrega el REVOKE (queda un GRANT sin revocar). Con el lock la
      // segunda espera, y su findFirst ya ve el voidedAt de la primera. Solo
      // los tipos con propósito de consentimiento lo necesitan.
      if (CONSENT_DOCUMENT_PURPOSE[existing.type]) {
        await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${existing.patientId} FOR UPDATE`;
      }

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
  // El REVOKE hereda grantedBy/guardianId del GRANT que revoca: es el mismo
  // consentimiento (el de un menor lo firmó su representante), así el ledger
  // queda coherente sin una regla aparte.
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
        grantedBy: latest.grantedBy,
        guardianId: latest.guardianId,
        evidence: `Documento anulado: ${doc.fileName} (id ${doc.id}). Motivo: ${doc.voidReason}`,
      },
    });
  }
}
