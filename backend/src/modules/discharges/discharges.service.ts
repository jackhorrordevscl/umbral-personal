import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma, TreatmentDischarge } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from '../availability/availability.service';
import { PaymentsService } from '../payments/payments.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { DocumentsService } from '../documents/documents.service';
import { isMinor } from '../../common/utils/age.util';
import { logAuditFailOpen } from '../../common/utils/audit-fail-open.util';
import {
  chileDayKeyFromInstant,
  dateOnlyDayKey,
} from '../../common/utils/chile-time.util';
import { CreateDischargeDto } from './dto/create-discharge.dto';
import { UploadDischargeDto } from './dto/upload-discharge.dto';
import { validateUploadedPdf } from './util/uploaded-pdf.util';
import { UpdateDischargeDto } from './dto/update-discharge.dto';
import { assertClosureRules } from './util/closure-rules.util';
import {
  computeDischargeHash,
  dischargeHashInputFromRow,
  hashesMatch,
} from './util/discharge-hash.util';
import { buildDischargePdf } from './pdf/discharge-pdf.builder';

// Contexto de la request para la auditoría explícita de issue/correct (esos
// handlers llevan @SkipAudit para no duplicar la fila del interceptor).
export interface DischargeRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface DischargeVerification {
  valid: boolean;
  dischargeId: string;
  groupId: string;
  version: number;
  status: 'ISSUED';
  issuedAt: Date | null;
  contentHash: string | null;
  // false si ya existe una corrección posterior (esta versión fue superada).
  isCurrent: boolean;
  // T3: estado del PDF guardado. Campo aditivo; nunca expone contenido.
  // present: el informe tiene un PDF vinculado. intact: sus bytes descifrados
  // coinciden con pdfSha256 (null si no hay PDF, no hay hash guardado o no se
  // pudo leer por un fallo de infraestructura; false si el objeto no existe o
  // no coincide).
  pdf: { present: boolean; intact: boolean | null };
  // T3b: origen del informe. UPLOADED = documento aportado por el terapeuta
  // (la UI debe decir eso y nunca "firmado por el sistema"); en ese caso
  // `valid` compara el SHA-256 de los bytes del archivo con contentHash.
  source: 'GENERATED' | 'UPLOADED';
  providedByTherapist: boolean;
}

// Descarga del PDF ya descifrado, lista para servir.
export interface DischargePdfFile {
  buffer: Buffer;
  fileName: string;
  patientId: string;
}

