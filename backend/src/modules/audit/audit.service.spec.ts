import { AuditAction } from '@prisma/client';
import {
  AUDIT_DETAIL_MAX_LENGTH,
  AUDIT_USER_AGENT_MAX_LENGTH,
  AuditService,
} from './audit.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let create: jest.Mock;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    service = new AuditService({
      auditLog: { create },
    } as unknown as PrismaService);
  });

  describe('log', () => {
    it('inserta una fila de AuditLog con todos los campos recibidos', async () => {
      const result = await service.log({
        userId: 'user-1',
        action: AuditAction.VIEW,
        resource: 'Patient',
        resourceId: 'patient-1',
        detail: 'lectura de ficha',
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
      });

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          action: AuditAction.VIEW,
          resource: 'Patient',
          resourceId: 'patient-1',
          detail: 'lectura de ficha',
          ipAddress: '10.0.0.1',
          userAgent: 'jest',
        },
      });
      expect(result).toEqual({ id: 'audit-1' });
    });

    it('acepta eventos sin usuario (p. ej. login fallido) y deja los opcionales indefinidos', async () => {
      await service.log({
        action: AuditAction.LOGIN,
        resource: 'Auth',
        resourceId: 'unknown',
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          userId: undefined,
          action: AuditAction.LOGIN,
          resource: 'Auth',
          resourceId: 'unknown',
          detail: undefined,
          ipAddress: undefined,
          userAgent: undefined,
        },
      });
    });

    it('solo escribe los campos del DTO: ignora propiedades extra como id o createdAt', async () => {
      await service.log({
        action: AuditAction.CREATE,
        resource: 'Patient',
        resourceId: 'patient-2',
        id: 'forzado',
        createdAt: new Date(0),
      } as unknown as Parameters<AuditService['log']>[0]);

      const calls = create.mock.calls as [{ data: Record<string, unknown> }][];
      const arg = calls[0][0];
      expect(arg.data).not.toHaveProperty('id');
      expect(arg.data).not.toHaveProperty('createdAt');
    });

    // Issue #504: el User-Agent lo manda el cliente y se guardaba tal cual.
    it('recorta userAgent y detail a su tope de largo y deja intactos los que caben', async () => {
      await service.log({
        action: AuditAction.VIEW,
        resource: 'Patient',
        resourceId: 'patient-4',
        detail: 'd'.repeat(AUDIT_DETAIL_MAX_LENGTH + 50),
        userAgent: 'u'.repeat(AUDIT_USER_AGENT_MAX_LENGTH + 50),
      });
      await service.log({
        action: AuditAction.VIEW,
        resource: 'Patient',
        resourceId: 'patient-4',
        detail: 'd'.repeat(AUDIT_DETAIL_MAX_LENGTH),
        userAgent: 'u'.repeat(AUDIT_USER_AGENT_MAX_LENGTH),
      });

      const calls = create.mock.calls as [
        { data: { detail: string; userAgent: string } },
      ][];
      expect(calls[0][0].data.detail).toBe('d'.repeat(AUDIT_DETAIL_MAX_LENGTH));
      expect(calls[0][0].data.userAgent).toBe(
        'u'.repeat(AUDIT_USER_AGENT_MAX_LENGTH),
      );
      expect(calls[1][0].data.detail).toHaveLength(AUDIT_DETAIL_MAX_LENGTH);
      expect(calls[1][0].data.userAgent).toHaveLength(
        AUDIT_USER_AGENT_MAX_LENGTH,
      );
    });

    it('al recortar no deja un par sustituto partido a la mitad', async () => {
      // '😀' ocupa 2 unidades UTF-16: cortar entre ambas dejaría un sustituto
      // suelto que no se puede codificar en UTF-8.
      await service.log({
        action: AuditAction.VIEW,
        resource: 'Patient',
        resourceId: 'patient-5',
        userAgent: 'u'.repeat(AUDIT_USER_AGENT_MAX_LENGTH - 1) + '😀',
      });

      const calls = create.mock.calls as [{ data: { userAgent: string } }][];
      expect(calls[0][0].data.userAgent).toBe(
        'u'.repeat(AUDIT_USER_AGENT_MAX_LENGTH - 1),
      );
    });

    it('propaga el error de la base de datos (no lo traga) para que el llamador decida', async () => {
      create.mockRejectedValue(new Error('db caída'));

      await expect(
        service.log({
          action: AuditAction.SOFT_DELETE,
          resource: 'Patient',
          resourceId: 'patient-3',
        }),
      ).rejects.toThrow('db caída');
    });

    it('es solo escritura: el servicio no expone update ni delete', () => {
      const methods = Object.getOwnPropertyNames(AuditService.prototype);

      expect(methods).toEqual(['constructor', 'log']);
    });
  });
});
