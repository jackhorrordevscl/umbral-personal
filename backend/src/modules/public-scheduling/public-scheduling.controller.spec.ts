import { PublicSchedulingController } from './public-scheduling.controller';
import { PublicSchedulingService } from './public-scheduling.service';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.6): controller delgado --
// solo delega en PublicSchedulingService, mismo criterio que
// AvailabilityController/PatientsController de este código base. Sin
// JwtAuthGuard a propósito: ambas rutas son públicas (spec.md "Public
// Availability Read Endpoint"/"Public Booking Write Endpoint").
describe('PublicSchedulingController', () => {
  let controller: PublicSchedulingController;
  let service: { getAvailability: jest.Mock; book: jest.Mock };

  beforeEach(() => {
    service = { getAvailability: jest.fn(), book: jest.fn() };
    controller = new PublicSchedulingController(
      service as unknown as PublicSchedulingService,
    );
  });

  it('GET availability delega en PublicSchedulingService.getAvailability con el :therapistId de la ruta', async () => {
    const slots = [{ start: 'a', end: 'b' }];
    service.getAvailability.mockResolvedValue(slots);

    const query = {
      from: '2026-09-01T00:00:00-04:00',
      to: '2026-09-05T00:00:00-04:00',
    };
    const result = await controller.getAvailability(
      'therapist-1',
      query as never,
    );

    expect(result).toBe(slots);
    expect(service.getAvailability).toHaveBeenCalledWith('therapist-1', query);
  });

  it('POST book delega en PublicSchedulingService.book con el :therapistId de la ruta', async () => {
    const consultation = { id: 'c-1' };
    service.book.mockResolvedValue(consultation);

    const dto = {
      slotStart: '2026-09-05T13:00:00.000Z',
      patient: {
        fullName: 'Paciente',
        rut: '11.111.111-1',
        birthDate: '1990-01-01',
        email: 'paciente@ejemplo.cl',
      },
    };
    const result = await controller.book('therapist-1', dto as never);

    expect(result).toBe(consultation);
    expect(service.book).toHaveBeenCalledWith('therapist-1', dto);
  });
});