// Respuesta de issue: el informe más el número de consultas futuras que el
// cierre canceló (campo aditivo, no rompe a los clientes existentes).
export type DischargeIssueResult = TreatmentDischarge & {
  cancelledConsultations: number;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const NO_CONSENT_MESSAGE =
  'El paciente no tiene un consentimiento informado vigente. Registra el consentimiento antes de emitir el informe de alta.';

function toDateOnly(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

@Injectable()
export class DischargesService {
  private readonly logger = new Logger(DischargesService.name);

  constructor(
    private prisma: PrismaService,
    private patientsService: PatientsService,
    private auditService: AuditService,
    private availabilityService: AvailabilityService,
    private paymentsService: PaymentsService,
    private calendarSync: CalendarSyncService,
    private documentsService: DocumentsService,
  ) {}

  // POST /patients/:patientId/discharges
  async createDraft(
    patientId: string,
    dto: CreateDischargeDto,
    therapistId: string,
  ): Promise<TreatmentDischarge> {
    // Mismo 404 uniforme para paciente inexistente, ajeno o dado de baja.
    await this.patientsService.assertAccess(patientId, therapistId);

    const closure = {
      closureReason: dto.closureReason,
      dropoutReason: dto.dropoutReason ?? null,
      dropoutNote: dto.dropoutNote ?? null,
      referralDestination: dto.referralDestination ?? null,
    };
    assertClosureRules(closure);

    // Atómico: la comprobación de estado y de borrador abierto y el create van
    // bajo los mismos locks que issue() (User y luego Patient). Sin esto, dos
    // POST concurrentes pasan ambos la comprobación y crean dos borradores v1.
    return this.prisma.$transaction(async (tx) => {
      await this.lockTherapistAndPatient(tx, therapistId, patientId);

      const patient = await tx.patient.findFirst({
        where: { id: patientId, therapistId, deletedAt: null },
        select: { treatmentStatus: true },
      });
      if (!patient) throw new NotFoundException('Paciente no encontrado');
      if (patient.treatmentStatus !== 'ACTIVE') {
        throw new ConflictException(
          'El tratamiento de este paciente ya está cerrado. Corrige el informe vigente en vez de crear uno nuevo.',
        );
      }

      const openDraft = await tx.treatmentDischarge.findFirst({
        where: { patientId, therapistId, status: 'DRAFT', correctsId: null },
        select: { id: true },
      });
      if (openDraft) {
        throw new ConflictException(
          'Este paciente ya tiene un borrador de informe de alta. Edítalo o emítelo.',
        );
      }

      const { sessionCount, admissionDay, today } =
        await this.prefillFromSessions(tx, patientId, therapistId);

      const id = randomUUID();
      return tx.treatmentDischarge.create({
        data: {
          id,
          groupId: id,
          version: 1,
          patientId,
          therapistId,
          ...closure,
          admissionDate: toDateOnly(admissionDay),
          dischargeDate: toDateOnly(today),
          sessionCount,
        },
      });
    });
  }

  // Prellenado: SOLO recuentos y fechas derivados de las consultas vigentes y
  // ya realizadas. Nunca se copian notas clínicas al informe (minimización).
  private async prefillFromSessions(
    tx: Prisma.TransactionClient,
    patientId: string,
    therapistId: string,
  ): Promise<{ sessionCount: number; admissionDay: string; today: string }> {
    const now = new Date();
    const held: Prisma.ConsultationWhereInput = {
      patientId,
      therapistId,
      correctedBy: null,
      deletedAt: null,
      cancelledAt: null,
      sessionDate: { lte: now },
    };
    const [sessionCount, first] = await Promise.all([
      tx.consultation.count({ where: held }),
      tx.consultation.findFirst({
        where: held,
        orderBy: { sessionDate: 'asc' },
        select: { sessionDate: true },
      }),
    ]);

    const today = chileDayKeyFromInstant(now);
    const admissionDay = first
      ? chileDayKeyFromInstant(first.sessionDate)
      : today;
    return { sessionCount, admissionDay, today };
  }

  // Orden de locks compartido con ConsultationsService (lockTherapistSchedule y
  // createFromPublicBooking): siempre User ANTES que Patient. Tomar el lock del
  // terapeuta serializa estas escrituras con create(), la reprogramación
  // (correct) y la reserva pública, que deciden o alteran su agenda con ese
  // mismo lock. PatientsService.softDelete solo toma Patient FOR UPDATE, así
  // que no puede cerrar un ciclo. Ambos locks se mantienen hasta el commit.
  private async lockTherapistAndPatient(
    tx: Prisma.TransactionClient,
    therapistId: string,
    patientId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${therapistId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${patientId} FOR UPDATE`;
  }

  // PATCH /discharges/:id (solo borrador y solo el terapeuta dueño)
  async update(
    id: string,
    dto: UpdateDischargeDto,
    therapistId: string,
  ): Promise<TreatmentDischarge> {
    const current = await this.findOwned(id, therapistId);
    if (current.status !== 'DRAFT') {
      throw new ConflictException(
        'El informe ya fue emitido y no se puede editar. Crea una corrección.',
      );
    }

    // `undefined` = no tocar; `null` = limpiar (solo campos nullable, el DTO
    // ya rechaza null en los textos obligatorios).
    const data: Prisma.TreatmentDischargeUpdateManyMutationInput = {};
    if (dto.closureReason !== undefined) data.closureReason = dto.closureReason;
    if (dto.dropoutReason !== undefined) data.dropoutReason = dto.dropoutReason;
    if (dto.dropoutNote !== undefined) data.dropoutNote = dto.dropoutNote;
    if (dto.referralDestination !== undefined) {
      data.referralDestination = dto.referralDestination;
    }
    if (dto.admissionDate !== undefined) {
      data.admissionDate = toDateOnly(dto.admissionDate);
    }
    if (dto.dischargeDate !== undefined) {
      data.dischargeDate = toDateOnly(dto.dischargeDate);
    }
    if (dto.sessionCount !== undefined) data.sessionCount = dto.sessionCount;
    if (dto.consultReason !== undefined) data.consultReason = dto.consultReason;
    if (dto.diagnosis !== undefined) data.diagnosis = dto.diagnosis;
    if (dto.evolutionSummary !== undefined) {
      data.evolutionSummary = dto.evolutionSummary;
    }
    if (dto.statusAtDischarge !== undefined) {
      data.statusAtDischarge = dto.statusAtDischarge;
    }
    if (dto.recommendations !== undefined) {
      data.recommendations = dto.recommendations;
    }

    // Reglas cruzadas sobre el estado resultante, no solo sobre el PATCH.
    const merged = { ...current, ...data } as TreatmentDischarge;
    assertClosureRules(merged);
    this.assertDates(merged);

    // Condicional a DRAFT: si una emisión concurrente ganó, count = 0 -> 409.
    const result = await this.prisma.treatmentDischarge.updateMany({
      where: { id, therapistId, status: 'DRAFT' },
      data,
    });
    if (result.count === 0) {
      throw new ConflictException(
        'El informe ya fue emitido y no se puede editar. Crea una corrección.',
      );
    }
    return this.findOwned(id, therapistId);
  }

  // POST /discharges/:id/issue
  async issue(
    id: string,
    therapistId: string,
    ctx: DischargeRequestContext = {},
  ): Promise<DischargeIssueResult> {
    const draft = await this.findOwned(id, therapistId);

    const result = await this.prisma.$transaction(async (tx) => {
      // Locks User y luego Patient (orden documentado en
      // ConsultationsService.lockTherapistSchedule). El lock del terapeuta
      // serializa el cierre con create() y la reprogramación de consultas, que
      // lo toman antes de escribir en su agenda: sin él, una edición concurrente
      // crea una versión nueva que el cierre no ve y queda viva en un paciente
      // cerrado. El lock del paciente serializa además con la baja, otra
      // emisión y la reserva pública.
      await this.lockTherapistAndPatient(tx, therapistId, draft.patientId);

      const patient = await tx.patient.findFirst({
        where: { id: draft.patientId, therapistId, deletedAt: null },
        select: { id: true, treatmentStatus: true },
      });
      if (!patient) throw new NotFoundException('Paciente no encontrado');

      // Releer bajo el lock: el estado pudo cambiar desde la lectura previa.
      const fresh = await tx.treatmentDischarge.findFirst({
        where: { id, therapistId },
      });
      if (!fresh) throw new NotFoundException('Informe no encontrado');
      if (fresh.status !== 'DRAFT') {
        throw new ConflictException('El informe ya fue emitido.');
      }
      // Un informe nuevo (no corrección) solo cierra un tratamiento activo. Si
      // el paciente ya está cerrado, o fue cerrado y reabierto, emitirlo
      // pisaría ese estado y cancelaría sus consultas vigentes.
      if (fresh.correctsId === null && patient.treatmentStatus !== 'ACTIVE') {
        throw new ConflictException(
          'El tratamiento de este paciente ya está cerrado. Corrige el informe vigente en vez de emitir uno nuevo.',
        );
      }

      await this.patientsService.assertTreatmentConsent(
        fresh.patientId,
        NO_CONSENT_MESSAGE,
        tx,
      );

      assertClosureRules(fresh);
      this.assertDates(fresh);
      this.assertContentComplete(fresh);

      const signer = await tx.user.findUnique({
        where: { id: therapistId },
        select: { name: true, rut: true, professionalRegistration: true },
      });
      // El RUT del firmante es obligatorio para un informe GENERATED. El informe
      // subido (UPLOADED, T3b) nace emitido por uploadReport y no pasa por aquí
      // ni exige RUT. El registro profesional es siempre opcional.
      if (fresh.source === 'GENERATED' && !signer?.rut) {
        throw new BadRequestException(
          'Completa tu RUT en tu perfil antes de emitir un informe de alta.',
        );
      }
      const issuedAt = new Date();
      const signed = {
        ...fresh,
        issuedAt,
        // Snapshot del firmante al emitir: entra al hash canónico, así que un
        // cambio posterior en el perfil no altera el informe ya emitido.
        signerName: signer?.name ?? null,
        signerRut: signer?.rut ?? null,
        signerProfessionalRegistration:
          signer?.professionalRegistration ?? null,
      };
      const contentHash = computeDischargeHash(
        dischargeHashInputFromRow(signed),
      );

      // Transición condicional: dos emisiones concurrentes no pueden ganar a la vez.
      const updated = await tx.treatmentDischarge.updateMany({
        where: { id, therapistId, status: 'DRAFT' },
        data: {
          status: 'ISSUED',
          issuedAt,
          contentHash,
          signerName: signed.signerName,
          signerRut: signed.signerRut,
          signerProfessionalRegistration: signed.signerProfessionalRegistration,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('El informe ya fue emitido.');
      }

      const row = await tx.treatmentDischarge.findUniqueOrThrow({
        where: { id },
      });
      const cancelledGroupIds = await this.applyClosureInTransaction(
        tx,
        row,
        patient.treatmentStatus,
      );
      return { row, cancelledGroupIds };
    });
    const { row: issued, cancelledGroupIds } = result;

    // Auditoría explícita tras el commit. Fail-open, igual que el interceptor
    // global: la emisión ya es definitiva y un fallo del log no debe revertirla
    // ni devolverle un 500 al terapeuta; el fallo queda en logger.error.
    await logAuditFailOpen(this.auditService, this.logger, {
      userId: therapistId,
      action: 'DISCHARGE_ISSUE',
      resource: 'Discharge',
      resourceId: issued.id,
      detail: `patientId=${issued.patientId} groupId=${issued.groupId} version=${issued.version} contentHash=${issued.contentHash}`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    await this.auditClosure(issued, cancelledGroupIds, therapistId, ctx);

    await this.runPostCommitEffects(therapistId, cancelledGroupIds);

    // PDF en modo mejor esfuerzo: la emisión ya es definitiva y un fallo de
    // generación o de storage no la revierte ni la bloquea. Si falla, el primer
    // GET /pdf lo genera (ensurePdf es idempotente).
    const withPdf = await this.ensurePdf(issued.id, therapistId).catch(
      (err: unknown) => {
        this.logger.error(
          `Fallo al generar el PDF del informe tras la emisión (dischargeId=${issued.id}): ${errorMessage(err)}`,
        );
        return null;
      },
    );

    return {
      ...issued,
      documentId: withPdf?.documentId ?? issued.documentId,
      pdfSha256: withPdf?.pdfSha256 ?? issued.pdfSha256,
      cancelledConsultations: cancelledGroupIds.length,
    };
  }

  // Auditoría de los efectos del cierre (TREATMENT_CLOSED y una fila por
  // consulta cancelada). Fail-open, como el resto de la auditoría explícita.
  private async auditClosure(
    issued: TreatmentDischarge,
    cancelledGroupIds: string[],
    therapistId: string,
    ctx: DischargeRequestContext,
  ): Promise<void> {
    await logAuditFailOpen(this.auditService, this.logger, {
      userId: therapistId,
      action: 'TREATMENT_CLOSED',
      resource: 'Patient',
      resourceId: issued.patientId,
      // Sin dropoutNote ni destino de derivación: son texto libre del terapeuta.
      detail: `status=${issued.closureReason}${issued.dropoutReason ? ` dropoutReason=${issued.dropoutReason}` : ''} dischargeId=${issued.id} cancelledConsultations=${cancelledGroupIds.length}`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    // Una fila por consulta cancelada. El detail lleva el estado de cierre y el
    // id del informe, nunca el motivo de deserción ni texto libre: la fila se
    // lee desde la ficha de la consulta, no desde el informe.
    for (const groupId of cancelledGroupIds) {
      await logAuditFailOpen(this.auditService, this.logger, {
        userId: therapistId,
        action: 'CONSULTATION_CANCELLED',
        resource: 'Consultation',
        resourceId: groupId,
        detail: `status=${issued.closureReason} dischargeId=${issued.id}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }
  }

  // ---- T3b: informe aportado por el terapeuta (PDF propio) ----

  // Campos del cierre de una subida, con las mismas reglas que el borrador
  // (T2c). Las normaliza (undefined -> null) y las valida.
  private closureFromUpload(dto: UploadDischargeDto) {
    const closure = {
      closureReason: dto.closureReason,
      dropoutReason: dto.dropoutReason ?? null,
      dropoutNote: dto.dropoutNote ?? null,
      referralDestination: dto.referralDestination ?? null,
    };
    assertClosureRules(closure);
    if (
      dto.dischargeDate &&
      dto.dischargeDate > chileDayKeyFromInstant(new Date())
    ) {
      throw new BadRequestException('La fecha de alta no puede ser futura.');
    }
    return closure;
  }

  // POST /patients/:patientId/discharges/upload
  //
  // El informe subido nace directamente ISSUED (no hay borrador) con
  // source = UPLOADED. El PDF no se interpreta ni se renderiza: solo se valida,
  // se cifra y se guarda. Orden: validar -> guardar el documento -> transacción
  // de cierre; si la transacción falla se descarta el documento huérfano.
  //
  // contentHash = pdfSha256 = SHA-256 de los bytes subidos. NO es el hash
  // canónico de un informe GENERATED (que cubre los campos del informe): aquí
  // el contenido es el propio archivo, y el hash prueba su integridad en
  // reposo, no una firma del sistema.
  async uploadReport(
    patientId: string,
    dto: UploadDischargeDto,
    file: Express.Multer.File | undefined,
    therapistId: string,
    ctx: DischargeRequestContext = {},
  ): Promise<DischargeIssueResult> {
    const closure = this.closureFromUpload(dto);
    const pdf = validateUploadedPdf(file);
    // Mismo 404 uniforme para paciente inexistente, ajeno o dado de baja.
    await this.patientsService.assertAccess(patientId, therapistId);

    const stored = await this.documentsService.storeGeneratedDocument({
      patientId,
      userId: therapistId,
      type: 'DISCHARGE_REPORT',
      fileName: pdf.fileName,
      buffer: pdf.buffer,
    });

    let result: { row: TreatmentDischarge; cancelledGroupIds: string[] };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await this.lockTherapistAndPatient(tx, therapistId, patientId);

        const patient = await tx.patient.findFirst({
          where: { id: patientId, therapistId, deletedAt: null },
          select: { id: true, treatmentStatus: true },
        });
        if (!patient) throw new NotFoundException('Paciente no encontrado');
        // Un informe nuevo solo cierra un tratamiento activo. Dos subidas
        // concurrentes: la segunda ve el estado ya cerrado bajo el lock.
        if (patient.treatmentStatus !== 'ACTIVE') {
          throw new ConflictException(
            'El tratamiento de este paciente ya está cerrado. Corrige el informe vigente en vez de subir uno nuevo.',
          );
        }
        await this.patientsService.assertTreatmentConsent(
          patientId,
          NO_CONSENT_MESSAGE,
          tx,
        );

        const { sessionCount, admissionDay, today } =
          await this.prefillFromSessions(tx, patientId, therapistId);
        const admissionDate = toDateOnly(admissionDay);
        const dischargeDate = toDateOnly(dto.dischargeDate ?? today);
        this.assertDates({ admissionDate, dischargeDate });

        const signer = await this.signerSnapshot(tx, therapistId);
        const id = randomUUID();
        const row = await tx.treatmentDischarge.create({
          data: {
            id,
            groupId: id,
            version: 1,
            patientId,
            therapistId,
            source: 'UPLOADED',
            status: 'ISSUED',
            ...closure,
            admissionDate,
            dischargeDate,
            sessionCount,
            ...signer,
            issuedAt: new Date(),
            contentHash: pdf.sha256,
            pdfSha256: pdf.sha256,
            documentId: stored.id,
          },
        });
        const cancelledGroupIds = await this.applyClosureInTransaction(
          tx,
          row,
          patient.treatmentStatus,
        );
        return { row, cancelledGroupIds };
      });
    } catch (err) {
      await this.discardSurplusDocument(stored.id);
      throw err;
    }

    await this.auditUploaded(
      result.row,
      result.cancelledGroupIds,
      therapistId,
      ctx,
      {
        closureApplied: true,
      },
    );
    await this.runPostCommitEffects(therapistId, result.cancelledGroupIds);

    return {
      ...result.row,
      cancelledConsultations: result.cancelledGroupIds.length,
    };
  }

  // POST /discharges/:id/correct-upload
  //
  // Reemplazo versionado de un informe UPLOADED vigente: crea la versión
  // siguiente ya emitida (mismo groupId, correctsId = anterior) con el PDF
  // nuevo y anula el documento de la versión anterior. Un informe GENERATED se
  // corrige con /correct. Con el paciente ya reabierto la corrección se
  // registra sin tocar su estado ni sus consultas (applyClosureInTransaction).
  async correctUpload(
    id: string,
    dto: UploadDischargeDto,
    file: Express.Multer.File | undefined,
    therapistId: string,
    ctx: DischargeRequestContext = {},
  ): Promise<DischargeIssueResult> {
    const closure = this.closureFromUpload(dto);
    const pdf = validateUploadedPdf(file);

    const original = await this.findOwned(id, therapistId);
    this.assertCorrectableUpload(original);
    const alreadyCorrected = await this.prisma.treatmentDischarge.findFirst({
      where: { correctsId: id },
      select: { id: true },
    });
    if (alreadyCorrected) throw this.alreadyCorrectedError();

    const stored = await this.documentsService.storeGeneratedDocument({
      patientId: original.patientId,
      userId: therapistId,
      type: 'DISCHARGE_REPORT',
      fileName: pdf.fileName,
      buffer: pdf.buffer,
    });

    let result: {
      row: TreatmentDischarge;
      cancelledGroupIds: string[];
      closureApplied: boolean;
    };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await this.lockTherapistAndPatient(tx, therapistId, original.patientId);

        const patient = await tx.patient.findFirst({
          where: { id: original.patientId, therapistId, deletedAt: null },
          select: { id: true, treatmentStatus: true },
        });
        if (!patient) throw new NotFoundException('Paciente no encontrado');

        // Releer bajo el lock: la versión pudo corregirse o cambiar.
        const fresh = await tx.treatmentDischarge.findFirst({
          where: { id, therapistId },
        });
        if (!fresh) throw new NotFoundException('Informe no encontrado');
        this.assertCorrectableUpload(fresh);
        const taken = await tx.treatmentDischarge.findFirst({
          where: { correctsId: id },
          select: { id: true },
        });
        if (taken) throw this.alreadyCorrectedError();

        await this.patientsService.assertTreatmentConsent(
          fresh.patientId,
          NO_CONSENT_MESSAGE,
          tx,
        );

        const dischargeDate = dto.dischargeDate
          ? toDateOnly(dto.dischargeDate)
          : fresh.dischargeDate;
        this.assertDates({
          admissionDate: fresh.admissionDate,
          dischargeDate,
        });

        const signer = await this.signerSnapshot(tx, therapistId);
        const row = await tx.treatmentDischarge.create({
          data: {
            id: randomUUID(),
            groupId: fresh.groupId,
            version: fresh.version + 1,
            correctsId: fresh.id,
            patientId: fresh.patientId,
            therapistId,
            source: 'UPLOADED',
            status: 'ISSUED',
            ...closure,
            admissionDate: fresh.admissionDate,
            dischargeDate,
            sessionCount: fresh.sessionCount,
            ...signer,
            issuedAt: new Date(),
            contentHash: pdf.sha256,
            pdfSha256: pdf.sha256,
            documentId: stored.id,
          },
        });
        const cancelledGroupIds = await this.applyClosureInTransaction(
          tx,
          row,
          patient.treatmentStatus,
        );
        return {
          row,
          cancelledGroupIds,
          // Con el paciente reabierto la corrección es solo un registro.
          closureApplied: patient.treatmentStatus !== 'ACTIVE',
        };
      });
    } catch (err) {
      await this.discardSurplusDocument(stored.id);
      // Dos correcciones concurrentes: el @unique de correctsId deja pasar una.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw this.alreadyCorrectedError();
      }
      throw err;
    }

    // El documento anterior queda anulado (sin borrado físico). Tras el commit
    // y en mejor esfuerzo: la nueva versión ya es definitiva y un fallo aquí
    // solo se registra; la versión anterior igual figura como superada.
    if (original.documentId) {
      try {
        await this.documentsService.voidDischargeDocument(
          original.documentId,
          { reason: 'Reemplazado por una nueva versión del informe' },
          therapistId,
        );
      } catch (err) {
        this.logger.error(
          `No se pudo anular el PDF reemplazado (dischargeId=${original.id}, documentId=${original.documentId}): ${errorMessage(err)}`,
        );
      }
    }

    await this.auditUploaded(
      result.row,
      result.cancelledGroupIds,
      therapistId,
      ctx,
      { closureApplied: result.closureApplied, correctsId: original.id },
    );
    await this.runPostCommitEffects(therapistId, result.cancelledGroupIds);

    return {
      ...result.row,
      cancelledConsultations: result.cancelledGroupIds.length,
    };
  }

  private assertCorrectableUpload(row: TreatmentDischarge): void {
    if (row.status !== 'ISSUED') {
      throw new ConflictException(
        'Solo se puede reemplazar un informe emitido.',
      );
    }
    if (row.source !== 'UPLOADED') {
      throw new ConflictException(
        'Este informe lo generó el sistema: corrígelo con la corrección normal, no subiendo un archivo.',
      );
    }
  }

  private alreadyCorrectedError(): ConflictException {
    return new ConflictException(
      'Esta versión ya fue corregida. Corrige la versión vigente en su lugar.',
    );
  }

  // Snapshot del firmante tomado del User actual. A diferencia de un informe
  // GENERATED no exige RUT: el firmante real es quien firmó el PDF propio. El
  // registro profesional es siempre opcional.
  private async signerSnapshot(tx: Prisma.TransactionClient, userId: string) {
    const signer = await tx.user.findUnique({
      where: { id: userId },
      select: { name: true, rut: true, professionalRegistration: true },
    });
    return {
      signerName: signer?.name ?? null,
      signerRut: signer?.rut ?? null,
      signerProfessionalRegistration: signer?.professionalRegistration ?? null,
    };
  }

  private async auditUploaded(
    issued: TreatmentDischarge,
    cancelledGroupIds: string[],
    therapistId: string,
    ctx: DischargeRequestContext,
    opts: { closureApplied: boolean; correctsId?: string },
  ): Promise<void> {
    await logAuditFailOpen(this.auditService, this.logger, {
      userId: therapistId,
      action: 'DISCHARGE_ISSUE',
      resource: 'Discharge',
      resourceId: issued.id,
      detail: `patientId=${issued.patientId} groupId=${issued.groupId} version=${issued.version} source=UPLOADED contentHash=${issued.contentHash}`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    if (opts.correctsId) {
      await logAuditFailOpen(this.auditService, this.logger, {
        userId: therapistId,
        action: 'DISCHARGE_CORRECT',
        resource: 'Discharge',
        resourceId: issued.id,
        detail: `patientId=${issued.patientId} groupId=${issued.groupId} correctsId=${opts.correctsId} version=${issued.version} source=UPLOADED`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }
    if (opts.closureApplied) {
      await this.auditClosure(issued, cancelledGroupIds, therapistId, ctx);
    }
  }

  // Genera y guarda el PDF de un informe GENERATED emitido, una sola vez.
  // Idempotente: si ya hay documentId lo devuelve tal cual. Es la ÚNICA
  // mutación permitida sobre una fila ISSUED y no toca contentHash (que no
  // incluye documentId ni pdfSha256). Dos llamadas concurrentes pueden generar
  // cada una su PDF, pero solo una fija documentId (updateMany condicionado a
  // documentId null); la que pierde descarta su documento sobrante y devuelve
  // el ganador, así nunca quedan dos documentos vigentes.
  async ensurePdf(
    id: string,
    therapistId: string,
  ): Promise<TreatmentDischarge> {
    const row = await this.findOwned(id, therapistId);
    if (row.status !== 'ISSUED' || !row.issuedAt || !row.contentHash) {
      throw new ConflictException(
        'El informe aún no está emitido: no hay PDF que descargar.',
      );
    }
    // Un informe subido por el terapeuta (T3b) trae su propio PDF.
    if (row.documentId || row.source !== 'GENERATED') return row;

    const patient = await this.prisma.patient.findFirst({
      where: { id: row.patientId, therapistId, deletedAt: null },
      select: { fullName: true, rut: true, birthDate: true },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    // Representante(s) solo si el paciente era menor de 18 al emitir y pueden
    // acceder a informes (canAccessReports); si no hay, la sección se omite.
    const guardians = isMinor(patient.birthDate, row.issuedAt)
      ? await this.prisma.legalGuardian.findMany({
          where: { patientId: row.patientId, canAccessReports: true },
          orderBy: { createdAt: 'asc' },
          select: { fullName: true, rut: true, relationship: true },
        })
      : [];

    const buffer = await buildDischargePdf({
      discharge: {
        id: row.id,
        version: row.version,
        closureReason: row.closureReason,
        referralDestination: row.referralDestination,
        admissionDate: row.admissionDate,
        dischargeDate: row.dischargeDate,
        sessionCount: row.sessionCount,
        consultReason: row.consultReason,
        diagnosis: row.diagnosis,
        evolutionSummary: row.evolutionSummary,
        statusAtDischarge: row.statusAtDischarge,
        recommendations: row.recommendations,
        signerName: row.signerName,
        signerRut: row.signerRut,
        signerProfessionalRegistration: row.signerProfessionalRegistration,
        issuedAt: row.issuedAt,
        contentHash: row.contentHash,
      },
      patient,
      guardians,
    });
    const pdfSha256 = createHash('sha256').update(buffer).digest('hex');

    const stored = await this.documentsService.storeGeneratedDocument({
      patientId: row.patientId,
      userId: therapistId,
      type: 'DISCHARGE_REPORT',
      fileName: `informe-alta-v${row.version}-${chileDayKeyFromInstant(row.issuedAt)}.pdf`,
      buffer,
    });

    let claimed: { count: number };
    try {
      claimed = await this.prisma.treatmentDischarge.updateMany({
        where: { id, therapistId, status: 'ISSUED', documentId: null },
        data: { documentId: stored.id, pdfSha256 },
      });
    } catch (err) {
      await this.discardSurplusDocument(stored.id);
      throw err;
    }
    if (claimed.count === 0) {
      // Otra llamada ganó la carrera: este documento quedó sobrante.
      await this.discardSurplusDocument(stored.id);
    }
    return this.findOwned(id, therapistId);
  }

  private async discardSurplusDocument(documentId: string): Promise<void> {
    try {
      await this.documentsService.discardGeneratedDocument(documentId);
    } catch (err) {
      this.logger.error(
        `No se pudo descartar un PDF sobrante de informe de alta (documentId=${documentId}): ${errorMessage(err)}`,
      );
    }
  }

  // GET /discharges/:id/pdf: el PDF del informe, descifrado. Aislado por
  // terapeuta (404 uniforme); un borrador da 409. Si todavía no existe lo
  // genera (por ejemplo, si falló tras la emisión).
  async getPdf(id: string, therapistId: string): Promise<DischargePdfFile> {
    const row = await this.ensurePdf(id, therapistId);
    if (!row.documentId) {
      throw new NotFoundException('Este informe no tiene un PDF disponible.');
    }
    const { doc, buffer } = await this.documentsService.getDecryptedFile(
      row.documentId,
      therapistId,
    );
    return { buffer, fileName: doc.fileName, patientId: row.patientId };
  }

  // Efectos del cierre dentro de la transacción de emisión, ya con los locks de
  // terapeuta y paciente tomados. Devuelve los groupId de las consultas
  // canceladas.
  //
  // Una corrección (correctsId presente) solo actúa mientras el paciente siga
  // cerrado: si fue reabierto (ACTIVE) el informe se emite como registro y no
  // toca su estado ni sus consultas nuevas. Con el paciente cerrado, el estado
  // solo se reescribe si cambió el motivo de cierre.
  //
  // Las consultas se marcan con cancelledAt, cancelledByDischargeId y también
  // deletedAt: así recordatorios, calendario y disponibilidad (que ya filtran
  // deletedAt) dejan de verlas sin tocar esos módulos. Patient.deletedAt NO se
  // usa: liberaría el RUT por el índice parcial único y ocultaría al paciente.
  //
  // Carrera con la reserva pública: createFromPublicBooking toma User y luego
  // Patient FOR SHARE, y este camino toma Patient FOR UPDATE, así que se
  // serializan. Si la reserva confirma antes, su consulta se ve en el findMany
  // de abajo (el lock se mantiene hasta el commit) y su BookedSlot se borra
  // junto con ella. Si la reserva espera detrás de este cierre, depende de que
  // su FOR SHARE rechace pacientes no activos (ver el integration spec).
  // Consultas futuras vigentes (última versión, no borradas) del paciente con
  // este terapeuta. Compartida por el cierre y por la vista previa de solo
  // lectura, para que ambas listen exactamente lo mismo.
  // Sin `take` a propósito (issue #446): la misma consulta alimenta la vista
  // previa y la cancelación real del cierre, así que un tope haría que la vista
  // previa subestimara lo que el cierre cancela. El volumen está acotado por
  // paciente (sus consultas futuras vigentes, filtradas por terapeuta).
  private findFutureConsultations(
    client: Pick<Prisma.TransactionClient, 'consultation'>,
    patientId: string,
    therapistId: string,
    now: Date,
  ) {
    return client.consultation.findMany({
      where: {
        patientId,
        therapistId,
        correctedBy: null,
        deletedAt: null,
        sessionDate: { gt: now },
      },
      select: { id: true, groupId: true, sessionDate: true },
      orderBy: { sessionDate: 'asc' },
    });
  }

  private async applyClosureInTransaction(
    tx: Prisma.TransactionClient,
    discharge: TreatmentDischarge,
    currentStatus: string,
  ): Promise<string[]> {
    const isCorrection = discharge.correctsId !== null;
    if (isCorrection && currentStatus === 'ACTIVE') return [];
    if (!isCorrection || currentStatus !== discharge.closureReason) {
      await tx.patient.update({
        where: { id: discharge.patientId },
        data: { treatmentStatus: discharge.closureReason },
      });
    }

    const now = new Date();
    const future = await this.findFutureConsultations(
      tx,
      discharge.patientId,
      discharge.therapistId,
      now,
    );
    if (future.length === 0) return [];

    const groupIds = [...new Set(future.map((c) => c.groupId))];
    await tx.consultation.updateMany({
      where: {
        id: { in: future.map((c) => c.id) },
        therapistId: discharge.therapistId,
        deletedAt: null,
      },
      data: {
        cancelledAt: now,
        cancelledByDischargeId: discharge.id,
        deletedAt: now,
      },
    });
    await tx.bookedSlot.deleteMany({ where: { groupId: { in: groupIds } } });
    return groupIds;
  }

  // Efectos posteriores al commit: no bloqueantes y con fallos aislados (mismo
  // patrón que PatientsService.softDelete). El cierre ya es definitivo; un
  // fallo de la pasarela, de Google o de la caché solo se registra en logs. El
  // reconciler de Google es el respaldo del borrado de eventos.
  private async runPostCommitEffects(
    therapistId: string,
    groupIds: string[],
  ): Promise<void> {
    try {
      this.availabilityService.invalidate(therapistId);
    } catch (err) {
      this.logger.error(
        `Fallo al invalidar la caché de disponibilidad tras el cierre (therapistId=${therapistId}): ${errorMessage(err)}`,
      );
    }
    if (groupIds.length === 0) return;

    // Fire-and-forget, igual que softDelete: el borrado de eventos de Google
    // no debe retrasar la respuesta.
    void this.calendarSync
      .deleteEventsForGroups(therapistId, groupIds)
      .catch((err: unknown) => {
        this.logger.error(
          `Fallo no bloqueante al eliminar eventos de Google Calendar tras el cierre (therapistId=${therapistId}): ${errorMessage(err)}`,
        );
      });

    // El estado financiero se resuelve antes de responder (como en softDelete),
    // pero cada cobro está aislado: un rechazo no frena a los demás.
    await Promise.all(
      groupIds.map((groupId) =>
        Promise.resolve()
          .then(() => this.paymentsService.cancelUnpaid(groupId))
          .catch((err: unknown) => {
            this.logger.error(
              `Fallo al cancelar el cobro pendiente tras el cierre (groupId=${groupId}): ${errorMessage(err)}`,
            );
          }),
      ),
    );
  }

  // POST /discharges/:id/correct
  async correct(
    id: string,
    therapistId: string,
    ctx: DischargeRequestContext = {},
  ): Promise<TreatmentDischarge> {
    const original = await this.findOwned(id, therapistId);
    if (original.status !== 'ISSUED') {
      throw new ConflictException(
        'Solo se puede corregir un informe emitido. Edita el borrador directamente.',
      );
    }

    if (original.source === 'UPLOADED') {
      throw new ConflictException(
        'Este informe lo aportaste tú: para reemplazarlo sube el archivo nuevo en la ruta de corrección con archivo (correct-upload).',
      );
    }

    const alreadyCorrected = await this.prisma.treatmentDischarge.findFirst({
      where: { correctsId: id },
      select: { id: true },
    });
    if (alreadyCorrected) {
      throw new ConflictException(
        'Esta versión ya fue corregida. Corrige la versión vigente en su lugar.',
      );
    }

    const newId = randomUUID();
    let created: TreatmentDischarge;
    try {
      created = await this.prisma.treatmentDischarge.create({
        data: {
          id: newId,
          groupId: original.groupId,
          version: original.version + 1,
          correctsId: original.id,
          patientId: original.patientId,
          therapistId,
          source: original.source,
          status: 'DRAFT',
          closureReason: original.closureReason,
          dropoutReason: original.dropoutReason,
          dropoutNote: original.dropoutNote,
          referralDestination: original.referralDestination,
          admissionDate: original.admissionDate,
          dischargeDate: original.dischargeDate,
          sessionCount: original.sessionCount,
          consultReason: original.consultReason,
          diagnosis: original.diagnosis,
          evolutionSummary: original.evolutionSummary,
          statusAtDischarge: original.statusAtDischarge,
          recommendations: original.recommendations,
        },
      });
    } catch (err) {
      // Dos correcciones concurrentes de la misma versión: el @unique de
      // correctsId deja pasar solo una.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Esta versión ya fue corregida. Corrige la versión vigente en su lugar.',
        );
      }
      throw err;
    }

    await logAuditFailOpen(this.auditService, this.logger, {
      userId: therapistId,
      action: 'DISCHARGE_CORRECT',
      resource: 'Discharge',
      resourceId: created.id,
      detail: `patientId=${created.patientId} groupId=${created.groupId} correctsId=${original.id} version=${created.version}`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return created;
  }

  // GET /discharges/:id
  async findOne(id: string, therapistId: string): Promise<TreatmentDischarge> {
    return this.findOwned(id, therapistId);
  }

  // GET /patients/:patientId/discharges (todas las versiones)
  async findByPatient(
    patientId: string,
    therapistId: string,
  ): Promise<TreatmentDischarge[]> {
    await this.patientsService.assertAccess(patientId, therapistId);
    return this.prisma.treatmentDischarge.findMany({
      where: { patientId, therapistId },
      orderBy: [{ createdAt: 'asc' }, { version: 'asc' }],
    });
  }

  // GET /patients/:patientId/discharges/cancellation-preview: consultas futuras
  // que un cierre cancelaría ahora. Solo lectura.
  async cancellationPreview(
    patientId: string,
    therapistId: string,
  ): Promise<{
    count: number;
    consultations: { id: string; groupId: string; sessionDate: Date }[];
  }> {
    await this.patientsService.assertAccess(patientId, therapistId);
    const consultations = await this.findFutureConsultations(
      this.prisma,
      patientId,
      therapistId,
      new Date(),
    );
    return {
      count: new Set(consultations.map((c) => c.groupId)).size,
      consultations,
    };
  }

  // GET /discharges/:id/verify: recalcula el hash desde lo que hay en la base
  // y lo compara con el guardado. Devuelve metadatos, nunca el contenido.
  async verify(
    id: string,
    therapistId: string,
  ): Promise<DischargeVerification> {
    const row = await this.prisma.treatmentDischarge.findFirst({
      where: { id, therapistId, patient: { deletedAt: null } },
      include: { correctedBy: { select: { id: true } } },
    });
    if (!row) throw new NotFoundException('Informe no encontrado');
    if (row.status !== 'ISSUED' || !row.issuedAt) {
      throw new ConflictException(
        'El informe aún no está emitido: no hay hash que verificar.',
      );
    }

    const base = {
      dischargeId: row.id,
      groupId: row.groupId,
      version: row.version,
      status: 'ISSUED' as const,
      issuedAt: row.issuedAt,
      contentHash: row.contentHash,
      isCurrent: row.correctedBy === null,
      source: row.source,
      providedByTherapist: row.source === 'UPLOADED',
    };

    if (row.source === 'UPLOADED') {
      // El contenido es el propio archivo: se recalcula el SHA-256 de los bytes
      // descifrados. Un objeto ausente o alterado es inválido; un fallo de
      // infraestructura se propaga (no se puede afirmar ni negar la integridad).
      const pdf = await this.checkUploadedIntegrity(row, therapistId);
      return { ...base, valid: pdf.intact === true, pdf };
    }

    const recomputed = computeDischargeHash(dischargeHashInputFromRow(row));
    return {
      ...base,
      valid: hashesMatch(recomputed, row.contentHash),
      pdf: await this.checkPdfIntegrity(row, therapistId),
    };
  }

  private async checkUploadedIntegrity(
    row: { documentId: string | null; contentHash: string | null },
    therapistId: string,
  ): Promise<{ present: boolean; intact: boolean | null }> {
    if (!row.documentId || !row.contentHash) {
      return { present: false, intact: false };
    }
    try {
      const { buffer } = await this.documentsService.getDecryptedFile(
        row.documentId,
        therapistId,
      );
      const actual = createHash('sha256').update(buffer).digest('hex');
      return { present: true, intact: hashesMatch(row.contentHash, actual) };
    } catch (err) {
      if (err instanceof NotFoundException) {
        return { present: true, intact: false };
      }
      throw err;
    }
  }

  // Compara el SHA-256 de los bytes descifrados con el guardado al generar el
  // PDF. No expone contenido. Un objeto ausente en el storage cuenta como no
  // íntegro; un fallo de infraestructura deja el resultado en null (no se
  // puede afirmar nada) y se registra sin datos del paciente.
  private async checkPdfIntegrity(
    row: { id: string; documentId: string | null; pdfSha256: string | null },
    therapistId: string,
  ): Promise<{ present: boolean; intact: boolean | null }> {
    if (!row.documentId) return { present: false, intact: null };
    if (!row.pdfSha256) return { present: true, intact: null };
    try {
      const { buffer } = await this.documentsService.getDecryptedFile(
        row.documentId,
        therapistId,
      );
      const actual = createHash('sha256').update(buffer).digest('hex');
      return { present: true, intact: hashesMatch(row.pdfSha256, actual) };
    } catch (err) {
      if (err instanceof NotFoundException) {
        return { present: true, intact: false };
      }
      this.logger.error(
        `No se pudo leer el PDF para verificar su integridad (dischargeId=${row.id}): ${errorMessage(err)}`,
      );
      return { present: true, intact: null };
    }
  }

  // Aislamiento por terapeuta: un informe ajeno es indistinguible de uno
  // inexistente (404 uniforme, nunca 403).
  private async findOwned(
    id: string,
    therapistId: string,
  ): Promise<TreatmentDischarge> {
    const row = await this.prisma.treatmentDischarge.findFirst({
      where: { id, therapistId, patient: { deletedAt: null } },
    });
    if (!row) throw new NotFoundException('Informe no encontrado');
    return row;
  }

  private assertDates(row: { admissionDate: Date; dischargeDate: Date }): void {
    const admission = dateOnlyDayKey(row.admissionDate);
    const discharge = dateOnlyDayKey(row.dischargeDate);
    if (admission > discharge) {
      throw new BadRequestException(
        'La fecha de ingreso no puede ser posterior a la fecha de alta.',
      );
    }
    if (discharge > chileDayKeyFromInstant(new Date())) {
      throw new BadRequestException('La fecha de alta no puede ser futura.');
    }
  }

  // Un informe generado por el sistema debe tener su contenido completo antes
  // de emitirse; el diagnóstico es opcional.
  private assertContentComplete(row: TreatmentDischarge): void {
    if (row.source !== 'GENERATED') return;
    const missing: string[] = [];
    if (!row.consultReason.trim()) missing.push('motivo de consulta');
    if (!row.evolutionSummary.trim()) missing.push('resumen de la evolución');
    if (!row.statusAtDischarge.trim()) missing.push('estado al alta');
    if (!row.recommendations.trim()) missing.push('recomendaciones');
    if (missing.length > 0) {
      throw new BadRequestException(
        `Completa antes de emitir: ${missing.join(', ')}.`,
      );
    }
  }
}
