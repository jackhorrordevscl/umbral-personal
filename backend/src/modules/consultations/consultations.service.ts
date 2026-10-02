import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CalendarSyncStatus,
  Consultation,
  Prisma,
  ReminderChannel,
  ReminderDispatchStatus,
  SessionType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { PaymentsService } from '../payments/payments.service';
import { AvailabilityService } from '../availability/availability.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { CorrectConsultationDto } from './dto/correct-consultation.dto';
import { ConsultationRangeQueryDto } from './dto/consultation-range-query.dto';
import { toJsonSnapshot } from '../../common/utils/json-clone.util';
import { sanitizeClinicalNote } from '../../common/utils/clinical-note-sanitizer.util';
import { UNPAGINATED_SAFETY_LIMIT } from '../../common/dto/pagination.dto';
import {
  DEFAULT_SESSION_MINUTES,
  MAX_SESSION_MINUTES,
} from '../calendar-integration/calendar-integration.constants';

function parseDate(dateStr: string): Date {
  if (dateStr.includes('T') || dateStr.includes(' ')) {
    return new Date(dateStr);
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

// Issue #299: respuesta mínima de una reserva pública anónima.
export interface PublicBookingConfirmation {
  id: string;
  sessionDate: Date;
}

const THERAPIST_SELECT = { therapist: { select: { name: true, email: true } } };

// design.md "Range query params are ISO instants with explicit offset,
// half-open": el rango solicitado no puede superar 62 días (cubre el grid
// completo de 6x7 semanas con margen).
const MAX_RANGE_SPAN_DAYS = 62;
const MAX_RANGE_SPAN_MS = MAX_RANGE_SPAN_DAYS * 24 * 60 * 60 * 1000;

// design.md "Interfaces / Contracts": el payload del grid excluye
// consultReason/intervention/agreements/history a propósito -- una vista de
// mes no debe sobre-exponer PHI clínico (design.md "Decision: Grid payload
// excludes clinical narrative").
// issue #163: estado del ReminderDispatch EMAIL más reciente por groupId --
// null si nunca se despachó un recordatorio por email para esta consulta
// (ver getReminderEmailStatusMap). deliveredAt/openedAt los setea el webhook
// de Resend (WebhooksService.handleEvent), nunca esta clase.
export interface ReminderEmailStatus {
  status: ReminderDispatchStatus;
  deliveredAt: string | null;
  openedAt: string | null;
}

export interface CalendarSession {
  id: string;
  groupId: string;
  sessionDate: string;
  sessionType: SessionType;
  patientId: string;
  patientName: string;
  calendarSync: CalendarSyncStatus | null;
  reminderEmailStatus: ReminderEmailStatus | null;
}

@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);

  constructor(
    private prisma: PrismaService,
    private patientsService: PatientsService,
    private calendarSync: CalendarSyncService,
    private paymentsService: PaymentsService,
    private availabilityService: AvailabilityService,
  ) {}

  // design.md "Fire-and-forget intents plus a bounded reconciler": nunca se
  // await -- un fallo de Google (o el flag GOOGLE_CALENDAR_SYNC_ENABLED en
  // false) jamás debe bloquear ni revertir la escritura clínica que lo
  // origina (spec.md "Non-Blocking Sync Failures").
  private emitCalendarSync(groupId: string): void {
    void this.calendarSync.syncGroup(groupId).catch((err: unknown) => {
      this.logger.error(
        `Fallo no bloqueante al sincronizar con Google Calendar (groupId=${groupId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  // sdd/online-payment-integration PR 1 (T2.5): mismo patrón fire-and-forget
  // que emitCalendarSync -- un fallo del gateway de pago (o
  // PAYMENTS_ENABLED en false) jamás debe bloquear ni revertir la
  // escritura clínica que lo origina (design.md "Nothing in this module can
  // fail a clinical write").
  private emitPaymentCharge(groupId: string): void {
    void this.paymentsService.ensureCharge(groupId).catch((err: unknown) => {
      this.logger.error(
        `Fallo no bloqueante al gestionar el cargo de pago (groupId=${groupId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async create(dto: CreateConsultationDto, therapistId: string) {
    // assertAccess lanza NotFoundException si el paciente no existe o no
    // pertenece al profesional autenticado -- sin este chequeo, cualquier
    // usuario podía crear una consulta sobre un paciente ajeno conociendo su
    // id (issue #12).
    const patient = await this.patientsService.assertAccess(
      dto.patientId,
      therapistId,
    );

    const patientRut = dto.patientRut || patient.rut;

    // Se genera el id de antemano para que groupId (el identificador de la
    // cadena de versiones) sea igual al id de esta primera versión.
    const id = randomUUID();

    // Issue #131 (Ley 20.584 Art. 14 / review R3-001): el chequeo de
    // consentimiento y la escritura de la Consultation viven en la misma
    // transacción -- así una revocación concurrente entre el chequeo y el
    // insert no puede colarse (antes eran dos queries separadas con una
    // ventana de carrera). Cualquiera de las dos finalidades (presencial o
    // telemedicina) habilita la consulta, sin importar el sessionType de
    // esta sesión puntual.
    const consultation = await this.prisma.$transaction(async (tx) => {
      const consentStatus = await this.patientsService.getConsentStatusMap(
        [dto.patientId],
        tx,
      );
      const consent = consentStatus.get(dto.patientId);
      if (!consent?.TREATMENT && !consent?.TELEMEDICINE) {
        throw new ForbiddenException(
          'El paciente no tiene un consentimiento informado vigente. Registra el consentimiento antes de crear la consulta.',
        );
      }

      // issue #336: la sesión nace con la duración vigente del terapeuta y la
      // conserva aunque después cambie su configuración.
      const therapist = await tx.user.findUnique({
        where: { id: therapistId },
        select: { sessionDurationMinutes: true },
      });

      return tx.consultation.create({
        data: {
          id,
          groupId: id,
          patientId: dto.patientId,
          therapistId,
          sessionDate: parseDate(dto.sessionDate),
          durationMinutes:
            therapist?.sessionDurationMinutes ?? DEFAULT_SESSION_MINUTES,
          consultReason: sanitizeClinicalNote(dto.consultReason),
          intervention: sanitizeClinicalNote(dto.intervention),
          agreements: sanitizeClinicalNote(dto.agreements),
          nextSessionDate: dto.nextSessionDate
            ? parseDate(dto.nextSessionDate)
            : null,
          sessionType: dto.sessionType ?? 'IN_PERSON',
          scheduledAt: dto.scheduledAt
            ? parseDate(dto.scheduledAt)
            : parseDate(dto.sessionDate),
          patientRut,
        },
      });
    });
    this.logger.log(
      `Consulta creada: id=${consultation.id} patientId=${dto.patientId} therapistId=${therapistId}`,
    );
    // issue #285: el horario recién ocupado no debe seguir ofrecido desde el
    // cache de slots.
    this.availabilityService.invalidate(therapistId);
    this.emitCalendarSync(consultation.groupId);
    this.emitPaymentCharge(consultation.groupId);
    return consultation;
  }

  /**
   * El historial de correcciones vive en ConsultationHistory, siempre
   * indexado por groupId (el id de la primera versión de la cadena, que
   * nunca cambia) — no por el id de la fila que se esté mirando en ese
   * momento, para que cualquier versión de una consulta muestre el mismo
   * historial completo.
   */
  private async getHistory(
    groupId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return client.consultationHistory.findMany({
      where: { consultationId: groupId },
      orderBy: { editedAt: 'desc' },
      include: { editedBy: { select: { name: true, email: true } } },
    });
  }

  // Sin page/pageSize devuelve la lista completa (retrocompatible); con
  // ambos, pagina con take/skip (issue #48).
  async findByPatient(
    patientId: string,
    userId: string,
    pagination?: { page?: number; pageSize?: number },
  ) {
    // Lanza NotFoundException si el usuario no tiene acceso a este paciente
    await this.patientsService.assertAccess(patientId, userId);

    const where = { patientId, correctedBy: null, deletedAt: null };
    const { page, pageSize } = pagination ?? {};
    const isPaginated = !!page && !!pageSize;
    // issue #140: sin pagination, take usa el cap de seguridad en vez de
    // quedar sin límite (ver UNPAGINATED_SAFETY_LIMIT).
    const take = isPaginated ? pageSize : UNPAGINATED_SAFETY_LIMIT;
    const skip = isPaginated ? (page - 1) * pageSize : undefined;

    // Solo la versión vigente de cada consulta (correctedBy: null = nadie la corrigió después)
    const [consultations, total] = await Promise.all([
      this.prisma.consultation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: THERAPIST_SELECT,
        take,
        skip,
      }),
      isPaginated
        ? this.prisma.consultation.count({ where })
        : Promise.resolve(undefined),
    ]);

    // Una sola query para el historial de todas las consultas en vez de N
    // (antes: una consulta a consultationHistory por cada fila, aunque
    // paralelizadas con Promise.all) -- mismo patrón que
    // PatientsService.getConsentStatusMap.
    const historyMap = new Map<
      string,
      Awaited<ReturnType<typeof this.getHistory>>
    >();
    if (consultations.length > 0) {
      const groupIds = consultations.map((c) => c.groupId);
      const allHistory = await this.prisma.consultationHistory.findMany({
        where: { consultationId: { in: groupIds } },
        orderBy: { editedAt: 'desc' },
        include: { editedBy: { select: { name: true, email: true } } },
      });
      for (const groupId of groupIds) historyMap.set(groupId, []);
      for (const entry of allHistory) {
        historyMap.get(entry.consultationId)?.push(entry);
      }
    }

    // sdd/online-payment-integration PR 3 (T9.6, design.md "Key File
    // Changes"): resuelto vía el mismo groupId-map anti-N+1 que historyMap
    // arriba (Payment no tiene FK a Consultation -- @@unique([groupId]),
    // ver design.md "Decision: Payment keyed on groupId"). Solo
    // ConsultationsPage (findByPatient) necesita esta superficie en este
    // PR -- CalendarPage/findByRange queda fuera de alcance de la Fase 9.
    const paymentMap = await this.getPaymentMap(
      consultations.map((c) => c.groupId),
    );

    // issue #163: mismo patrón anti-N+1 que paymentMap/historyMap -- una
    // sola query para el estado de recordatorio por email de todas las
    // consultas de esta página, en vez de una consulta por fila.
    const reminderEmailStatusMap = await this.getReminderEmailStatusMap(
      consultations.map((c) => c.groupId),
    );

    const data = consultations.map((c) => ({
      ...c,
      history: historyMap.get(c.groupId) ?? [],
      payment: paymentMap.get(c.groupId) ?? null,
      reminderEmailStatus: reminderEmailStatusMap.get(c.groupId) ?? null,
    }));

    return isPaginated ? { data, total, page, pageSize } : data;
  }

  private async getPaymentMap(groupIds: string[]) {
    const map = new Map<
      string,
      {
        groupId: string;
        status: string;
        linkDelivery: string;
        paymentUrl: string | null;
        amount: number;
        lastError: string | null;
      }
    >();
    if (groupIds.length === 0) return map;

    const payments = await this.prisma.payment.findMany({
      where: { groupId: { in: groupIds } },
      select: {
        groupId: true,
        status: true,
        linkDelivery: true,
        paymentUrl: true,
        amount: true,
        lastError: true,
      },
    });
    for (const payment of payments) {
      map.set(payment.groupId, {
        groupId: payment.groupId,
        status: payment.status,
        linkDelivery: payment.linkDelivery,
        paymentUrl: payment.paymentUrl,
        amount: payment.amount,
        lastError: payment.lastError,
      });
    }
    return map;
  }

  // Issue #40: 2 queries de agregación en vez de traer todas las filas.
  async getStats(therapistId: string) {
    // issue #285: las consultas de pacientes eliminados no cuentan.
    const baseWhere = {
      therapistId,
      correctedBy: null,
      deletedAt: null,
      patient: { deletedAt: null },
    };
    const [total, upcoming] = await Promise.all([
      this.prisma.consultation.count({ where: baseWhere }),
      this.prisma.consultation.count({
        where: { ...baseWhere, nextSessionDate: { gte: new Date() } },
      }),
    ]);
    return { total, upcoming };
  }

  async findOne(id: string, userId: string) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id, deletedAt: null },
      include: THERAPIST_SELECT,
    });
    if (!consultation) throw new NotFoundException('Consulta no encontrada');

    // Lanza NotFoundException si el usuario no tiene acceso al paciente dueño de esta consulta
    await this.patientsService.assertAccess(consultation.patientId, userId);

    const history = await this.getHistory(consultation.groupId);

    return { ...consultation, history };
  }

  async correct(id: string, dto: CorrectConsultationDto, therapistId: string) {
    const original = await this.findOne(id, therapistId);

    // El chequeo de versión-ya-corregida va primero (precedencia previa a
    // issue #131, review R3-003): es un problema de integridad de la cadena
    // de versiones, independiente del consentimiento -- un id de versión
    // stale sigue siendo 409 aunque además falte consentimiento, no 403.
    const alreadySuperseded = await this.prisma.consultation.findFirst({
      where: { correctsId: id },
      select: { id: true },
    });
    if (alreadySuperseded) {
      throw new ConflictException(
        'Esta versión ya fue corregida — corrige la versión vigente en su lugar.',
      );
    }

    // Snapshot del estado actual antes de crear la corrección
    const snapshot = toJsonSnapshot({
      sessionDate: original.sessionDate,
      consultReason: original.consultReason,
      intervention: original.intervention,
      agreements: original.agreements,
      nextSessionDate: original.nextSessionDate,
      sessionType: original.sessionType,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // Issue #131 (Ley 20.584 Art. 14 / review R3-001): cubre el caso de
      // createFromPublicBooking -- la reserva pública crea una Consultation
      // placeholder sin contenido clínico real ("Pendiente de definir por
      // el terapeuta"); correct() es el punto donde ese contenido clínico
      // real se carga por primera vez, así que necesita el mismo guardrail
      // que create(). Corre dentro de la misma transacción que la
      // escritura -- misma razón que en create(), cierra la ventana de
      // carrera entre el chequeo y el insert.
      const consentStatus = await this.patientsService.getConsentStatusMap(
        [original.patientId],
        tx,
      );
      const consent = consentStatus.get(original.patientId);
      if (!consent?.TREATMENT && !consent?.TELEMEDICINE) {
        throw new ForbiddenException(
          'El paciente no tiene un consentimiento informado vigente. Registra el consentimiento antes de corregir la consulta.',
        );
      }

      // El snapshot queda indexado por groupId, no por el id de la versión
      // que se está corrigiendo, para que el historial sea el mismo visto
      // desde cualquier versión de la cadena.
      await tx.consultationHistory.create({
        data: {
          consultationId: original.groupId,
          editedById: therapistId,
          snapshot,
        },
      });

      // Nunca se toca la fila original — se crea una fila nueva que la
      // sucede vía correctsId. La original queda bit a bit idéntica y
      // consultable por su id de siempre.
      const corrected = await tx.consultation.create({
        data: {
          groupId: original.groupId,
          patientId: original.patientId,
          therapistId: original.therapistId,
          sessionDate: dto.sessionDate
            ? parseDate(dto.sessionDate)
            : original.sessionDate,
          // issue #336: una corrección conserva la duración reservada.
          durationMinutes: original.durationMinutes,
          consultReason: dto.consultReason
            ? sanitizeClinicalNote(dto.consultReason)
            : original.consultReason,
          intervention: dto.intervention
            ? sanitizeClinicalNote(dto.intervention)
            : original.intervention,
          agreements:
            dto.agreements !== undefined
              ? sanitizeClinicalNote(dto.agreements)
              : original.agreements,
          nextSessionDate: dto.nextSessionDate
            ? parseDate(dto.nextSessionDate)
            : original.nextSessionDate,
          sessionType: dto.sessionType ?? original.sessionType,
          scheduledAt: original.scheduledAt,
          patientRut: original.patientRut,
          correctsId: id,
        },
        include: THERAPIST_SELECT,
      });

      // issue #285: si la sesión se movió, el BookedSlot del grupo (solo
      // existe en reservas públicas) se mueve con ella: el horario original
      // vuelve a ser reservable y el nuevo queda protegido por el @@unique.
      if (corrected.sessionDate.getTime() !== original.sessionDate.getTime()) {
        try {
          await tx.bookedSlot.updateMany({
            where: { groupId: original.groupId },
            data: { slotStart: corrected.sessionDate },
          });
        } catch (err) {
          // El nuevo horario ya está tomado por otra reserva
          // (BookedSlot.@@unique); al lanzar, la transacción hace rollback
          // completo. Solo este P2002 se traduce: otros (p. ej. correctsId
          // @unique en una corrección concurrente) deben propagarse tal cual.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            throw new ConflictException(
              'El nuevo horario seleccionado ya no está disponible.',
            );
          }
          throw err;
        }
      }

      return {
        ...corrected,
        history: await this.getHistory(original.groupId, tx),
      };
    });
    this.logger.log(
      `Consulta corregida: originalId=${id} nuevaId=${result.id} groupId=${original.groupId} therapistId=${therapistId}`,
    );
    // issue #285: la sesión pudo moverse; libera/ocupa slots en el cache.
    this.availabilityService.invalidate(therapistId);
    this.emitCalendarSync(original.groupId);
    this.emitPaymentCharge(original.groupId);
    return result;
  }

  // design.md "Range query params are ISO instants with explicit offset,
  // half-open": sessionDate: { gte: from, lt: to } -- half-open evita perder
  // el borde superior por redondeo (23:59:59.999). Reutiliza el mismo filtro
  // de versión vigente que findByPatient (correctedBy: null, deletedAt:
  // null).
  async findByRange(
    therapistId: string,
    query: ConsultationRangeQueryDto,
  ): Promise<CalendarSession[]> {
    const from = new Date(query.from);
    const to = new Date(query.to);

    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException(
        'El rango solicitado es inválido: "to" debe ser posterior a "from".',
      );
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_SPAN_MS) {
      throw new BadRequestException(
        `El rango solicitado no puede superar ${MAX_RANGE_SPAN_DAYS} días.`,
      );
    }

    const consultations = await this.prisma.consultation.findMany({
      where: {
        therapistId,
        correctedBy: null,
        deletedAt: null,
        // issue #285: paciente eliminado => sus sesiones salen del calendario.
        patient: { deletedAt: null },
        sessionDate: { gte: from, lt: to },
      },
      include: { patient: { select: { fullName: true } } },
      orderBy: { sessionDate: 'asc' },
    });

    if (consultations.length === 0) return [];

    const syncMap = await this.getSyncStatusMap(
      therapistId,
      consultations.map((c) => c.groupId),
    );

    // issue #163: mismo patrón anti-N+1 que syncMap.
    const reminderEmailStatusMap = await this.getReminderEmailStatusMap(
      consultations.map((c) => c.groupId),
    );

    return consultations.map((c) => {
      const reminderStatus = reminderEmailStatusMap.get(c.groupId);
      return {
        id: c.id,
        groupId: c.groupId,
        sessionDate: c.sessionDate.toISOString(),
        sessionType: c.sessionType,
        patientId: c.patientId,
        patientName: c.patient.fullName,
        calendarSync: syncMap.get(c.groupId) ?? null,
        reminderEmailStatus: reminderStatus
          ? {
              status: reminderStatus.status,
              deliveredAt: reminderStatus.deliveredAt?.toISOString() ?? null,
              openedAt: reminderStatus.openedAt?.toISOString() ?? null,
            }
          : null,
      };
    });
  }

  // sdd/patient-self-scheduling PR 3 (tasks.md 3.5, design.md Decision 1
  // "Double-booking guard" + Data Flow "POST .../availability/book"):
  // recheck slot -> insert BookedSlot -> insert Consultation, todo dentro de
  // la misma transacción. El recheck contra Consultation es un fast-fail
  // para el caso obvio (lectura de disponibilidad stale, cache de 5 min);
  // BookedSlot.@@unique([therapistId, slotStart]) es el guard REAL bajo
  // carrera concurrente -- dos requests pueden pasar el recheck antes de que
  // cualquiera escriba, así que P2002 en ese insert también se traduce a 409
  // (nunca un 500).
  //
  // Reutiliza los mismos emitCalendarSync/emitPaymentCharge privados que
  // create()/correct() -- una consulta creada por reserva pública recibe
  // exactamente el mismo push a Google Calendar y el mismo cargo
  // fire-and-forget que una creada por el terapeuta (calendar-sync spec.md
  // "Publicly booked consultation pushes a new event", tasks.md 3.9).
  //
  // emitPaymentCharge() sigue sin esperarse (fire-and-forget): un fallo o demora
  // de Flow/Google jamás puede bloquear ni revertir esta reserva. Issue #299: la
  // respuesta ya no incluye checkoutUrl -- el frontend lo obtiene por polling
  // (GET .../book/:groupId/checkout).
  // Issue #176: sin chequeo de consentimiento a propósito. Es un agendamiento,
  // no un inicio de tratamiento: nace con texto genérico y sin datos clínicos.
  // Los datos clínicos solo entran por correct(), que sí exige consentimiento.
  async createFromPublicBooking(
    therapistId: string,
    patientId: string,
    patientRut: string,
    slotStart: Date,
    sessionDurationMinutes: number,
    client?: Prisma.TransactionClient,
  ): Promise<PublicBookingConfirmation> {
    const slotEnd = new Date(
      slotStart.getTime() + sessionDurationMinutes * 60000,
    );
    const id = randomUUID();

    const write = async (tx: Prisma.TransactionClient) => {
      // issue #285: lock compartido sobre el paciente, contrapartida del FOR
      // UPDATE de PatientsService.softDelete -- evita que un soft-delete
      // concurrente deje un BookedSlot huérfano. Si el paciente ya fue
      // eliminado, el horario no se reserva.
      const lockedPatient = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Patient"
        WHERE id = ${patientId} AND "deletedAt" IS NULL
        FOR SHARE`;
      if (lockedPatient.length === 0) {
        throw new ConflictException(
          'El horario seleccionado ya no está disponible.',
        );
      }

      // issue #285/#336: solape de intervalos [sessionDate, +durationMinutes)
      // de cada consulta existente contra [slotStart, slotEnd): una sesión que
      // empezó antes pero termina después de slotStart también ocupa el
      // horario. Cada fila trae su propia duración, así que se traen los
      // candidatos de la ventana (hasta MAX_SESSION_MINUTES hacia atrás) y el
      // solape exacto (existing.end > slotStart) se decide aquí.
      const candidates = await tx.consultation.findMany({
        where: {
          therapistId,
          correctedBy: null,
          deletedAt: null,
          patient: { deletedAt: null },
          sessionDate: {
            gt: new Date(slotStart.getTime() - MAX_SESSION_MINUTES * 60000),
            lt: slotEnd,
          },
        },
        select: { sessionDate: true, durationMinutes: true },
      });
      const conflicting = candidates.some(
        (c) =>
          c.sessionDate.getTime() + c.durationMinutes * 60000 >
          slotStart.getTime(),
      );
      if (conflicting) {
        throw new ConflictException(
          'El horario seleccionado ya no está disponible.',
        );
      }

      await tx.bookedSlot.create({
        data: { therapistId, groupId: id, slotStart },
      });

      return tx.consultation.create({
        data: {
          id,
          groupId: id,
          patientId,
          therapistId,
          sessionDate: slotStart,
          durationMinutes: sessionDurationMinutes,
          consultReason: 'Reserva pública en línea',
          intervention: 'Pendiente de definir por el terapeuta',
          sessionType: 'IN_PERSON',
          scheduledAt: slotStart,
          patientRut,
        },
      });
    };

    let consultation: Consultation;
    try {
      consultation = client
        ? await write(client)
        : await this.prisma.$transaction(write);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'El horario seleccionado ya no está disponible.',
        );
      }
      throw err;
    }

    // Issue #299: con `client` el llamador es dueño de la transacción y debe
    // invocar afterPublicBookingCommit() recién tras el commit -- emitir el
    // sync/cobro antes dejaría que corran sobre una fila que todavía no es
    // visible (o que después se revierte).
    if (!client) {
      this.afterPublicBookingCommit(consultation.id, therapistId);
    }

    // Issue #299: la respuesta llega a un llamador anónimo -- solo id y
    // sessionDate, nunca la fila completa (patientId, patientRut, therapistId).
    return { id: consultation.id, sessionDate: consultation.sessionDate };
  }

  // Efectos posteriores al commit de una reserva pública (log + sync a Google
  // Calendar + cobro fire-and-forget). Público para que
  // PublicSchedulingService lo invoque tras su propia transacción.
  afterPublicBookingCommit(groupId: string, therapistId: string): void {
    this.logger.log(
      `Consulta creada vía reserva pública: id=${groupId} therapistId=${therapistId}`,
    );
    // issue #285: ya con el commit visible, el slot reservado deja de
    // ofrecerse desde el cache.
    this.availabilityService.invalidate(therapistId);
    this.emitCalendarSync(groupId);
    this.emitPaymentCharge(groupId);
  }

  // design.md "Sync badge resolved in the same response, via in-memory map":
  // CalendarEventLink no tiene FK a Consultation (se relaciona con
  // GoogleCalendarConnection + un groupId suelto), así que un `include` de
  // Prisma es imposible -- una sola query extra mapeada por groupId, mismo
  // patrón anti-N+1 que historyMap en findByPatient.
  private async getSyncStatusMap(
    therapistId: string,
    groupIds: string[],
  ): Promise<Map<string, CalendarSyncStatus>> {
    const links = await this.prisma.calendarEventLink.findMany({
      where: { connection: { therapistId }, groupId: { in: groupIds } },
      select: { groupId: true, syncStatus: true },
    });

    const map = new Map<string, CalendarSyncStatus>();
    for (const link of links) map.set(link.groupId, link.syncStatus);
    return map;
  }

  // issue #163: ReminderDispatch no tiene FK a Consultation por groupId
  // directamente consultable con un include -- una sola query extra
  // mapeada por groupId, mismo patrón anti-N+1 que getPaymentMap/
  // getSyncStatusMap. orderBy: createdAt desc + "solo setear la primera vez
  // que se ve ese groupId" se queda con el dispatch EMAIL más reciente
  // (a lo sumo hay uno por offset, pero puede haber varios offsets --
  // H24/H2 -- para la misma consulta).
  private async getReminderEmailStatusMap(groupIds: string[]): Promise<
    Map<
      string,
      {
        status: ReminderDispatchStatus;
        deliveredAt: Date | null;
        openedAt: Date | null;
      }
    >
  > {
    const map = new Map<
      string,
      {
        status: ReminderDispatchStatus;
        deliveredAt: Date | null;
        openedAt: Date | null;
      }
    >();
    if (groupIds.length === 0) return map;

    const dispatches = await this.prisma.reminderDispatch.findMany({
      where: { groupId: { in: groupIds }, channel: ReminderChannel.EMAIL },
      orderBy: { createdAt: 'desc' },
      select: {
        groupId: true,
        status: true,
        deliveredAt: true,
        openedAt: true,
      },
    });

    for (const dispatch of dispatches) {
      if (map.has(dispatch.groupId)) continue;
      map.set(dispatch.groupId, {
        status: dispatch.status,
        deliveredAt: dispatch.deliveredAt,
        openedAt: dispatch.openedAt,
      });
    }
    return map;
  }
}
