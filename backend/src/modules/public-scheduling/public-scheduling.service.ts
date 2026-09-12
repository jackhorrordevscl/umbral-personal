import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentAccountStatus } from '@prisma/client';
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

// sdd/public-booking-payment-calendar PR 5 (tasks.md 5.1, design.md
// "Interfaces / Contracts", Decision 5 "Checkout is polled, not awaited"):
// NOT_APPLICABLE le dice al cliente que ni siquiera empiece a hacer polling
// -- nunca va a aparecer un paymentUrl para esta reserva. PENDING solo
// significa "puede que aparezca"; ensureCharge() sigue siendo
// fire-and-forget y puede terminar sin crear ningún Payment igual (p.ej. si
// Flow rechaza la orden), el poll simplemente se agota en ese caso.
export type CheckoutHint = { status: 'PENDING' } | { status: 'NOT_APPLICABLE' };

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
  private readonly checkoutInlineEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
    private readonly patientsService: PatientsService,
    private readonly consultationsService: ConsultationsService,
  ) {
    this.enabled =
      this.config.get<string>('PUBLIC_SCHEDULING_ENABLED') === 'true';
    // sdd/public-booking-payment-calendar PR 5 (tasks.md 5.1, design.md
    // "Migration / Rollout"): mismo criterio opt-in `=== 'true'` que
    // CALENDAR_AVAILABILITY_OVERLAY_ENABLED (PR 2) -- no el `!== 'false'`
    // default-on de los módulos de sync más viejos.
    this.checkoutInlineEnabled =
      this.config.get<string>('PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED') ===
      'true';
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

    const consultation =
      await this.consultationsService.createFromPublicBooking(
        therapistId,
        patient.id,
        patient.rut,
        slotStart,
        sessionDurationMinutes,
      );

    if (!this.checkoutInlineEnabled) {
      return consultation;
    }

    const checkout = await this.resolveCheckoutHint(
      therapistId,
      patient.defaultSessionAmount,
    );
    return { ...consultation, checkout };
  }

  // sdd/public-booking-payment-calendar PR 5 (tasks.md 5.1, spec.md
  // "Booking succeeds and carries a checkout URL when available" /
  // "...without a checkout URL when payment is unavailable"): a esta altura
  // ensureCharge() todavía no corrió (fire-and-forget, ver
  // consultations.service.ts createFromPublicBooking) -- este hint nunca
  // lee Payment, solo decide si vale la pena que el cliente empiece a
  // pollear GET .../checkout (PENDING) o directamente no lo intente
  // (NOT_APPLICABLE), sin agregar ni un tick de latencia a la respuesta de
  // reserva.
  //
  // known-issue (design.md Open Questions, tasks.md 6.4): un paciente
  // público NUEVO (autocreado por resolveForPublicBooking) nunca tiene
  // defaultSessionAmount -- PatientsService lo excluye a propósito de la
  // creación pública (ver public-booking-patient.dto.ts) -- así que cae acá
  // en NOT_APPLICABLE por monto no resolvible y ensureCharge() jamás genera
  // un cargo para él. Solo un paciente YA existente (matcheado por email)
  // puede llegar a PENDING. Fuera de alcance resolverlo en esta release.
  private async resolveCheckoutHint(
    therapistId: string,
    defaultSessionAmount: number | null,
  ): Promise<CheckoutHint> {
    if (defaultSessionAmount === null || defaultSessionAmount === undefined) {
      return { status: 'NOT_APPLICABLE' };
    }

    // Lectura directa de PaymentAccount.status en vez de
    // PaymentAccountService.resolveGatewayContext(): esta última desencripta
    // las credenciales del gateway (trabajo real de CPU/crypto) solo para
    // devolver un contexto que acá ni se usa -- lo único que importa es el
    // status. Evita ese costo en una ruta pública no autenticada.
    const account = await this.prisma.paymentAccount.findUnique({
      where: { therapistId },
      select: { status: true },
    });
    if (account?.status !== PaymentAccountStatus.CONNECTED) {
      return { status: 'NOT_APPLICABLE' };
    }

    return { status: 'PENDING' };
  }
}
