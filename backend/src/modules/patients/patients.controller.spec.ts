import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import type { CreatePatientDto } from './dto/create-patient.dto';
import type { UpdatePatientDto } from './dto/update-patient.dto';
import type { RecordConsentDto } from './dto/record-consent.dto';
import type { BulkDeclareConsentDto } from './dto/bulk-declare-consent.dto';
import type { PatientsQueryDto } from './dto/patients-query.dto';

type ServiceMocks = Record<
  | 'create'
  | 'findAll'
  | 'getSummary'
  | 'getAcquisitionStats'
  | 'getHistory'
  | 'findOne'
  | 'update'
  | 'softDelete'
  | 'bulkDeclareConsent'
  | 'recordConsent'
  | 'getCurrentConsentStatus'
  | 'getConsentLedger',
  jest.Mock
>;

// El controller solo delega en el servicio con el id del usuario autenticado
// (aislamiento por terapeuta); los errores del servicio se propagan tal cual.
describe('PatientsController', () => {
  let controller: PatientsController;
  let service: ServiceMocks;
  const user = { id: 'therapist-1' } as RequestUser;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'p1' }),
      findAll: jest.fn().mockResolvedValue({ data: [] }),
      getSummary: jest.fn().mockResolvedValue({ total: 0, withConsent: 0 }),
      getAcquisitionStats: jest.fn().mockResolvedValue([]),
      getHistory: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'p1' }),
      update: jest.fn().mockResolvedValue({ id: 'p1' }),
      softDelete: jest.fn().mockResolvedValue({ id: 'p1' }),
      bulkDeclareConsent: jest.fn().mockResolvedValue({ declared: 2 }),
      recordConsent: jest.fn().mockResolvedValue({ id: 'c1' }),
      getCurrentConsentStatus: jest.fn().mockResolvedValue({}),
      getConsentLedger: jest.fn().mockResolvedValue([]),
    };
    controller = new PatientsController(service as unknown as PatientsService);
  });

  describe('create', () => {
    it('crea el paciente con el dto y el id del terapeuta autenticado', async () => {
      const dto = { fullName: 'Ana' } as CreatePatientDto;

      const result = await controller.create(dto, user);

      expect(service.create).toHaveBeenCalledWith(dto, 'therapist-1');
      expect(result).toEqual({ id: 'p1' });
    });
  });

  describe('findAll', () => {
    it('pasa el terapeuta y los filtros de la query al servicio', async () => {
      const query = { search: 'ana' } as unknown as PatientsQueryDto;

      const result = await controller.findAll(user, query);

      expect(service.findAll).toHaveBeenCalledWith('therapist-1', query);
      expect(result).toEqual({ data: [] });
    });
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

  describe('getHistory', () => {
    it('pide el historial del paciente del path para el terapeuta autenticado', async () => {
      await controller.getHistory('p1', user);

      expect(service.getHistory).toHaveBeenCalledWith('p1', 'therapist-1');
    });

    it('propaga NotFound cuando el paciente no existe o es de otro terapeuta', async () => {
      service.getHistory.mockRejectedValue(new NotFoundException());

      await expect(controller.getHistory('ajeno', user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOne', () => {
    it('busca el paciente por id acotado al terapeuta autenticado', async () => {
      const result = await controller.findOne('p1', user);

      expect(service.findOne).toHaveBeenCalledWith('p1', 'therapist-1');
      expect(result).toEqual({ id: 'p1' });
    });

    it('propaga NotFound del servicio sin transformarlo', async () => {
      service.findOne.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('ajeno', user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('actualiza con id, dto y terapeuta en el orden que espera el servicio', async () => {
      const dto = { fullName: 'Ana B' } as UpdatePatientDto;

      await controller.update('p1', dto, user);

      expect(service.update).toHaveBeenCalledWith('p1', dto, 'therapist-1');
    });

    it('propaga NotFound del servicio', async () => {
      service.update.mockRejectedValue(new NotFoundException());

      await expect(
        controller.update('ajeno', {} as UpdatePatientDto, user),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('elimina (soft delete) el paciente del terapeuta autenticado', async () => {
      await controller.softDelete('p1', user);

      expect(service.softDelete).toHaveBeenCalledWith('p1', 'therapist-1');
    });

    it('propaga NotFound del servicio', async () => {
      service.softDelete.mockRejectedValue(new NotFoundException());

      await expect(controller.softDelete('ajeno', user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('bulkDeclareConsent', () => {
    it('delega la declaración en bloque con el dto y el terapeuta', async () => {
      const dto = {
        patientIds: ['p1', 'p2'],
      } as unknown as BulkDeclareConsentDto;

      const result = await controller.bulkDeclareConsent(dto, user);

      expect(service.bulkDeclareConsent).toHaveBeenCalledWith(
        dto,
        'therapist-1',
      );
      expect(result).toEqual({ declared: 2 });
    });
  });

  describe('recordConsent', () => {
    it('registra el consentimiento del paciente del path con el dto recibido', async () => {
      const dto = { purpose: 'TREATMENT' } as unknown as RecordConsentDto;

      await controller.recordConsent('p1', dto, user);

      expect(service.recordConsent).toHaveBeenCalledWith(
        'p1',
        dto,
        'therapist-1',
      );
    });

    it('propaga NotFound del servicio', async () => {
      service.recordConsent.mockRejectedValue(new NotFoundException());

      await expect(
        controller.recordConsent('ajeno', {} as RecordConsentDto, user),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getConsentStatus', () => {
    it('consulta el estado vigente de consentimiento del paciente', async () => {
      await controller.getConsentStatus('p1', user);

      expect(service.getCurrentConsentStatus).toHaveBeenCalledWith(
        'p1',
        'therapist-1',
      );
    });
  });

  describe('getConsentLedger', () => {
    it('consulta el libro de consentimientos del paciente', async () => {
      await controller.getConsentLedger('p1', user);

      expect(service.getConsentLedger).toHaveBeenCalledWith(
        'p1',
        'therapist-1',
      );
    });
  });

  describe('metadatos de rutas', () => {
    it('protege todo el controller con JwtAuthGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        PatientsController,
      ) as unknown[];

      expect(guards).toContain(JwtAuthGuard);
    });

    it('monta el controller bajo /patients', () => {
      expect(Reflect.getMetadata(PATH_METADATA, PatientsController)).toBe(
        'patients',
      );
    });

    it('declara las rutas fijas antes que las rutas con :id (hazard de wildcard)', () => {
      const proto = PatientsController.prototype as unknown as Record<
        string,
        object
      >;
      const paths = Object.getOwnPropertyNames(proto)
        .filter((name) => name !== 'constructor')
        .map(
          (name) => Reflect.getMetadata(PATH_METADATA, proto[name]) as string,
        );
      const index = (p: string) => paths.indexOf(p);

      expect(index('summary')).toBeGreaterThan(-1);
      expect(index('summary')).toBeLessThan(index(':id'));
      expect(index('stats/acquisition')).toBeGreaterThan(-1);
      expect(index('stats/acquisition')).toBeLessThan(index(':id'));
      expect(index('consents/bulk-declare')).toBeGreaterThan(-1);
    });
  });
});
