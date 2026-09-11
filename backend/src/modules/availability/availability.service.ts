import { Injectable, NotFoundException } from '@nestjs/common';
import { AvailabilityBlockout } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_SESSION_MINUTES } from '../calendar-integration/calendar-integration.constants';
import {
  addDaysToDayKey,
  chileDayKeyFromInstant,
  chileWallTimeToInstant,
  dateOnlyDayKey,
  isoWeekdayFromDayKey,
} from '../../common/utils/chile-time.util';
import { ScheduleEntryDto } from './dto/schedule-entry.dto';
import { ScheduleUpdateDto } from './dto/schedule-update.dto';
import { CreateBlockoutDto } from './dto/create-blockout.dto';

// sdd/patient-self-scheduling PR 2 (design.md "Slot grid" + spec.md "Booking
// Window Bounds"): fijos, no configurables por el MVP.
const MIN_LEAD_TIME_MS = 24 * 60 * 60 * 1000;
const MAX_HORIZON_MS = 60 * 24 * 60 * 60 * 1000;

// design.md Decision 6 "Cache": Map en proceso, ~5 min de TTL por
// terapeuta+rango, versión incrementada en cada escritura de reglas/reservas.
const SLOT_CACHE_TTL_MS = 5 * 60 * 1000;

export interface AvailableSlot {
  start: string; // instante ISO (UTC)
  end: string;
}

export interface WeeklyRuleInput {
  dayOfWeek: number; // 1=lunes .. 7=domingo (ISO)
  startMinute: number;
  endMinute: number;
}

export interface BlockoutInput {
  startsAt: Date; // [startsAt, endsAt) -- design.md Decision 4
  endsAt: Date;
}

export interface OccupiedConsultationInput {
  sessionDate: Date;
}

export interface ComputeAvailableSlotsInput {
  from: Date; // instante ISO, inclusive
  to: Date; // instante ISO, exclusivo (half-open, mismo criterio que frontend)
  now: Date;
  sessionDurationMinutes: number;
  weeklyRules: WeeklyRuleInput[];
  blockouts: BlockoutInput[];
  holidayDayKeys: Set<string>; // 'YYYY-MM-DD'
  occupiedConsultations: OccupiedConsultationInput[];
}

// design.md "Slot grid": for (t = startMinute; t + duration <= endMinute; t
// += duration) -- expande la regla semanal día a día sobre el rango pedido,
// resta feriados/blockouts/consultas, y aplica los límites de 24h/60d.
// Función pura -- sin I/O, testeable con reloj fijo (Testing Strategy).
export function computeAvailableSlots(
  input: ComputeAvailableSlotsInput,
): AvailableSlot[] {
  const {
    from,
    to,
    now,
    sessionDurationMinutes,
    weeklyRules,
    blockouts,
    holidayDayKeys,
    occupiedConsultations,
  } = input;

  const lowerBoundMs = Math.max(
    from.getTime(),
    now.getTime() + MIN_LEAD_TIME_MS,
  );
  const upperBoundMs = Math.min(to.getTime(), now.getTime() + MAX_HORIZON_MS);
  if (lowerBoundMs >= upperBoundMs) return [];

  const rulesByWeekday = new Map<number, WeeklyRuleInput[]>();
  for (const rule of weeklyRules) {
    const list = rulesByWeekday.get(rule.dayOfWeek) ?? [];
    list.push(rule);
    rulesByWeekday.set(rule.dayOfWeek, list);
  }

  const slots: AvailableSlot[] = [];
  const lastDayKey = chileDayKeyFromInstant(new Date(to.getTime() - 1));
  let dayKey = chileDayKeyFromInstant(from);

  while (true) {
    if (holidayDayKeys.has(dayKey)) {
      if (dayKey === lastDayKey) break;
      dayKey = addDaysToDayKey(dayKey, 1);
      continue;
    }

    const weekday = isoWeekdayFromDayKey(dayKey);
    const rules = rulesByWeekday.get(weekday) ?? [];

    for (const rule of rules) {
      for (
        let minute = rule.startMinute;
        minute + sessionDurationMinutes <= rule.endMinute;
        minute += sessionDurationMinutes
      ) {
        const start = chileWallTimeToInstant(dayKey, minute);
        // DST spring-forward gap: esa hora de reloj de pared nunca existe --
        // se omite en vez de romper (design.md "DST-nonexistent times are
        // skipped").
        if (start === null) continue;

        const startMs = start.getTime();
        if (startMs < from.getTime() || startMs >= to.getTime()) continue;
        if (startMs < lowerBoundMs || startMs >= upperBoundMs) continue;

        const end = new Date(startMs + sessionDurationMinutes * 60000);

        const isBlocked = blockouts.some(
          (b) =>
            b.startsAt.getTime() < end.getTime() &&
            b.endsAt.getTime() > startMs,
        );
        if (isBlocked) continue;

        const isOccupied = occupiedConsultations.some(
          (c) =>
            c.sessionDate.getTime() >= startMs &&
            c.sessionDate.getTime() < end.getTime(),
        );
        if (isOccupied) continue;

        slots.push({ start: start.toISOString(), end: end.toISOString() });
      }
    }

    if (dayKey === lastDayKey) break;
    dayKey = addDaysToDayKey(dayKey, 1);
  }

  return slots;
}

@Injectable()
export class AvailabilityService {
  private readonly cache = new Map<
    string,
    { slots: AvailableSlot[]; expiresAt: number }
  >();
  private readonly versions = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  // design.md Decision 6: versión por terapeuta, incrementada en cada
  // escritura de reglas/blockouts/reservas -- invalida todas las entradas de
  // cache de ese terapeuta sin esperar el TTL.
  invalidate(therapistId: string): void {
    this.versions.set(therapistId, (this.versions.get(therapistId) ?? 0) + 1);
  }

