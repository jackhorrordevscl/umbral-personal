import { GuardiansController } from './guardians.controller';
import { GuardiansService } from './guardians.service';
import type { RequestUser } from '../../common/decorators/current-user.decorator';

describe('GuardiansController', () => {
  let controller: GuardiansController;
  let service: {
    list: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  const user = { id: 'therapist-1' } as RequestUser;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'guardian-1' }),
      update: jest.fn().mockResolvedValue({ id: 'guardian-1' }),
      remove: jest.fn().mockResolvedValue({ id: 'guardian-1' }),
    };
    controller = new GuardiansController(
      service as unknown as GuardiansService,
    );
  });

  it('list delega con el therapistId del usuario autenticado', async () => {
    await controller.list('patient-1', user);

    expect(service.list).toHaveBeenCalledWith('patient-1', 'therapist-1');
  });

  it('create delega con el therapistId del usuario autenticado', async () => {
    const dto = {
      fullName: 'María Soto',
      rut: '12345678-5',
      relationship: 'MOTHER' as const,
    };

    await controller.create('patient-1', dto, user);

    expect(service.create).toHaveBeenCalledWith(
      'patient-1',
      dto,
      'therapist-1',
    );
  });

  it('update delega con paciente, representante y therapistId', async () => {
    await controller.update(
      'patient-1',
      'guardian-1',
      { canConsent: false },
      user,
    );

    expect(service.update).toHaveBeenCalledWith(
      'patient-1',
      'guardian-1',
      { canConsent: false },
      'therapist-1',
    );
  });

  it('remove delega con paciente, representante y therapistId', async () => {
    await controller.remove('patient-1', 'guardian-1', user);

    expect(service.remove).toHaveBeenCalledWith(
      'patient-1',
      'guardian-1',
      'therapist-1',
    );
  });
});
