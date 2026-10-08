import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { PaymentsService } from '../payments/payments.service';
import { AvailabilityService } from '../availability/availability.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { RecordConsentDto } from './dto/record-consent.dto';
import { BulkDeclareConsentDto } from './dto/bulk-declare-consent.dto';
import { ConsentPurpose, Patient, Prisma } from '@prisma/client';
import { toJsonSnapshot } from '../../common/utils/json-clone.util';
import { UNPAGINATED_SAFETY_LIMIT } from '../../common/dto/pagination.dto';
import { DEFAULT_PATIENTS_PAGE_SIZE } from './dto/patients-query.dto';
import { isValidRut, normalizeRut } from '../../common/utils/rut.util';

// issue #157: origen de adquisición capturado en el frontend (referrer +
// utm_source) y pasado por PublicSchedulingService.book() ->
// resolveForPublicBooking(). Interfaz chica en vez de importar el DTO de
// public-scheduling/dto -- mismo criterio "no cycle" que
// PublicBookingPatientInput más abajo.
export interface PublicBookingOriginInput {
  source?: string;
  referrer?: string;
}

// issue #157: deriva la etiqueta de acquisitionSource a partir del origen
// capturado -- utm_source tal cual (truncado a 120 chars) si viene; si no,
// el hostname del referrer; si tampoco hay referrer válido, "directo".
function resolveAcquisitionSource(origin?: PublicBookingOriginInput): string {
  const source = origin?.source?.trim();
  if (source) return source.slice(0, 120);

  const referrer = origin?.referrer?.trim();
  if (referrer) {
    try {
      return new URL(referrer).hostname;
    } catch {
      // referrer no es una URL válida -- cae a "directo" abajo.
    }
  }

  return 'directo';
}

const MANUAL_ACQUISITION_LABEL = 'Registro manual';

function isDate(val: unknown): val is Date {
  return (
    val !== null &&
    val !== undefined &&
    Object.prototype.toString.call(val) === '[object Date]'
  );
}

// Forma canónica para comparar un valor entrante con el almacenado: null,
// undefined y '' son lo mismo; el RUT se compara normalizado y las fechas
// como instante ISO (el DTO manda 'YYYY-MM-DD', la DB devuelve Date).
function comparableValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (isDate(value)) return value.toISOString();
  if (key === 'rut' && typeof value === 'string') return normalizeRut(value);
  if (key === 'birthDate' && typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return typeof value === 'object'
    ? JSON.stringify(value)
    : String(value as string | number | boolean);
}

type ConsentStatusMap = Record<ConsentPurpose, boolean>;

function emptyConsentStatus(): ConsentStatusMap {
  return { TREATMENT: false, TELEMEDICINE: false };
}

