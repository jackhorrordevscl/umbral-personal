import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { ThrottlerException } from '@nestjs/throttler';
import { PublicSchedulingService } from './public-scheduling.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { PatientsService } from '../patients/patients.service';
import { ConsultationsService } from '../consultations/consultations.service';
import {
  NotificationsService,
  CreateNotificationData,
} from '../notifications/notifications.service';

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
    bookedSlot: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  const tx = { __tx: true };
  let availabilityService: { computeSlots: jest.Mock };
  let patientsService: { resolveForPublicBooking: jest.Mock };
  let consultationsService: {
    createFromPublicBooking: jest.Mock;
    afterPublicBookingCommit: jest.Mock;
  };
  let notificationsService: {
    create: jest.Mock<Promise<unknown>, [CreateNotificationData]>;
  };

  function buildService(
    enabled = true,
    checkoutInlineEnabled = false,
    extraEnv: Record<string, string> = {},
  ): PublicSchedulingService {
    const config = {
      get: (key: string) => {
        if (key === 'PUBLIC_SCHEDULING_ENABLED') return String(enabled);
        if (key === 'PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED')
          return String(checkoutInlineEnabled);
        return extraEnv[key];
      },
    };
    return new PublicSchedulingService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
      availabilityService as unknown as AvailabilityService,
      patientsService as unknown as PatientsService,
      consultationsService as unknown as ConsultationsService,
      notificationsService as unknown as NotificationsService,
    );
  }

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      paymentAccount: { findUnique: jest.fn() },
      bookedSlot: { count: jest.fn().mockResolvedValue(0) },
      // Emula la transaccion interactiva: corre el callback con un tx
      // sentinela; si el callback lanza, la promesa se rechaza (rollback).
      $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    availabilityService = { computeSlots: jest.fn() };
    patientsService = { resolveForPublicBooking: jest.fn() };
    consultationsService = {
      createFromPublicBooking: jest.fn(),
      afterPublicBookingCommit: jest.fn(),
    };
    notificationsService = {
      create: jest
        .fn<Promise<unknown>, [CreateNotificationData]>()
        .mockResolvedValue({}),
    };
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

    // issue #285: el recheck lee el estado real, no el cache del listado.
    it('el recheck de disponibilidad salta el cache', async () => {
      prisma.user.findUnique.mockResolvedValue({ sessionDurationMinutes: 50 });
      availabilityService.computeSlots.mockResolvedValue([]);

      await expect(
        service.book('therapist-1', {
          slotStart: '2026-09-05T13:00:00.000Z',
          patient: patientDto,
        } as never),
      ).rejects.toThrow(ConflictException);

      expect(availabilityService.computeSlots).toHaveBeenCalledWith(
        'therapist-1',
        new Date('2026-09-05T13:00:00.000Z'),
        new Date('2026-09-05T13:50:00.000Z'),
        expect.any(Date),
        { bypassCache: true },
      );
    });

    it('reserva exitosamente cuando el slot sigue libre: resuelve paciente y crea la consulta', async () => {
      prisma.user.findUnique.mockResolvedValue({ sessionDurationMinutes: 50 });
      availabilityService.computeSlots.mockResolvedValue([
        { start: '2026-09-05T13:00:00.000Z', end: '2026-09-05T13:50:00.000Z' },
      ]);
      const patient = {
        id: 'patient-1',
        rut: '11111111-1',
        fullName: 'Paciente Público',
      };
      patientsService.resolveForPublicBooking.mockResolvedValue({
        patient,
        isNew: false,
      });
      const sessionDate = new Date('2026-09-05T13:00:00.000Z');
      consultationsService.createFromPublicBooking.mockResolvedValue({
        id: 'consultation-1',
        sessionDate,
      });

      const result = await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      // Issue #299: solo id/groupId/sessionDate, nada del paciente.
      expect(result).toEqual({
        id: 'consultation-1',
        groupId: 'consultation-1',
        sessionDate,
      });
      expect(patientsService.resolveForPublicBooking).toHaveBeenCalledWith(
        'therapist-1',
        patientDto,
        undefined,
        tx,
      );
      expect(consultationsService.createFromPublicBooking).toHaveBeenCalledWith(
        'therapist-1',
        'patient-1',
        '11111111-1',
        new Date('2026-09-05T13:00:00.000Z'),
        50,
        tx,
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
        patient: {
          id: 'patient-1',
          rut: '11111111-1',
          fullName: 'Paciente Público',
        },
        isNew: false,
      });
      consultationsService.createFromPublicBooking.mockResolvedValue({
        id: 'c-1',
        sessionDate: new Date(),
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
        tx,
      );
    });
  });

  // Issue #299: paciente + consulta en una sola transaccion; notificacion y
  // efectos post-reserva solo tras el commit.
  describe('atomicidad de la reserva (issue #299)', () => {
    const patientDto = {
      fullName: 'Paciente Publico',
      rut: '11.111.111-1',
      birthDate: '1990-01-01',
      email: 'paciente@ejemplo.cl',
    };
    const dto = {
      slotStart: '2026-09-05T13:00:00.000Z',
      patient: patientDto,
    } as never;

    function setUpFreeSlot(isNew: boolean): void {
      prisma.user.findUnique.mockResolvedValue({ sessionDurationMinutes: 50 });
      availabilityService.computeSlots.mockResolvedValue([
        { start: '2026-09-05T13:00:00.000Z', end: '2026-09-05T13:50:00.000Z' },
      ]);
      patientsService.resolveForPublicBooking.mockResolvedValue({
        patient: {
          id: 'patient-1',
          rut: '11111111-1',
          fullName: 'Paciente Publico',
        },
        isNew,
      });
    }

    it('un conflicto de slot revierte la transaccion: sin notificacion ni efectos post-commit', async () => {
      setUpFreeSlot(true);
      consultationsService.createFromPublicBooking.mockRejectedValue(
        new ConflictException('El horario seleccionado ya no esta disponible.'),
      );

      await expect(service.book('therapist-1', dto)).rejects.toThrow(
        ConflictException,
      );
      await Promise.resolve();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(
        consultationsService.afterPublicBookingCommit,
      ).not.toHaveBeenCalled();
    });

    it('resuelve paciente y crea la consulta con el MISMO tx', async () => {
      setUpFreeSlot(true);
      consultationsService.createFromPublicBooking.mockResolvedValue({
        id: 'consultation-1',
        sessionDate: new Date(),
      });

      await service.book('therapist-1', dto);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const resolveArgs = patientsService.resolveForPublicBooking.mock
        .calls[0] as unknown[];
      expect(resolveArgs[3]).toBe(tx);
      const createArgs = consultationsService.createFromPublicBooking.mock
        .calls[0] as unknown[];
      expect(createArgs[5]).toBe(tx);
    });

    it('la notificacion y los efectos post-reserva se envian despues del commit', async () => {
      setUpFreeSlot(true);
      consultationsService.createFromPublicBooking.mockResolvedValue({
        id: 'consultation-1',
        sessionDate: new Date(),
      });
      const order: string[] = [];
      prisma.$transaction.mockImplementation(
        async (cb: (t: unknown) => Promise<unknown>) => {
          const result = await cb(tx);
          order.push('commit');
          return result;
        },
      );
      consultationsService.afterPublicBookingCommit.mockImplementation(() => {
        order.push('afterCommit');
      });
      notificationsService.create.mockImplementation(() => {
        order.push('notify');
        return Promise.resolve({});
      });

      await service.book('therapist-1', dto);

      expect(order).toEqual(['commit', 'afterCommit', 'notify']);
      expect(
        consultationsService.afterPublicBookingCommit,
      ).toHaveBeenCalledWith('consultation-1', 'therapist-1');
    });

    it('si resolver el paciente falla (p. ej. RUT que no coincide) no crea consulta ni notifica', async () => {
      setUpFreeSlot(true);
      patientsService.resolveForPublicBooking.mockRejectedValue(
        new ConflictException('No fue posible procesar la reserva.'),
      );

      await expect(service.book('therapist-1', dto)).rejects.toThrow(
        ConflictException,
      );

      expect(
        consultationsService.createFromPublicBooking,
      ).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  // sdd/public-booking-payment-calendar PR 5 (tasks.md 5.1, 5.6, spec.md
  // "Booking succeeds and carries a checkout URL when available" /
  // "...without a checkout URL when payment is unavailable"): el hint nunca
  // lee Payment -- solo PaymentAccount.status (leído directo por
  // performance, ver comentario en el service) y el defaultSessionAmount del
  // Patient ya resuelto por resolveForPublicBooking.
  describe('tope diario de reservas exitosas por terapeuta (issue #299)', () => {
    const dto = {
      slotStart: '2026-09-05T13:00:00.000Z',
      patient: {
        fullName: 'Paciente Publico',
        rut: '11.111.111-1',
        birthDate: '1990-01-01',
        email: 'paciente@ejemplo.cl',
      },
    } as never;

    function setUpFreeSlot(): void {
      prisma.user.findUnique.mockResolvedValue({ sessionDurationMinutes: 50 });
      availabilityService.computeSlots.mockResolvedValue([
        { start: '2026-09-05T13:00:00.000Z', end: '2026-09-05T13:50:00.000Z' },
      ]);
      patientsService.resolveForPublicBooking.mockResolvedValue({
        patient: { id: 'patient-1', rut: '11111111-1', fullName: 'Paciente' },
        isNew: true,
      });
      consultationsService.createFromPublicBooking.mockResolvedValue({
        id: 'consultation-1',
        sessionDate: new Date(),
      });
    }

    it('la reserva N+1 se rechaza con 429 sin crear nada ni notificar', async () => {
      service = buildService(true, false, { PUBLIC_BOOKING_DAILY_LIMIT: '3' });
      setUpFreeSlot();
      prisma.bookedSlot.count.mockResolvedValue(3);

      await expect(service.book('therapist-1', dto)).rejects.toThrow(
        ThrottlerException,
      );
      await Promise.resolve();

      expect(availabilityService.computeSlots).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(patientsService.resolveForPublicBooking).not.toHaveBeenCalled();
      expect(
        consultationsService.createFromPublicBooking,
      ).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(
        consultationsService.afterPublicBookingCommit,
      ).not.toHaveBeenCalled();
    });

    it('la última reserva dentro del tope (N-1 previas) todavía se acepta', async () => {
      service = buildService(true, false, { PUBLIC_BOOKING_DAILY_LIMIT: '3' });
      setUpFreeSlot();
      prisma.bookedSlot.count.mockResolvedValue(2);

      await expect(service.book('therapist-1', dto)).resolves.toMatchObject({
        id: 'consultation-1',
      });
    });

    it('los intentos fallidos no consumen el tope: no crean BookedSlot y el conteo sale de la base', async () => {
      service = buildService(true, false, { PUBLIC_BOOKING_DAILY_LIMIT: '1' });
      setUpFreeSlot();
      // Un intento fallido (409 por slot ocupado) no deja BookedSlot: el conteo
      // sigue en 0 y el siguiente intento no recibe 429.
      availabilityService.computeSlots.mockResolvedValueOnce([]);

      await expect(service.book('therapist-1', dto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.book('therapist-1', dto)).resolves.toMatchObject({
        id: 'consultation-1',
      });
      expect(prisma.bookedSlot.count).toHaveBeenCalledTimes(2);
    });

    it('cuenta solo las reservas del terapeuta pedido, en la ventana de 24h', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
      try {
        setUpFreeSlot();

        await service.book('therapist-2', dto);

        expect(prisma.bookedSlot.count).toHaveBeenCalledWith({
          where: {
            therapistId: 'therapist-2',
            createdAt: { gte: new Date('2026-09-04T12:00:00.000Z') },
          },
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('otro terapeuta no se ve afectado por el tope de uno saturado', async () => {
      service = buildService(true, false, { PUBLIC_BOOKING_DAILY_LIMIT: '2' });
      setUpFreeSlot();
      prisma.bookedSlot.count.mockImplementation(
        (args: { where: { therapistId: string } }) =>
          Promise.resolve(args.where.therapistId === 'therapist-1' ? 2 : 0),
      );

      await expect(service.book('therapist-1', dto)).rejects.toThrow(
        ThrottlerException,
      );
      await expect(service.book('therapist-2', dto)).resolves.toMatchObject({
        id: 'consultation-1',
      });
    });

    it('el tope por defecto es 100 y respeta PUBLIC_BOOKING_DAILY_TTL_MS como ventana', async () => {
      service = buildService(true, false, {
        PUBLIC_BOOKING_DAILY_TTL_MS: '3600000',
      });
      setUpFreeSlot();
      prisma.bookedSlot.count.mockResolvedValue(100);

      await expect(service.book('therapist-1', dto)).rejects.toThrow(
        ThrottlerException,
      );
      const args = prisma.bookedSlot.count.mock.calls[0] as [
        { where: { createdAt: { gte: Date } } },
      ];
      const windowMs = Date.now() - args[0].where.createdAt.gte.getTime();
      expect(windowMs).toBeGreaterThanOrEqual(3600000);
      expect(windowMs).toBeLessThan(3600000 + 5000);
    });
  });

  describe('checkout hint (PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED)', () => {
    const patientDto = {
      fullName: 'Paciente Público',
      rut: '11.111.111-1',
      birthDate: '1990-01-01',
      email: 'paciente@ejemplo.cl',
    };

    function setUpSuccessfulBooking(
      patient: {
        id: string;
        rut: string;
        defaultSessionAmount: number | null;
      },
      isNew = false,
    ): void {
      prisma.user.findUnique.mockResolvedValue({
        sessionDurationMinutes: 50,
      });
      availabilityService.computeSlots.mockResolvedValue([
        { start: '2026-09-05T13:00:00.000Z', end: '2026-09-05T13:50:00.000Z' },
      ]);
      patientsService.resolveForPublicBooking.mockResolvedValue({
        patient: { ...patient, fullName: 'Paciente Público' },
        isNew,
      });
      consultationsService.createFromPublicBooking.mockResolvedValue({
        id: 'consultation-1',
        sessionDate: new Date(),
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

  // issue #139: paciente nuevo autocreado vía autoagenda nunca tiene
  // defaultSessionAmount -> ensureCharge() no genera cargo para su primera
  // sesión. book() notifica al terapeuta fire-and-forget en ese caso, sin
  // agregar latencia ni poder fallar la reserva.
  describe('notificación PATIENT_MISSING_SESSION_AMOUNT (paciente autocreado)', () => {
    const patientDto = {
      fullName: 'Paciente Público',
      rut: '11.111.111-1',
      birthDate: '1990-01-01',
      email: 'paciente@ejemplo.cl',
    };

    function setUpBooking(isNew: boolean): void {
      prisma.user.findUnique.mockResolvedValue({ sessionDurationMinutes: 50 });
      availabilityService.computeSlots.mockResolvedValue([
        { start: '2026-09-05T13:00:00.000Z', end: '2026-09-05T13:50:00.000Z' },
      ]);
      patientsService.resolveForPublicBooking.mockResolvedValue({
        patient: {
          id: 'patient-1',
          rut: '11111111-1',
          fullName: 'Paciente Público',
        },
        isNew,
      });
      consultationsService.createFromPublicBooking.mockResolvedValue({
        id: 'consultation-1',
        sessionDate: new Date(),
      });
    }

    it('paciente nuevo (isNew: true) dispara la notificación al terapeuta con tipo/userId/linkPath correctos', async () => {
      setUpBooking(true);

      await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      // fire-and-forget: la promesa se dispara de forma síncrona dentro de
      // book(), pero su resolución puede quedar pendiente en el microtask
      // queue -- flush antes de aserto.
      await Promise.resolve();
      await Promise.resolve();

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'therapist-1',
          type: NotificationType.PATIENT_MISSING_SESSION_AMOUNT,
          linkPath: '/patients',
        }),
      );
      const [call] = notificationsService.create.mock.calls[0];
      expect(call.body).toContain('Paciente Público');
    });

    it('paciente existente (isNew: false) NO dispara ninguna notificación', async () => {
      setUpBooking(false);

      await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      await Promise.resolve();
      await Promise.resolve();

      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('un fallo de notificationsService.create no bloquea ni demora la respuesta de book()', async () => {
      setUpBooking(true);
      notificationsService.create.mockRejectedValue(new Error('boom'));

      const result = await service.book('therapist-1', {
        slotStart: '2026-09-05T13:00:00.000Z',
        patient: patientDto,
      } as never);

      expect(result).toMatchObject({ id: 'consultation-1' });

      // deja que el .catch() interno procese el rechazo antes de que Jest
      // termine el test, para que no aparezca como unhandled rejection.
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
