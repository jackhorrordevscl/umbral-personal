import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicSchedulingService } from './public-scheduling.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { PatientsService } from '../patients/patients.service';
import { ConsultationsService } from '../consultations/consultations.service';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.6, design.md "Data Flow"):
// orquesta AvailabilityService.computeSlots (lectura + rewrite del recheck
// de disponibilidad antes de reservar) + PatientsService.resolveForPublicBooking
// + ConsultationsService.createFromPublicBooking, gateado por
// PUBLIC_SCHEDULING_ENABLED (design.md "Migration / Rollout": un solo flag
// para ambos endpoints).
describe('PublicSchedulingService', () => {
  let service: PublicSchedulingService;
  let prisma: {
    user: { findUnique: jest.Mock };
    paymentAccount: { findUnique: jest.Mock };
  };
  let availabilityService: { computeSlots: jest.Mock };
  let patientsService: { resolveForPublicBooking: jest.Mock };
  let consultationsService: { createFromPublicBooking: jest.Mock };

  function buildService(
    enabled = true,
    checkoutInlineEnabled = false,
  ): PublicSchedulingService {
    const config = {
      get: (key: string) => {
        if (key === 'PUBLIC_SCHEDULING_ENABLED') return String(enabled);
        if (key === 'PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED')
          return String(checkoutInlineEnabled);
        return undefined;
      },
    };
    return new PublicSchedulingService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
      availabilityService as unknown as AvailabilityService,
      patientsService as unknown as PatientsService,
      consultationsService as unknown as ConsultationsService,
    );
  }

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      paymentAccount: { findUnique: jest.fn() },
    };
    availabilityService = { computeSlots: jest.fn() };
    patientsService = { resolveForPublicBooking: jest.fn() };
    consultationsService = { createFromPublicBooking: jest.fn() };
    service = buildService(true);
  });

  describe('gate PUBLIC_SCHEDULING_ENABLED', () => {
    it('getAvailability lanza 503 si el flag está deshabilitado', async () => {
      service = buildService(false);
      await expect(
        service.getAvailability('therapist-1', {
          from: '2026-09-01T00:00:00-04:00',
          to: '2026-09-05T00:00:00-04:00',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('book lanza 503 si el flag está deshabilitado', async () => {
      service = buildService(false);
      await expect(
        service.book('therapist-1', {
          slotStart: '2026-09-05T13:00:00.000Z',
          patient: {
            fullName: 'Paciente',
            rut: '11.111.111-1',
            birthDate: '1990-01-01',
            email: 'paciente@ejemplo.cl',
          },
        } as never),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('getAvailability', () => {
    it('delega en AvailabilityService.computeSlots con el rango pedido', async () => {
      availabilityService.computeSlots.mockResolvedValue([
        { start: '2026-09-01T13:00:00.000Z', end: '2026-09-01T13:50:00.000Z' },
      ]);

      const result = await service.getAvailability('therapist-1', {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-09-05T00:00:00-04:00',
      });

      expect(result).toHaveLength(1);
      expect(availabilityService.computeSlots).toHaveBeenCalledWith(
        'therapist-1',
        new Date('2026-09-01T00:00:00-04:00'),
        new Date('2026-09-05T00:00:00-04:00'),
      );
    });

    it('rechaza un rango que supera los 60 días', async () => {
      await expect(
        service.getAvailability('therapist-1', {
          from: '2026-09-01T00:00:00-04:00',
          to: '2026-12-01T00:00:00-04:00',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(availabilityService.computeSlots).not.toHaveBeenCalled();
    });

    it('acepta un rango de exactamente 60 días', async () => {
      availabilityService.computeSlots.mockResolvedValue([]);
      await expect(
        service.getAvailability('therapist-1', {
          from: '2026-09-01T00:00:00-04:00',
          to: '2026-10-31T00:00:00-04:00',
        }),
      ).resolves.toEqual([]);
    });
  });

  describe('book', () => {
    const patientDto = {
      fullName: 'Paciente Público',
      rut: '11.111.111-1',
      birthDate: '1990-01-01',
      email: 'paciente@ejemplo.cl',
    };

    it('lanza 404 si el terapeuta no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.book('therapist-1', {
          slotStart: '2026-09-05T13:00:00.000Z',
          patient: patientDto,
        } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza con 409 si el slot ya no aparece libre en un recheck', async () => {
      prisma.user.findUnique.mockResolvedValue({ sessionDurationMinutes: 50 });
      availabilityService.computeSlots.mockResolvedValue([]);

      await expect(
        service.book('therapist-1', {
          slotStart: '2026-09-05T13:00:00.000Z',
          patient: patientDto,
        } as never),
      ).rejects.toThrow(ConflictException);
      expect(patientsService.resolveForPublicBooking).not.toHaveBeenCalled();
      expect(
        consultationsService.createFromPublicBooking,
      ).not.toHaveBeenCalled();
    });

    it('reserva exitosamente cuando el slot sigue libre: resuelve paciente y crea la consulta', async () => {
      prisma.user.findUnique.mockResolvedValue({ sessionDurationMinutes: 50 });
      availabilityService.computeSlots.mockResolvedValue([
        { start: '2026-09-05T13:00:00.000Z', end: '2026-09-05T13:50:00.000Z' },
      ]);
      const patient = { id: 'patient-1', rut: '11111111-1' };
      patientsService.resolveForPublicBooking.mockResolvedValue(patient);
      const consultation = { id: 'consultation-1', groupId: 'consultation-1' };
      consultationsService.createFromPublicBooking.mockResolvedValue(
        consultation,
      );

      const result = await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      expect(result).toBe(consultation);
      expect(patientsService.resolveForPublicBooking).toHaveBeenCalledWith(
        'therapist-1',
        patientDto,
      );
      expect(consultationsService.createFromPublicBooking).toHaveBeenCalledWith(
        'therapist-1',
        'patient-1',
        '11111111-1',
        new Date('2026-09-05T13:00:00.000Z'),
        50,
      );
    });

    // Triangulación: duración distinta -> slotEnd/tamaño de ventana de
    // recheck distintos, no hardcodeado.
    it('usa la duración configurada del terapeuta (no un valor fijo) para el recheck y la creación', async () => {
      prisma.user.findUnique.mockResolvedValue({ sessionDurationMinutes: 30 });
      availabilityService.computeSlots.mockResolvedValue([
        { start: '2026-09-05T13:00:00.000Z', end: '2026-09-05T13:30:00.000Z' },
      ]);
      patientsService.resolveForPublicBooking.mockResolvedValue({
        id: 'patient-1',
        rut: '11111111-1',
      });
      consultationsService.createFromPublicBooking.mockResolvedValue({
        id: 'c-1',
      });

      await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      expect(consultationsService.createFromPublicBooking).toHaveBeenCalledWith(
        'therapist-1',
        'patient-1',
        '11111111-1',
        new Date('2026-09-05T13:00:00.000Z'),
        30,
      );
    });
  });

  // sdd/public-booking-payment-calendar PR 5 (tasks.md 5.1, 5.6, spec.md
  // "Booking succeeds and carries a checkout URL when available" /
  // "...without a checkout URL when payment is unavailable"): el hint nunca
  // lee Payment -- solo PaymentAccount.status (leído directo por
  // performance, ver comentario en el service) y el defaultSessionAmount del
  // Patient ya resuelto por resolveForPublicBooking.
  describe('checkout hint (PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED)', () => {
    const patientDto = {
      fullName: 'Paciente Público',
      rut: '11.111.111-1',
      birthDate: '1990-01-01',
      email: 'paciente@ejemplo.cl',
    };

    function setUpSuccessfulBooking(patient: {
      id: string;
      rut: string;
      defaultSessionAmount: number | null;
    }): void {
      prisma.user.findUnique.mockResolvedValue({
        sessionDurationMinutes: 50,
      });
      availabilityService.computeSlots.mockResolvedValue([
        { start: '2026-09-05T13:00:00.000Z', end: '2026-09-05T13:50:00.000Z' },
      ]);
      patientsService.resolveForPublicBooking.mockResolvedValue(patient);
      consultationsService.createFromPublicBooking.mockResolvedValue({
        id: 'consultation-1',
        groupId: 'consultation-1',
        checkoutUrl: null,
      });
    }

    it('con el flag apagado (default), la respuesta NO trae campo "checkout" -- ni siquiera consulta PaymentAccount', async () => {
      service = buildService(true, false);
      setUpSuccessfulBooking({
        id: 'patient-1',
        rut: '11111111-1',
        defaultSessionAmount: 30000,
      });

      const result = await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      expect(result).not.toHaveProperty('checkout');
      expect(prisma.paymentAccount.findUnique).not.toHaveBeenCalled();
    });

    it('con el flag prendido y sin defaultSessionAmount (paciente nuevo autocreado): NOT_APPLICABLE, sin consultar PaymentAccount', async () => {
      service = buildService(true, true);
      setUpSuccessfulBooking({
        id: 'patient-1',
        rut: '11111111-1',
        defaultSessionAmount: null,
      });

      const result = await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      expect(result).toMatchObject({ checkout: { status: 'NOT_APPLICABLE' } });
      expect(prisma.paymentAccount.findUnique).not.toHaveBeenCalled();
    });

    it('con el flag prendido, monto resolvible pero PaymentAccount no CONNECTED: NOT_APPLICABLE', async () => {
      service = buildService(true, true);
      setUpSuccessfulBooking({
        id: 'patient-1',
        rut: '11111111-1',
        defaultSessionAmount: 30000,
      });
      prisma.paymentAccount.findUnique.mockResolvedValue({
        status: 'PENDING',
      });

      const result = await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      expect(result).toMatchObject({ checkout: { status: 'NOT_APPLICABLE' } });
      expect(prisma.paymentAccount.findUnique).toHaveBeenCalledWith({
        where: { therapistId: 'therapist-1' },
        select: { status: true },
      });
    });

    // Triangulación: sin fila de PaymentAccount (nunca se conectó) también
    // es NOT_APPLICABLE, mismo camino que una fila PENDING/DISCONNECTED --
    // no un caso especial ni un crash.
    it('con el flag prendido y sin ninguna fila de PaymentAccount: NOT_APPLICABLE', async () => {
      service = buildService(true, true);
      setUpSuccessfulBooking({
        id: 'patient-1',
        rut: '11111111-1',
        defaultSessionAmount: 30000,
      });
      prisma.paymentAccount.findUnique.mockResolvedValue(null);

      const result = await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      expect(result).toMatchObject({ checkout: { status: 'NOT_APPLICABLE' } });
    });

    it('con el flag prendido, monto resolvible y PaymentAccount CONNECTED: PENDING', async () => {
      service = buildService(true, true);
      setUpSuccessfulBooking({
        id: 'patient-1',
        rut: '11111111-1',
        defaultSessionAmount: 30000,
      });
      prisma.paymentAccount.findUnique.mockResolvedValue({
        status: 'CONNECTED',
      });

      const result = await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      expect(result).toMatchObject({ checkout: { status: 'PENDING' } });
    });
  });
});