  private cacheKey(therapistId: string, from: Date, to: Date): string {
    const version = this.versions.get(therapistId) ?? 0;
    return `${therapistId}|${version}|${from.toISOString()}|${to.toISOString()}`;
  }

  async computeSlots(
    therapistId: string,
    from: Date,
    to: Date,
    now: Date = new Date(),
  ): Promise<AvailableSlot[]> {
    const key = this.cacheKey(therapistId, from, to);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now.getTime()) {
      return cached.slots;
    }

    const [therapist, weeklyRules, blockouts, holidays, occupiedConsultations] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: therapistId },
          select: { sessionDurationMinutes: true },
        }),
        this.prisma.therapistAvailability.findMany({
          where: { therapistId },
          select: { dayOfWeek: true, startMinute: true, endMinute: true },
        }),
        this.prisma.availabilityBlockout.findMany({
          where: { therapistId, startsAt: { lt: to }, endsAt: { gt: from } },
          select: { startsAt: true, endsAt: true },
        }),
        // Sin scoping por rango: la tabla de feriados es global y pequeña
        // (design.md "Chile Public Holidays" -- un puñado de filas por año),
        // así que traerla completa evita tener que traducir el rango de
        // instantes a límites de columna @db.Date.
        this.prisma.publicHoliday.findMany({ select: { date: true } }),
        // design.md Decision 2 "Occupancy read": mismo predicado que
        // consultations.service.ts findByRange (correctedBy: null, deletedAt:
        // null, sessionDate dentro del rango).
        this.prisma.consultation.findMany({
          where: {
            therapistId,
            correctedBy: null,
            deletedAt: null,
            sessionDate: { gte: from, lt: to },
          },
          select: { sessionDate: true },
        }),
      ]);

    const sessionDurationMinutes =
      therapist?.sessionDurationMinutes ?? DEFAULT_SESSION_MINUTES;
    const holidayDayKeys = new Set(
      holidays.map((h: { date: Date }) => dateOnlyDayKey(h.date)),
    );

    const slots = computeAvailableSlots({
      from,
      to,
      now,
      sessionDurationMinutes,
      weeklyRules,
      blockouts,
      holidayDayKeys,
      occupiedConsultations,
    });

    this.cache.set(key, {
      slots,
      expiresAt: now.getTime() + SLOT_CACHE_TTL_MS,
    });
    return slots;
  }

  // tasks.md 2.4: respalda GET /availability/schedule -- la grilla semanal
  // vigente + la duración de sesión configurada (design.md Decision 8
  // "Duration ownership").
  async getSchedule(therapistId: string): Promise<{
    sessionDurationMinutes: number;
    entries: Array<{
      id: string;
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
    }>;
  }> {
    const [therapist, entries] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: therapistId },
        select: { sessionDurationMinutes: true },
      }),
      this.prisma.therapistAvailability.findMany({
        where: { therapistId },
        select: {
          id: true,
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
        },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      }),
    ]);

    return {
      sessionDurationMinutes:
        therapist?.sessionDurationMinutes ?? DEFAULT_SESSION_MINUTES,
      entries,
    };
  }

  // tasks.md 2.4: respalda PUT /availability/schedule -- reemplaza la
  // grilla completa y actualiza sessionDurationMinutes en una sola
  // transacción (design.md Decision 8: "un grid guardado contra una
  // duración vieja quedaría incoherente"). Reemplazo total (delete + create)
  // en vez de diffing: la grilla no tiene identidad estable en el cliente
  // (el editor de Profile, PR 4, siempre manda el estado completo).
  async saveSchedule(
    therapistId: string,
    dto:
      | ScheduleUpdateDto
      | { sessionDurationMinutes: number; entries: ScheduleEntryDto[] },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.therapistAvailability.deleteMany({
        where: { therapistId },
      });
      if (dto.entries.length > 0) {
        await tx.therapistAvailability.createMany({
          data: dto.entries.map((entry) => ({
            therapistId,
            dayOfWeek: entry.dayOfWeek,
            startMinute: entry.startMinute,
            endMinute: entry.endMinute,
          })),
        });
      }
      await tx.user.update({
        where: { id: therapistId },
        data: { sessionDurationMinutes: dto.sessionDurationMinutes },
      });
    });
    this.invalidate(therapistId);
  }

  // tasks.md 2.4: respalda GET /availability/blockouts.
  async listBlockouts(therapistId: string): Promise<AvailabilityBlockout[]> {
    return this.prisma.availabilityBlockout.findMany({
      where: { therapistId },
      orderBy: { startsAt: 'asc' },
    });
  }

  // tasks.md 2.4: respalda POST /availability/blockouts.
  async createBlockout(
    therapistId: string,
    dto: CreateBlockoutDto,
  ): Promise<AvailabilityBlockout> {
    const created = await this.prisma.availabilityBlockout.create({
      data: { ...dto, therapistId },
    });
    this.invalidate(therapistId);
    return created;
  }

  // tasks.md 2.4: respalda DELETE /availability/blockouts/:id. Mismo
  // criterio de ownership que PatientsService.assertAccess: NotFoundException
  // uniforme tanto si el id no existe como si pertenece a otro terapeuta, sin
  // distinguir los dos casos hacia afuera.
  async deleteBlockout(id: string, therapistId: string): Promise<void> {
    const blockout = await this.prisma.availabilityBlockout.findFirst({
      where: { id, therapistId },
      select: { id: true },
    });
    if (!blockout) throw new NotFoundException('Bloqueo no encontrado');

    await this.prisma.availabilityBlockout.delete({ where: { id } });
    this.invalidate(therapistId);
  }
}
