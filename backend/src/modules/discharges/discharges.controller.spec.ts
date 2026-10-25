import type { Request, Response } from 'express';
import { DischargesController } from './discharges.controller';
import type { DischargesService } from './discharges.service';
import type { DischargeDeliveriesService } from './discharge-deliveries.service';

describe('DischargesController.pdf', () => {
  function build(fileName: string) {
    const dischargesService = {
      getPdf: jest.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-1.4'),
        fileName,
        patientId: 'patient-1',
      }),
    } as unknown as DischargesService;
    const controller = new DischargesController(
      dischargesService,
      {} as DischargeDeliveriesService,
    );
    const set = jest.fn();
    const res = { set, end: jest.fn() } as unknown as Response;
    const req = {} as Request & { auditPatientId?: string };
    return { controller, res, set, req };
  }

  it('envía el nombre con filename ASCII de respaldo y filename* en UTF-8', async () => {
    const { controller, res, set, req } = build('Informe sesión.pdf');

    await controller.pdf('d1', { id: 'u1' } as never, req, res);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Disposition':
          'attachment; filename="Informe sesi_n.pdf"; filename*=UTF-8\'\'Informe%20sesi%C3%B3n.pdf',
      }),
    );
    expect(req.auditPatientId).toBe('patient-1');
  });
});