@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private calendarSync: CalendarSyncService,
    private paymentsService: PaymentsService,
    private availabilityService: AvailabilityService,
  ) {}

  // Issue #176: no exige consentimiento vigente a propósito. La Ley 20.584
  // lo exige antes del tratamiento, no antes de la ficha administrativa, y
  // recordConsent necesita un Patient existente. El gate vive en
  // ConsultationsService.create()/correct(), donde entran los datos clínicos.
  async create(dto: CreatePatientDto, therapistId: string) {
    const rut = normalizeRut(dto.rut);

    // Issue #314: la unicidad es por terapeuta, así el 409 solo revela fichas
    // propias y no permite sondear RUT de otros terapeutas.
    const existing = await this.prisma.patient.findFirst({
      // issue #285: el índice único es parcial (solo fichas activas), así que
      // el RUT de un paciente dado de baja puede recrearse.
      where: { therapistId, rut, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Ya existe un paciente con ese RUT');
    }

    const patient = await this.prisma.patient.create({
      data: {
        ...dto,
        rut,
        birthDate: new Date(dto.birthDate),
        therapistId,
      },
    });
    this.logger.log(
      `Paciente creado: id=${patient.id} therapistId=${therapistId}`,
    );
    return patient;
  }

  // T6.1 (issue #27): estado vigente de consentimiento por finalidad para un
  // lote de pacientes en una sola consulta (evita N+1 al listar). Toma la
  // última fila (por recordedAt) por (patientId, purpose) vía DISTINCT ON;
  // Prisma requiere que los campos de `distinct` encabecen el `orderBy` para
  // que el resultado sea determinístico.
  async getConsentStatusMap(
    patientIds: string[],
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, ConsentStatusMap>> {
    const map = new Map<string, ConsentStatusMap>();
    if (patientIds.length === 0) return map;

    const latestEvents = await client.patientConsent.findMany({
      where: { patientId: { in: patientIds } },
      distinct: ['patientId', 'purpose'],
      orderBy: [
        { patientId: 'asc' },
        { purpose: 'asc' },
        { recordedAt: 'desc' },
      ],
    });

    for (const id of patientIds) map.set(id, emptyConsentStatus());
    for (const event of latestEvents) {
      const status = map.get(event.patientId) ?? emptyConsentStatus();
      status[event.purpose] = event.action === 'GRANT';
      map.set(event.patientId, status);
    }
    return map;
  }

  // issue #290: siempre devuelve { data, total, page, pageSize }. Sin
  // page/pageSize usa la página 1 con DEFAULT_PATIENTS_PAGE_SIZE (el cliente
  // ve `total` y pagina; ya no hay corte silencioso). `search` filtra por
  // nombre y RUT en el servidor; el total respeta el mismo filtro.
  async findAll(
    userId: string,
    query?: { page?: number; pageSize?: number; search?: string },
  ) {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? DEFAULT_PATIENTS_PAGE_SIZE;
    const where: Prisma.PatientWhereInput = {
      therapistId: userId,
      deletedAt: null,
    };

    const term = query?.search?.trim();
    if (term) {
      const ids = await this.findIdsBySearch(userId, term);
      if (ids.length === 0) return { data: [], total: 0, page, pageSize };
      where.id = { in: ids };
    }

    const [patients, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.patient.count({ where }),
    ]);

    const consentMap = await this.getConsentStatusMap(
      patients.map((p) => p.id),
    );
    const data = patients.map((p) => ({
      ...p,
      consents: consentMap.get(p.id) ?? emptyConsentStatus(),
    }));

    return { data, total, page, pageSize };
  }

  // issue #402: busca por nombre sin distinguir tildes ni mayúsculas, y por
  // RUT con o sin puntos/guion. Se normaliza el término en JS y se resuelven
  // los ids con una consulta parametrizada, sin migración ni extensión de
  // PostgreSQL. `translate` va antes de `lower` para no depender del locale de
  // la DB; `position` evita escapar comodines de LIKE (% y _ son literales).
  // El RUT se guarda en mayúscula y con guion (12345678-K).
  private async findIdsBySearch(
    userId: string,
    term: string,
  ): Promise<string[]> {
    const nameTerm = term.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const rutCandidate = term.replace(/[.\-\s]/g, '').toUpperCase();
    const rutTerm = /^[\dK]+$/.test(rutCandidate) ? rutCandidate : null;

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "Patient"
      WHERE "therapistId" = ${userId}
        AND "deletedAt" IS NULL
        AND (
          position(${nameTerm} in lower(translate(
            "fullName",
            'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ',
            'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'
          ))) > 0
          OR position(${rutTerm}::text in replace("rut", '-', '')) > 0
        )
    `;
    return rows.map((r) => r.id);
  }

  // issue #290: contadores del dashboard sin traer la lista. withConsent =
  // pacientes activos cuyo último evento vigente es GRANT para TREATMENT o
  // TELEMEDICINE (misma regla que getConsentStatusMap: última fila por
  // (patientId, purpose) según recordedAt).
  async getSummary(
    userId: string,
  ): Promise<{ total: number; withConsent: number }> {
    const [total, rows] = await Promise.all([
      this.prisma.patient.count({
        where: { therapistId: userId, deletedAt: null },
      }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT latest."patientId") AS count
        FROM (
          SELECT DISTINCT ON (pc."patientId", pc."purpose")
            pc."patientId", pc."action"
          FROM "PatientConsent" pc
          JOIN "Patient" p ON p."id" = pc."patientId"
          WHERE p."therapistId" = ${userId} AND p."deletedAt" IS NULL
          ORDER BY pc."patientId", pc."purpose", pc."recordedAt" DESC
        ) latest
        WHERE latest."action" = 'GRANT'
      `,
    ]);
    return { total, withConsent: Number(rows[0]?.count ?? 0) };
  }

  // Guard de autorización liviano: solo confirma que `id` existe y pertenece
  // a `userId`, sin traer consultas/documentos/consentimientos. Para usarlo
  // en los módulos (consultations, documents, reports) que solo necesitan
  // validar acceso, no el detalle completo del paciente -- antes todos
  // pagaban el costo de `findOne` (joins + query de consentimientos) solo
  // para un chequeo de ownership.
  async assertAccess(
    id: string,
    userId: string,
  ): Promise<{ id: string; rut: string }> {
    const patient = await this.prisma.patient.findFirst({
      where: { id, therapistId: userId, deletedAt: null },
      select: { id: true, rut: true },
    });
    // NotFoundException uniforme tanto si el paciente no existe como si
    // pertenece a otro profesional: no distinguir evita filtrar (vía 403 vs
    // 404) que un id ajeno corresponde a un paciente real.
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    return patient;
  }

  async findOne(id: string, userId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id, therapistId: userId, deletedAt: null },
      include: {
        therapist: { select: { id: true, name: true } },
        // Solo la versión vigente de cada consulta (T2.3: corregir crea una
        // fila nueva en vez de sobrescribir, así que hay que excluir las
        // versiones ya superadas para no listar la misma consulta dos veces)
        consultations: {
          where: { correctedBy: null, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
        // issue #290: acotado con el cap de seguridad (las consultas no se
        // acotan: truncar el historial clínico en silencio sería peor)
        documents: {
          orderBy: { uploadedAt: 'desc' },
          take: UNPAGINATED_SAFETY_LIMIT,
        },
      },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    const consents =
      (await this.getConsentStatusMap([id])).get(id) ?? emptyConsentStatus();
    return { ...patient, consents };
  }

  async update(id: string, dto: UpdatePatientDto, userId: string) {
    // issue #290: solo columnas escalares de Patient (no consultas,
    // documentos ni consentimientos); el filtro de ownership es el mismo de
    // assertAccess/findOne y lanza el mismo 404 uniforme.
    const current = await this.prisma.patient.findFirst({
      where: { id, therapistId: userId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('Paciente no encontrado');

    const { reason, ...fields } = dto;

    // Calcular diff: solo campos que realmente cambian
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
      const incoming = fields[key];
      if (incoming === undefined) continue;

      const currentVal = (current as Record<string, unknown>)[
        key
      ] as typeof incoming;

      if (comparableValue(key, incoming) !== comparableValue(key, currentVal)) {
        diff[key] = { from: currentVal, to: incoming };
      }
    }

    // Sin cambios reales → no tocar la DB
    if (Object.keys(diff).length === 0) {
      return current;
    }

    // Issue #289: el DTO de edición solo valida la forma del RUT para no bloquear
    // fichas existentes con un DV inválido; el dígito verificador se exige solo
    // cuando el RUT realmente cambia.
    if (diff.rut && !isValidRut(fields.rut)) {
      throw new BadRequestException(
        'El dígito verificador del RUT no es válido',
      );
    }

    const updated = await this.prisma
      .$transaction(async (tx) => {
        await tx.patientHistory.create({
          data: {
            patientId: id,
            changedById: userId,
            reason,
            snapshot: toJsonSnapshot(current),
            diff: toJsonSnapshot(diff),
          },
        });

        return tx.patient.update({
          where: { id },
          data: {
            ...fields,
            ...(fields.rut && { rut: normalizeRut(fields.rut) }),
            ...(fields.birthDate && { birthDate: new Date(fields.birthDate) }),
          },
        });
      })
      .catch((err: unknown) => {
        // issue #317: índice único parcial (therapistId, rut) WHERE deletedAt IS
        // NULL -- la colisión solo ocurre contra otro paciente ACTIVO del mismo
        // terapeuta; la transacción ya hizo
        // rollback, así que no queda historial ni cambios parciales.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException('Ya existe un paciente con ese RUT');
        }
        throw err;
      });
    this.logger.log(
      `Paciente actualizado: id=${id} userId=${userId} campos=${Object.keys(diff).join(',')}`,
    );
    return updated;
  }

  async softDelete(id: string, userId: string) {
    await this.assertAccess(id, userId);
    // issue #285: las consultas del paciente dejan de ocupar el horario. Los
    // lectores (disponibilidad, calendario, stats) filtran por
    // patient.deletedAt, pero BookedSlot.@@unique seguiría bloqueando la
    // reserva del mismo horario: se libera en la misma transacción que el
    // soft-delete. No hay flujo de restauración de pacientes.
    const deleted = await this.prisma.$transaction(async (tx) => {
      // Lock de la fila del paciente (FOR UPDATE) antes de leer los grupos:
      // BookedSlot no tiene relación con Consultation, así que sin lock una
      // reserva pública que confirme entre el findMany y el deleteMany dejaría
      // un BookedSlot huérfano. createFromPublicBooking toma FOR SHARE sobre la
      // misma fila, lo que serializa ambos caminos: o la reserva commitea antes
      // (y su consulta se ve abajo) o espera, ve deletedAt y responde 409.
      await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${id} FOR UPDATE`;
      const groups = await tx.consultation.findMany({
        where: { patientId: id },
        select: { groupId: true },
        distinct: ['groupId'],
      });
      if (groups.length > 0) {
        await tx.bookedSlot.deleteMany({
          where: { groupId: { in: groups.map((g) => g.groupId) } },
        });
      }
      return tx.patient.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
    // issue #285: los BookedSlot liberados deben volver a ofrecerse de
    // inmediato, no tras los 5 min de vida del caché de slots.
    this.availabilityService.invalidate(userId);
    this.logger.log(
      `Paciente eliminado (soft delete): id=${id} userId=${userId}`,
    );

    // issue #110: cancela todo cargo PENDING/LATE del paciente eliminado --
    // sin esto quedaban en pie para el sweep cron (payments.service.ts) y
    // podían transicionar a PAID después de que el paciente ya no existe
    // (un checkout link vigente sigue siendo pagable en la pasarela). Se
    // espera (no fire-and-forget como el calendario, issue #111: el estado
    // financiero debe quedar resuelto antes de responder) pero un fallo acá
    // no debe impedir que el soft-delete se resuelva -- se loguea y sigue.
    await this.paymentsService
      .cancelUnpaidForPatient(id)
      .catch((err: unknown) => {
        this.logger.error(
          `Fallo al cancelar cargos pendientes para patientId=${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // design.md "Confirmed Decisions": único disparador real de borrado de
    // eventos de Google hoy (ningún endpoint escribe Consultation.deletedAt
    // todavía). Fire-and-forget, igual que ConsultationsService.create/
    // correct (spec.md "Non-Blocking Sync Failures").
    void this.calendarSync.deletePatientEvents(id).catch((err: unknown) => {
      this.logger.error(
        `Fallo no bloqueante al eliminar eventos de Google Calendar para patientId=${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return deleted;
  }

  async getHistory(id: string, userId: string) {
    await this.assertAccess(id, userId);

    return this.prisma.patientHistory.findMany({
      where: { patientId: id },
      include: {
        changedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { changedAt: 'desc' },
    });
  }

  // T6.1 (issue #27): registra un evento de otorgamiento/revocación para una
  // finalidad puntual.
  //
  // `documentId` solo lo fijan callers internos del servidor (DocumentsService,
  // issue #270); RecordConsentDto no lo acepta, así un cliente no puede
  // atribuir un evento a un documento arbitrario.
  async recordConsent(
    id: string,
    dto: RecordConsentDto,
    userId: string,
    documentId?: string,
  ) {
    await this.assertAccess(id, userId);

    return this.prisma.patientConsent.create({
      data: {
        patientId: id,
        purpose: dto.purpose,
        action: dto.action,
        recordedById: userId,
        evidence: dto.evidence,
        documentId: documentId ?? null,
      },
    });
  }

  // T5 (issue #131): declaración retroactiva en bloque para pacientes que
  // ya estaban en tratamiento antes de este cambio. `assertAccess` dentro de
  // `recordConsent` sigue corriendo por paciente -- nadie puede declarar
  // consentimiento sobre un paciente que no es suyo solo por mandarlo en el
  // mismo lote. Un id inválido/ajeno no aborta el resto del lote.
  async bulkDeclareConsent(dto: BulkDeclareConsentDto, userId: string) {
    const results: Array<{ patientId: string; ok: boolean; error?: string }> =
      [];
    for (const patientId of dto.patientIds) {
      try {
        await this.recordConsent(
          patientId,
          {
            purpose: dto.purpose,
            action: 'GRANT' as const,
            evidence: dto.evidence,
          },
          userId,
        );
        results.push({ patientId, ok: true });
      } catch (err) {
        // Review R3-002 (issue #131): solo se expone el mensaje cuando es
        // una HttpException conocida (ej. NotFoundException de assertAccess
        // -- paciente inexistente/ajeno). Cualquier otro error (ej. de DB)
        // se loguea server-side y responde genérico, para no filtrar detalle
        // interno en un endpoint que maneja datos de salud.
        const message =
          err instanceof HttpException
            ? err.message
            : 'No se pudo registrar el consentimiento para este paciente.';
        if (!(err instanceof HttpException)) {
          this.logger.error(
            `Fallo inesperado en bulkDeclareConsent (patientId=${patientId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        results.push({ patientId, ok: false, error: message });
      }
    }
    return results;
  }

  async getConsentLedger(id: string, userId: string) {
    await this.assertAccess(id, userId);

    return this.prisma.patientConsent.findMany({
      where: { patientId: id },
      include: {
        recordedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async getCurrentConsentStatus(
    id: string,
    userId: string,
  ): Promise<ConsentStatusMap> {
    await this.assertAccess(id, userId);
    return (
      (await this.getConsentStatusMap([id])).get(id) ?? emptyConsentStatus()
    );
  }

  // sdd/patient-self-scheduling PR 3 (tasks.md 3.4, design.md "Identity
  // resolution gotchas"): resuelve la identidad del paciente para una
  // reserva pública SIN autenticación ni OTP. Patient.rut es único POR
  // terapeuta (issue #314) -- un RUT registrado con otro terapeuta no
  // interfiere. Patient.email es nullable y NO único -- el match por email
  // es case-insensitive y scopeado a therapistId; más de un match es
  // ambiguo. Ambos casos (colisión de RUT con este terapeuta, email
  // ambiguo) devuelven el MISMO ConflictException uniforme, sin distinguir
  // hacia afuera cuál ocurrió.
  //
  // issue #139: devuelve { patient, isNew } (no solo Patient) para que el
  // caller (PublicSchedulingService.book()) pueda notificar al terapeuta
  // cuando el paciente se autocreó -- ese caso es el único donde
  // defaultSessionAmount queda null y ensureCharge() no genera cargo.
  async resolveForPublicBooking(
    therapistId: string,
    dto: PublicBookingPatientInput,
    origin?: PublicBookingOriginInput,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{ patient: Patient; isNew: boolean }> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const matches = await client.patient.findMany({
      where: {
        therapistId,
        deletedAt: null,
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
    });

    if (matches.length === 1) {
      // Issue #299 (opción A): el email por sí solo no prueba identidad --
      // quien conozca el email de un paciente podría reservar a su nombre. El
      // RUT enviado debe coincidir con el guardado; si no, el mismo 409
      // uniforme de los demás casos, sin revelar qué campo falló.
      if (normalizeRut(dto.rut) !== normalizeRut(matches[0].rut)) {
        this.logger.warn(
          `Reserva pública rechazada: identidad no verificada bajo therapistId=${therapistId}`,
        );
        throw new ConflictException('No fue posible procesar la reserva.');
      }
      return { patient: matches[0], isNew: false };
    }

    if (matches.length > 1) {
      // Nunca se loguea el email en texto plano (mismo criterio que el
      // tracker de PublicScheduleThrottlerGuard) -- solo el therapistId, que
      // ya identifica al profesional sin exponer al paciente.
      this.logger.warn(
        `Reserva pública ambigua: más de un paciente coincide por email bajo therapistId=${therapistId}`,
      );
      throw new ConflictException('No fue posible procesar la reserva.');
    }

    // Issue #289: el DTO público valida solo la forma del RUT para que un
    // paciente existente con un DV inválido guardado pueda autoagendarse (el
    // match de arriba compara por RUT normalizado). El DV se exige solo al crear
    // una ficha nueva. Mismo 409 uniforme que el resto del flujo: un 400 propio
    // acá permitiría distinguir si un email está registrado (endpoint anónimo).
    if (!isValidRut(dto.rut)) {
      this.logger.warn(
        `Reserva pública rechazada: RUT con dígito verificador inválido bajo therapistId=${therapistId}`,
      );
      throw new ConflictException('No fue posible procesar la reserva.');
    }

    const rut = normalizeRut(dto.rut);
    const existingRut = await client.patient.findFirst({
      where: { therapistId, rut, deletedAt: null },
      select: { id: true },
    });
    // Colisión de RUT con una ficha de ESTE terapeuta (no matcheó por email
    // arriba, p. ej. email distinto o ficha activa): 409 uniforme. Las fichas dadas de baja no cuentan (#285). Un
    // RUT registrado con otro terapeuta ya no colisiona (issue #314).
    if (existingRut) {
      throw new ConflictException('No fue posible procesar la reserva.');
    }

    // issue #199: el findUnique de arriba y este create no son atómicos, así
    // que dos reservas simultáneas del mismo paciente nuevo (doble click,
    // doble pestaña, reintento de red) pueden pasar ambas el chequeo. La
    // unicidad parcial de (therapistId, rut) es el guard real: la perdedora recibe P2002 y
    // se traduce al mismo 409 uniforme, nunca a un 500.
    try {
      const patient = await client.patient.create({
        data: {
          fullName: dto.fullName,
          rut,
          birthDate: new Date(dto.birthDate),
          occupation: dto.occupation,
          address: dto.address,
          phone: dto.phone,
          email: normalizedEmail,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          treatingPsychiatrist: dto.treatingPsychiatrist,
          treatingDoctor: dto.treatingDoctor,
          therapistId,
          // issue #157: solo se setean acá (creación autoagendada) --
          // pacientes creados por el terapeuta en la ficha completa quedan
          // null.
          acquisitionSource: resolveAcquisitionSource(origin),
          acquisitionReferrer: origin?.referrer ?? null,
        },
      });
      return { patient, isNew: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('No fue posible procesar la reserva.');
      }
      throw err;
    }
  }

  // issue #157: agregación en backend (mismo criterio que getStats en
  // consultations.service.ts, issue #40) para no traer todas las filas al
  // frontend. acquisitionSource null (pacientes creados antes de este
  // feature, o vía ficha del terapeuta) se etiqueta como "directo".
  async getAcquisitionStats(
    therapistId: string,
  ): Promise<Array<{ source: string; count: number }>> {
    const grouped = await this.prisma.patient.groupBy({
      by: ['acquisitionSource'],
      where: { therapistId, deletedAt: null },
      _count: true,
    });

    const counts = new Map<string, number>();
    for (const row of grouped) {
      // issue #401: null = paciente creado a mano (ver schema.prisma);
      // "directo" queda solo para reservas públicas sin origen ni referrer.
      const label = row.acquisitionSource ?? MANUAL_ACQUISITION_LABEL;
      counts.set(label, (counts.get(label) ?? 0) + row._count);
    }

    return Array.from(counts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
  }
}

// sdd/patient-self-scheduling PR 3 (tasks.md 3.4): shape estructural del
// formulario público reducido -- definido acá (en vez de importar el DTO de
// public-scheduling/dto) para que PatientsModule no dependa de
// PublicSchedulingModule; PublicBookingPatientDto (public-scheduling/dto)
// cumple esta interfaz por forma, sin import cruzado (design.md "no cycle").
// Excluye a propósito defaultSessionAmount, documentos y consentimientos
// (design.md "Creation explicitly omits defaultSessionAmount, documents, and
// consents").
export interface PublicBookingPatientInput {
  fullName: string;
  rut: string;
  birthDate: string;
  email: string;
  occupation?: string;
  address?: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  treatingPsychiatrist?: string;
  treatingDoctor?: string;
}
