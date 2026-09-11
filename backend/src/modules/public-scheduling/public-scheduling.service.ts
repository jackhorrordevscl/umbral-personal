import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AvailabilityService,
  AvailableSlot,
} from '../availability/availability.service';
import { PatientsService } from '../patients/patients.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { DEFAULT_SESSION_MINUTES } from '../calendar-integration/calendar-integration.constants';
import { PublicAvailabilityQueryDto } from './dto/public-availability-query.dto';
import { BookPublicSlotDto } from './dto/book-public-slot.dto';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.6): mismo tope que
// consultations.service.ts findByRange (62 días, con margen para el grid
// completo), pero acá el límite de negocio real es el horizonte de reserva
// de design.md ("60-day maximum horizon") -- una consulta de disponibilidad
// que pida más de 60 días no tiene sentido: ningún slot más allá de ese
// horizonte podría reservarse igual (computeSlots ya lo filtra por slot,
// esto rechaza el request completo antes de tocar la DB).
const MAX_QUERY_SPAN_DAYS = 60;
const MAX_QUERY_SPAN_MS = MAX_QUERY_SPAN_DAYS * 24 * 60 * 60 * 1000;

// sdd/patient-self-scheduling PR 3 (tasks.md 3.6, design.md "Data Flow" +
// "Migration / Rollout"): orquesta AvailabilityService (lectura +
// recheck previo a escribir) + PatientsService.resolveForPublicBooking +
// ConsultationsService.createFromPublicBooking, gateado por un único flag
// (PUBLIC_SCHEDULING_ENABLED) que cubre ambos endpoints -- no hay valor en
// dejar la lectura pública mientras la reserva está deshabilitada.
@Injectable()
export class PublicSchedulingService {
  private readonly logger = new Logger(PublicSchedulingService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
    private readonly patientsService: PatientsService,
    private readonly consultationsService: ConsultationsService,
  ) {
    this.enabled =
      this.config.get<string>('PUBLIC_SCHEDULING_ENABLED') === 'true';
  }

  // Mismo criterio que CalendarOauthService.assertEnabled: 503, no 404 --
  // la ruta existe, la funcionalidad está apagada por config.
  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'La agenda pública no está disponible.',
      );
    }
  }

  async getAvailability(
    therapistId: string,
    query: PublicAvailabilityQueryDto,
  ): Promise<AvailableSlot[]> {
    this.assertEnabled();

    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException(
        'El rango solicitado es inválido: "to" debe ser posterior a "from".',
      );
    }
    if (to.getTime() - from.getTime() > MAX_QUERY_SPAN_MS) {
      throw new BadRequestException(
        `El rango solicitado no puede superar ${MAX_QUERY_SPAN_DAYS} días.`,
      );
    }

    return this.availabilityService.computeSlots(therapistId, from, to);
  }

  async book(therapistId: string, dto: BookPublicSlotDto) {
    this.assertEnabled();

    const therapist = await this.prisma.user.findUnique({
      where: { id: therapistId },
      select: { sessionDurationMinutes: true },
    });
    if (!therapist) {
      throw new NotFoundException('Terapeuta no encontrado.');
    }
    const sessionDurationMinutes =
      therapist.sessionDurationMinutes ?? DEFAULT_SESSION_MINUTES;

    const slotStart = new Date(dto.slotStart);
    const slotEnd = new Date(
      slotStart.getTime() + sessionDurationMinutes * 60000,
    );

    // spec.md "Stale cached slot is rejected at write time": recheck contra
    // el estado ACTUAL de disponibilidad (24h/60d, blockouts, feriados,
    // ocupación) antes de resolver al paciente o escribir nada. Esto cubre
    // "Booking a slot outside the booking window fails" (lead time) además
    // del caso de cache stale -- ambos son, desde afuera, "este slot ya no
    // está disponible", mismo 409. El guard real de concurrencia contra otra
    // reserva simultánea vive en ConsultationsService.createFromPublicBooking
    // (BookedSlot unique constraint, design.md Decision 1).
    const freeSlots = await this.availabilityService.computeSlots(
      therapistId,
      slotStart,
      slotEnd,
    );
    const isStillFree = freeSlots.some(
      (slot) =>
        slot.start === slotStart.toISOString() &&
        slot.end === slotEnd.toISOString(),
    );
    if (!isStillFree) {
      throw new ConflictException(
        'El horario seleccionado ya no está disponible.',
      );
    }

    const patient = await this.patientsService.resolveForPublicBooking(
      therapistId,
      dto.patient,
    );

    return this.consultationsService.createFromPublicBooking(
      therapistId,
      patient.id,
      patient.rut,
      slotStart,
      sessionDurationMinutes,
    );
  }
}
