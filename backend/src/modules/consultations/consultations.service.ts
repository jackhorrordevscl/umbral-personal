import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CalendarSyncStatus, Prisma, SessionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { CorrectConsultationDto } from './dto/correct-consultation.dto';
import { ConsultationRangeQueryDto } from './dto/consultation-range-query.dto';
import { toJsonSnapshot } from '../../common/utils/json-clone.util';

function parseDate(dateStr: string): Date {
  if (dateStr.includes('T') || dateStr.includes(' ')) {
    return new Date(dateStr);
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
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
export interface CalendarSession {
  id: string;
  groupId: string;
  sessionDate: string;
  sessionType: SessionType;
  patientId: string;
  patientName: string;
  calendarSync: CalendarSyncStatus | null;
}

@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);

  constructor(
    private prisma: PrismaService,
    private patientsService: PatientsService,
    private calendarSync: CalendarSyncService,
    private paymentsService: PaymentsService,
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

    const consultation = await this.prisma.consultation.create({
      data: {
        id,
        groupId: id,
        patientId: dto.patientId,
        therapistId,
        sessionDate: parseDate(dto.sessionDate),
        consultReason: dto.consultReason,
        intervention: dto.intervention,
        agreements: dto.agreements,
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
    this.logger.log(
      `Consulta creada: id=${consultation.id} patientId=${dto.patientId} therapistId=${therapistId}`,
    );
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

    // Solo la versión vigente de cada consulta (correctedBy: null = nadie la corrigió después)
    const [consultations, total] = await Promise.all([
      this.prisma.consultation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: THERAPIST_SELECT,
        ...(isPaginated ? { take: pageSize, skip: (page - 1) * pageSize } : {}),
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

    const data = consultations.map((c) => ({
      ...c,
      history: historyMap.get(c.groupId) ?? [],
      payment: paymentMap.get(c.groupId) ?? null,
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
      },
    });
    for (const payment of payments) {
      map.set(payment.groupId, {
        groupId: payment.groupId,
        status: payment.status,
        linkDelivery: payment.linkDelivery,
        paymentUrl: payment.paymentUrl,
        amount: payment.amount,
      });
    }
    return map;
  }

  // Issue #40: 2 queries de agregación en vez de traer todas las filas.
  async getStats(therapistId: string) {
    const baseWhere = { therapistId, correctedBy: null, deletedAt: null };
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
          consultReason: dto.consultReason ?? original.consultReason,
          intervention: dto.intervention ?? original.intervention,
          agreements: dto.agreements ?? original.agreements,
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

      return {
        ...corrected,
        history: await this.getHistory(original.groupId, tx),
      };
    });
    this.logger.log(
      `Consulta corregida: originalId=${id} nuevaId=${result.id} groupId=${original.groupId} therapistId=${therapistId}`,
    );
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

    return consultations.map((c) => ({
      id: c.id,
      groupId: c.groupId,
      sessionDate: c.sessionDate.toISOString(),
      sessionType: c.sessionType,
      patientId: c.patientId,
      patientName: c.patient.fullName,
      calendarSync: syncMap.get(c.groupId) ?? null,
    }));
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
}
