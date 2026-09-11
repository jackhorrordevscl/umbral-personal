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
  let prisma: { user: { findUnique: jest.Mock } };
  let availabilityService: { computeSlots: jest.Mock };
  let patientsService: { resolveForPublicBooking: jest.Mock };
  let consultationsService: { createFromPublicBooking: jest.Mock };

  function buildService(enabled = true): PublicSchedulingService {
    const config = {
      get: (key: string) =>
        key === 'PUBLIC_SCHEDULING_ENABLED' ? String(enabled) : undefined,
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
    prisma = { user: { findUnique: jest.fn() } };
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
});
