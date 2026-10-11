import { AssentsController } from './assents.controller';
import { AssentsService } from './assents.service';
import type { RequestUser } from '../../common/decorators/current-user.decorator';

describe('AssentsController', () => {
  let controller: AssentsController;
  let service: { list: jest.Mock; record: jest.Mock };
  const user = { id: 'therapist-1' } as RequestUser;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue([]),
      record: jest.fn().mockResolvedValue({ id: 'assent-1' }),
    };
    controller = new AssentsController(service as unknown as AssentsService);
  });

  it('list delega con el therapistId del usuario autenticado', async () => {
    await controller.list('patient-1', user);

    expect(service.list).toHaveBeenCalledWith('patient-1', 'therapist-1');
  });

  it('record delega con el therapistId del usuario autenticado', async () => {
    const dto = { action: 'GRANTED' as const };

    await controller.record('patient-1', dto, user);

    expect(service.record).toHaveBeenCalledWith(
      'patient-1',
      dto,
      'therapist-1',
    );
  });

  it('no expone PATCH ni DELETE (append-only)', () => {
    expect(controller).not.toHaveProperty('update');
    expect(controller).not.toHaveProperty('remove');
  });
});
