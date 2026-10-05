import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import type { RequestUser } from '../../common/decorators/current-user.decorator';

// issue #157: GET /patients/stats/acquisition -- mismo hazard de wildcard
// que "stats"/"range" en ConsultationsController; el controller solo
// delega en el servicio con el therapistId del usuario autenticado.
describe('PatientsController', () => {
  let controller: PatientsController;
  let service: { getAcquisitionStats: jest.Mock; getSummary: jest.Mock };
  const user = { id: 'therapist-1' } as RequestUser;

  beforeEach(() => {
    service = {
      getAcquisitionStats: jest.fn().mockResolvedValue([]),
      getSummary: jest.fn().mockResolvedValue({ total: 0, withConsent: 0 }),
    };
    controller = new PatientsController(service as unknown as PatientsService);
  });

  describe('getAcquisitionStats', () => {
    it('llama al servicio con el therapistId del usuario autenticado', async () => {
      await controller.getAcquisitionStats(user);

      expect(service.getAcquisitionStats).toHaveBeenCalledWith('therapist-1');
    });
  });

  describe('getSummary', () => {
    it('llama al servicio con el therapistId del usuario autenticado', async () => {
      await controller.getSummary(user);

      expect(service.getSummary).toHaveBeenCalledWith('therapist-1');
    });
  });
});
