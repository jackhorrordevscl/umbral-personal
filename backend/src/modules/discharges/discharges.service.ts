import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, TreatmentDischarge } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { AuditService } from '../audit/audit.service';
import { logAuditFailOpen } from '../../common/utils/audit-fail-open.util';
import {
  chileDayKeyFromInstant,
  dateOnlyDayKey,
} from '../../common/utils/chile-time.util';
import { CreateDischargeDto } from './dto/create-discharge.dto';
import { UpdateDischargeDto } from './dto/update-discharge.dto';
import { assertClosureRules } from './util/closure-rules.util';
import {
  computeDischargeHash,
  dischargeHashInputFromRow,
  hashesMatch,
} from './util/discharge-hash.util';

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

    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, therapistId, deletedAt: null },
      select: { treatmentStatus: true },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    if (patient.treatmentStatus !== 'ACTIVE') {
      throw new ConflictException(
        'El tratamiento de este paciente ya está cerrado. Corrige el informe vigente en vez de crear uno nuevo.',
      );
    }

    const openDraft = await this.prisma.treatmentDischarge.findFirst({
      where: { patientId, therapistId, status: 'DRAFT', correctsId: null },
      select: { id: true },
    });
    if (openDraft) {
      throw new ConflictException(
        'Este paciente ya tiene un borrador de informe de alta. Edítalo o emítelo.',
      );
    }

    // Prellenado: SOLO recuentos y fechas derivados de las consultas vigentes
    // y ya realizadas. Nunca se copian notas clínicas al informe (minimización).
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
      this.prisma.consultation.count({ where: held }),
      this.prisma.consultation.findFirst({
        where: held,
        orderBy: { sessionDate: 'asc' },
        select: { sessionDate: true },
      }),
    ]);

    const today = chileDayKeyFromInstant(now);
    const admissionDay = first
      ? chileDayKeyFromInstant(first.sessionDate)
      : today;

    const id = randomUUID();
    return this.prisma.treatmentDischarge.create({
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
  ): Promise<TreatmentDischarge> {
    const draft = await this.findOwned(id, therapistId);

    const issued = await this.prisma.$transaction(async (tx) => {
      // Lock de la fila del paciente (orden de locks documentado en
      // ConsultationsService.lockTherapistSchedule: User y luego Patient; aquí
      // solo hace falta Patient). Serializa la emisión con la baja, otra
      // emisión y la reserva pública, y es el punto donde T2b cancelará las
      // consultas futuras sin carrera.
      await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${draft.patientId} FOR UPDATE`;

      const patient = await tx.patient.findFirst({
        where: { id: draft.patientId, therapistId, deletedAt: null },
        select: { id: true },
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
        select: { name: true },
      });
      const issuedAt = new Date();
      const signed = {
        ...fresh,
        issuedAt,
        // La ficha de usuario aún no guarda RUT ni registro profesional: el
        // snapshot los deja en null hasta que existan esos campos.
        signerName: signer?.name ?? null,
        signerRut: null,
        signerProfessionalRegistration: null,
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
      await this.applyClosureInTransaction(tx, row);
      return row;
    });

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
    await logAuditFailOpen(this.auditService, this.logger, {
      userId: therapistId,
      action: 'TREATMENT_CLOSED',
      resource: 'Patient',
      resourceId: issued.patientId,
      // Sin dropoutNote ni destino de derivación: son texto libre del terapeuta.
      detail: `status=${issued.closureReason}${issued.dropoutReason ? ` dropoutReason=${issued.dropoutReason}` : ''} dischargeId=${issued.id}`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return issued;
  }

  // Efectos del cierre dentro de la transacción de emisión, ya con el lock del
  // paciente tomado.
  // TODO(T2b): aquí se enchufa la cancelación de consultas futuras del
  // paciente (versión vigente, sessionDate > now, deletedAt null): setear
  // cancelledAt / cancelledByDischargeId / deletedAt y borrar sus BookedSlot
  // por groupId, todo en esta misma transacción. Los efectos posteriores al
  // commit (cobros, Google, caché de disponibilidad) van en issue(), después
  // del $transaction.
  private async applyClosureInTransaction(
    tx: Prisma.TransactionClient,
    discharge: TreatmentDischarge,
  ): Promise<void> {
    await tx.patient.update({
      where: { id: discharge.patientId },
      data: { treatmentStatus: discharge.closureReason },
    });
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

    const recomputed = computeDischargeHash(dischargeHashInputFromRow(row));
    return {
      valid: hashesMatch(recomputed, row.contentHash),
      dischargeId: row.id,
      groupId: row.groupId,
      version: row.version,
      status: 'ISSUED',
      issuedAt: row.issuedAt,
      contentHash: row.contentHash,
      isCurrent: row.correctedBy === null,
    };
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
