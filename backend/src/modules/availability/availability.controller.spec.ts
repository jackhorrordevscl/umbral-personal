import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import type { RequestUser } from '../../common/decorators/current-user.decorator';

// sdd/patient-self-scheduling PR 2 (tasks.md 2.4): el controller es
// deliberadamente delgado -- solo delega en AvailabilityService pasando
// SIEMPRE user.id como therapistId (JWT-scoped, mismo criterio de
// ProfileController: nunca toma un therapistId del body/query). El único
// endpoint con :id (DELETE blockouts/:id) delega el ownership check al
// service (deleteBlockout ya cubierto por availability.service.spec.ts).
describe('AvailabilityController', () => {
  let controller: AvailabilityController;
  let service: {
    getSchedule: jest.Mock;
    saveSchedule: jest.Mock;
    listBlockouts: jest.Mock;
    createBlockout: jest.Mock;
    deleteBlockout: jest.Mock;
  };
  const user = { id: 'therapist-1' } as RequestUser;

  beforeEach(() => {
    service = {
      getSchedule: jest.fn().mockResolvedValue({ ok: true }),
      saveSchedule: jest.fn().mockResolvedValue(undefined),
      listBlockouts: jest.fn().mockResolvedValue([]),
      createBlockout: jest.fn().mockResolvedValue({ id: 'b1' }),
      deleteBlockout: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AvailabilityController(
      service as unknown as AvailabilityService,
    );
  });

  it('GET schedule delega en getSchedule con el id del usuario autenticado', async () => {
    const result = await controller.getSchedule(user);

    expect(service.getSchedule).toHaveBeenCalledWith('therapist-1');
    expect(result).toEqual({ ok: true });
  });

  it('PUT schedule delega en saveSchedule con el id del usuario autenticado', async () => {
    const dto = { sessionDurationMinutes: 50, entries: [] };

    await controller.saveSchedule(dto as never, user);

    expect(service.saveSchedule).toHaveBeenCalledWith('therapist-1', dto);
  });

  it('GET blockouts delega en listBlockouts con el id del usuario autenticado', async () => {
    await controller.listBlockouts(user);

    expect(service.listBlockouts).toHaveBeenCalledWith('therapist-1');
  });

  it('POST blockouts delega en createBlockout con el id del usuario autenticado', async () => {
    const dto = {
      startsAt: new Date('2026-06-08'),
      endsAt: new Date('2026-06-09'),
      kind: 'FULL_DAY',
    };

    await controller.createBlockout(dto as never, user);

    expect(service.createBlockout).toHaveBeenCalledWith('therapist-1', dto);
  });

  // Ownership: nunca confía en un therapistId externo, siempre pasa
  // user.id -- el service es quien rechaza si :id no le pertenece.
  it('DELETE blockouts/:id delega en deleteBlockout con el id del path y el usuario autenticado', async () => {
    await controller.deleteBlockout('b1', user);

    expect(service.deleteBlockout).toHaveBeenCalledWith('b1', 'therapist-1');
  });
});
