import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Consultation, Prisma } from '@prisma/client';
import { DEFAULT_SESSION_MINUTES } from '../calendar-integration/calendar-integration.constants';
import { ConsultationsService } from './consultations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { PaymentsService } from '../payments/payments.service';
import { AvailabilityService } from '../availability/availability.service';
import { UNPAGINATED_SAFETY_LIMIT } from '../../common/dto/pagination.dto';

function buildConsultation(
  overrides: Partial<Consultation> = {},
): Consultation {
  return {
    id: 'consultation-1',
    groupId: 'consultation-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    sessionDate: new Date('2026-01-10T12:00:00'),
    durationMinutes: 50,
    consultReason: 'Motivo de consulta original',
    intervention: 'Intervención original',
    agreements: null,
    nextSessionDate: null,
    sessionType: 'IN_PERSON',
    createdAt: new Date(),
    scheduledAt: new Date('2026-01-10T12:00:00'),
    patientRut: '11111111-1',
    deletedAt: null,
    correctsId: null,
    correctedBy: null,
    ...overrides,
  } as unknown as Consultation;
}

describe('ConsultationsService', () => {
  let service: ConsultationsService;
  let prisma: {
    consultation: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
    };
    consultationHistory: { findMany: jest.Mock; create: jest.Mock };
    calendarEventLink: { findMany: jest.Mock };
    payment: { findMany: jest.Mock };
    reminderDispatch: { findMany: jest.Mock };
    bookedSlot: { create: jest.Mock; updateMany: jest.Mock };
    user: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let availabilityService: { invalidate: jest.Mock };
  let patientsService: {
    assertAccess: jest.Mock;
    assertTreatmentConsent: jest.Mock;
  };
  let calendarSync: { syncGroup: jest.Mock };
  let paymentsService: {
    ensureCharge: jest.Mock;
    findCheckoutForBooking: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      consultation: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
      },
      consultationHistory: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      calendarEventLink: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      reminderDispatch: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      bookedSlot: {
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ sessionDurationMinutes: 50 }),
      },
      // Lock FOR SHARE del paciente en createFromPublicBooking: por defecto
      // el paciente existe y no está eliminado.
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'patient-1' }]),
      $transaction: jest.fn((arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)(prisma);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    patientsService = {
      assertAccess: jest
        .fn()
        .mockResolvedValue({ id: 'patient-1', rut: '11111111-1' }),
      // La política de consentimiento (adulto/menor, fecha de vigencia) vive en
      // PatientsService.assertTreatmentConsent y se prueba allí; acá solo se
      // verifica que las consultas la invoquen dentro de la transacción.
      assertTreatmentConsent: jest.fn().mockResolvedValue(undefined),
    };
    calendarSync = { syncGroup: jest.fn().mockResolvedValue(undefined) };
    paymentsService = {
      ensureCharge: jest.fn().mockResolvedValue(undefined),
      findCheckoutForBooking: jest.fn().mockResolvedValue({ paymentUrl: null }),
    };

    availabilityService = { invalidate: jest.fn() };

    service = new ConsultationsService(
      prisma as unknown as PrismaService,
      patientsService as unknown as PatientsService,
      calendarSync as unknown as CalendarSyncService,
      paymentsService as unknown as PaymentsService,
      availabilityService as unknown as AvailabilityService,
    );
  });

  describe('create', () => {
    it('valida acceso al paciente antes de crear la consulta', async () => {
      patientsService.assertAccess.mockRejectedValue(
        new NotFoundException('Paciente no encontrado'),
      );

      await expect(
        service.create(
          {
            patientId: 'patient-1',
            sessionDate: '2026-01-10',
            consultReason: 'Motivo',
            intervention: 'Intervención',
          } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.consultation.create).not.toHaveBeenCalled();
    });

    it('invalida el cache de slots del terapeuta tras crear (issue #285)', async () => {
      prisma.consultation.create.mockResolvedValue(buildConsultation());

      await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        } as never,
        'therapist-1',
      );

      expect(availabilityService.invalidate).toHaveBeenCalledWith(
        'therapist-1',
      );
    });

    it('rechaza crear la consulta si el paciente no tiene consentimiento vigente (issue #131)', async () => {
      patientsService.assertTreatmentConsent.mockRejectedValue(
        new ForbiddenException('sin consentimiento'),
      );

      await expect(
        service.create(
          {
            patientId: 'patient-1',
            sessionDate: '2026-01-10',
            consultReason: 'Motivo',
            intervention: 'Intervención',
          } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.consultation.create).not.toHaveBeenCalled();
    });

    it('valida el consentimiento dentro de la transacción con el cliente tx (M2b)', async () => {
      prisma.consultation.create.mockResolvedValue(buildConsultation());

      await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        } as never,
        'therapist-1',
      );

      expect(patientsService.assertTreatmentConsent).toHaveBeenCalledWith(
        'patient-1',
        expect.stringContaining('crear la consulta') as unknown,
        prisma,
      );
    });

    it('usa el rut de la ficha del paciente', async () => {
      prisma.consultation.create.mockResolvedValue(buildConsultation());

      await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        } as never,
        'therapist-1',
      );

      expect(prisma.consultation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          patientId: 'patient-1',
          patientRut: '11111111-1',
          therapistId: 'therapist-1',
        }) as unknown,
      });
    });

    it('ignora un patientRut enviado por el cliente (issue #289)', async () => {
      prisma.consultation.create.mockResolvedValue(buildConsultation());

      await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
          patientRut: '99999999-9',
        } as never,
        'therapist-1',
      );

      expect(prisma.consultation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          patientRut: '11111111-1',
        }) as unknown,
      });
    });

    it('groupId de la primera versión es igual a su propio id', async () => {
      prisma.consultation.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(buildConsultation(data as never)),
      );

      const result = await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        } as never,
        'therapist-1',
      );

      expect(result.groupId).toBe(result.id);
    });

    // sdd/google-calendar-integration T5.5: design.md "create()/correct()
    // call void this.calendarSync.syncGroup(groupId).catch(log) after their
    // transaction commits".
    it('dispara calendarSync.syncGroup(groupId) tras persistir la consulta', async () => {
      prisma.consultation.create.mockResolvedValue(buildConsultation());

      await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        } as never,
        'therapist-1',
      );

      expect(calendarSync.syncGroup).toHaveBeenCalledWith('consultation-1');
    });

    it('un rechazo de calendarSync.syncGroup no impide que create() se resuelva (T non-blocking)', async () => {
      prisma.consultation.create.mockResolvedValue(buildConsultation());
      calendarSync.syncGroup.mockRejectedValue(
        new Error('Google no disponible'),
      );

      await expect(
        service.create(
          {
            patientId: 'patient-1',
            sessionDate: '2026-01-10',
            consultReason: 'Motivo',
            intervention: 'Intervención',
          } as never,
          'therapist-1',
        ),
      ).resolves.toEqual(expect.objectContaining({ id: 'consultation-1' }));
    });

    // sdd/online-payment-integration PR 1 (T2.5): design.md "Data Flow"
    // create()/correct() ──tx commit──→ void PaymentsService.ensureCharge(groupId)
    it('dispara paymentsService.ensureCharge(groupId) tras persistir la consulta', async () => {
      prisma.consultation.create.mockResolvedValue(buildConsultation());

      await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        } as never,
        'therapist-1',
      );

      expect(paymentsService.ensureCharge).toHaveBeenCalledWith(
        'consultation-1',
      );
    });

    it('guarda la duración vigente del terapeuta en la consulta (issue #336)', async () => {
      prisma.user.findUnique.mockResolvedValue({ sessionDurationMinutes: 45 });
      prisma.consultation.create.mockResolvedValue(buildConsultation());

      await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        } as never,
        'therapist-1',
      );

      expect(prisma.consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ durationMinutes: 45 }) as unknown,
        }),
      );
    });

    it('sin duración configurada usa el default del sistema (issue #336)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        sessionDurationMinutes: null,
      });
      prisma.consultation.create.mockResolvedValue(buildConsultation());

      await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        } as never,
        'therapist-1',
      );

      expect(prisma.consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            durationMinutes: DEFAULT_SESSION_MINUTES,
          }) as unknown,
        }),
      );
    });

    it('un rechazo de paymentsService.ensureCharge no impide que create() se resuelva (non-blocking)', async () => {
      prisma.consultation.create.mockResolvedValue(buildConsultation());
      paymentsService.ensureCharge.mockRejectedValue(
        new Error('Flow no disponible'),
      );

      await expect(
        service.create(
          {
            patientId: 'patient-1',
            sessionDate: '2026-01-10',
            consultReason: 'Motivo',
            intervention: 'Intervención',
          } as never,
          'therapist-1',
        ),
      ).resolves.toEqual(expect.objectContaining({ id: 'consultation-1' }));
    });
  });

  describe('findByPatient', () => {
    it('valida acceso y agrega el historial vigente por consulta', async () => {
      prisma.consultation.findMany.mockResolvedValue([buildConsultation()]);
      prisma.consultationHistory.findMany.mockResolvedValue([
        { consultationId: 'consultation-1', id: 'history-1' },
      ]);

      const result = await service.findByPatient('patient-1', 'therapist-1');

      expect(patientsService.assertAccess).toHaveBeenCalledWith(
        'patient-1',
        'therapist-1',
      );
      expect((result as { history: unknown[] }[])[0].history).toHaveLength(1);
    });

    // issue #140: mismo cap de seguridad que PatientsService.findAll.
    it('sin pagination aplica el cap de seguridad en vez de un findMany() sin límite', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);

      await service.findByPatient('patient-1', 'therapist-1');

      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: UNPAGINATED_SAFETY_LIMIT }),
      );
    });

    it('con pagination pagina con take/skip y devuelve total', async () => {
      prisma.consultation.findMany.mockResolvedValue([buildConsultation()]);
      prisma.consultation.count.mockResolvedValue(1);

      const result = await service.findByPatient('patient-1', 'therapist-1', {
        page: 1,
        pageSize: 5,
      });

      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 0 }),
      );
      expect(result).toEqual(expect.objectContaining({ total: 1 }));
    });

    // issue #163: mismo estado que expone findByRange, agregado en el
    // payload de findByPatient (usado por ConsultationsPage).
    it('agrega reminderEmailStatus null si nunca se despachó un recordatorio por email para esa consulta', async () => {
      prisma.consultation.findMany.mockResolvedValue([buildConsultation()]);

      const [result] = (await service.findByPatient(
        'patient-1',
        'therapist-1',
      )) as { reminderEmailStatus: unknown }[];

      expect(result.reminderEmailStatus).toBeNull();
    });

    // issue #271: sin paymentUrl la UI necesita el motivo del fallo.
    it('expone payment.lastError para mostrar por qué no se generó el cobro', async () => {
      prisma.consultation.findMany.mockResolvedValue([buildConsultation()]);
      const groupId = (buildConsultation() as { groupId: string }).groupId;
      prisma.payment.findMany.mockResolvedValue([
        {
          groupId,
          status: 'PENDING',
          linkDelivery: 'FAILED',
          paymentUrl: null,
          amount: 100,
          lastError: 'El monto mínimo para cobrar con Flow es $350.',
        },
      ]);

      const [result] = (await service.findByPatient(
        'patient-1',
        'therapist-1',
      )) as { payment: { lastError: string | null } }[];

      expect(result.payment.lastError).toBe(
        'El monto mínimo para cobrar con Flow es $350.',
      );
    });

    it('agrega el estado del ReminderDispatch EMAIL más reciente cuando existe (issue #163)', async () => {
      prisma.consultation.findMany.mockResolvedValue([buildConsultation()]);
      prisma.reminderDispatch.findMany.mockResolvedValue([
        {
          groupId: 'consultation-1',
          status: 'SENT',
          deliveredAt: null,
          openedAt: new Date('2026-01-11T09:00:00.000Z'),
        },
      ]);

      const [result] = (await service.findByPatient(
        'patient-1',
        'therapist-1',
      )) as { reminderEmailStatus: unknown }[];

      expect(result.reminderEmailStatus).toEqual({
        status: 'SENT',
        deliveredAt: null,
        openedAt: new Date('2026-01-11T09:00:00.000Z'),
      });
    });
  });

  describe('getStats', () => {
    it('cuenta el total y las próximas (nextSessionDate futura)', async () => {
      prisma.consultation.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(3);

      const result = await service.getStats('therapist-1');

      expect(result).toEqual({ total: 10, upcoming: 3 });
    });

    it('excluye las consultas de pacientes eliminados (issue #285)', async () => {
      prisma.consultation.count.mockResolvedValue(0);

      await service.getStats('therapist-1');

      expect(prisma.consultation.count).toHaveBeenCalledTimes(2);
      expect(prisma.consultation.count).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            patient: { deletedAt: null },
          }) as unknown,
        }),
      );
      expect(prisma.consultation.count).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            patient: { deletedAt: null },
          }) as unknown,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('lanza 404 si la consulta no existe', async () => {
      prisma.consultation.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('consultation-1', 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('valida acceso al paciente dueño de la consulta', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());

      await service.findOne('consultation-1', 'therapist-1');

      expect(patientsService.assertAccess).toHaveBeenCalledWith(
        'patient-1',
        'therapist-1',
      );
    });
  });

  describe('correct', () => {
    it('rechaza corregir la consulta si el paciente no tiene consentimiento vigente (issue #131)', async () => {
      prisma.consultation.findFirst.mockResolvedValueOnce(buildConsultation());
      patientsService.assertTreatmentConsent.mockRejectedValue(
        new ForbiddenException('sin consentimiento'),
      );

      await expect(
        service.correct(
          'consultation-1',
          { consultReason: 'Motivo corregido' } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      // Review R3-001 (issue #131): el chequeo de consentimiento ahora vive
      // DENTRO de la transacción junto con la escritura (cierra la ventana
      // de carrera), así que $transaction sí se invoca -- y su rollback
      // implícito evita que quede algo escrito.
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.consultationHistory.create).not.toHaveBeenCalled();
      expect(prisma.consultation.create).not.toHaveBeenCalled();
    });

    it('lanza 409 si la versión ya fue corregida', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce({ id: 'already-corrected' });

      await expect(
        service.correct(
          'consultation-1',
          { consultReason: 'Motivo corregido' } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('versión ya corregida tiene precedencia sobre falta de consentimiento — 409, no 403 (review R3-003)', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce({ id: 'already-corrected' });
      patientsService.assertTreatmentConsent.mockRejectedValue(
        new ForbiddenException('sin consentimiento'),
      );

      await expect(
        service.correct(
          'consultation-1',
          { consultReason: 'Motivo corregido' } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(ConflictException);
      // El chequeo de versión-ya-corregida corta antes de llegar a
      // consultar el consentimiento -- no es solo el mismo error, es que ni
      // siquiera se paga la consulta a assertTreatmentConsent.
      expect(patientsService.assertTreatmentConsent).not.toHaveBeenCalled();
    });

    it('crea una fila nueva sin modificar la original y guarda el snapshot previo', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
        }),
      );

      const result = await service.correct(
        'consultation-1',
        { consultReason: 'Motivo corregido' } as never,
        'therapist-1',
      );

      expect(prisma.consultationHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            consultationId: 'consultation-1',
            editedById: 'therapist-1',
          }) as unknown,
        }),
      );
      expect(prisma.consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            correctsId: 'consultation-1',
            consultReason: 'Motivo corregido',
          }) as unknown,
        }),
      );
      expect(result.id).toBe('consultation-2');
    });

    it('nextSessionDate null limpia la próxima sesión; omitido la conserva (issue #295)', async () => {
      const withNext = buildConsultation({
        nextSessionDate: new Date('2026-06-01T13:00:00Z'),
      });
      prisma.consultation.findFirst
        .mockResolvedValueOnce(withNext)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(withNext)
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({ id: 'consultation-2' }),
      );

      await service.correct(
        'consultation-1',
        { nextSessionDate: null } as never,
        'therapist-1',
      );
      expect(prisma.consultation.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ nextSessionDate: null }) as unknown,
        }),
      );

      await service.correct(
        'consultation-1',
        { consultReason: 'Otro' } as never,
        'therapist-1',
      );
      expect(prisma.consultation.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nextSessionDate: withNext.nextSessionDate,
          }) as unknown,
        }),
      );
    });

    it('la corrección conserva la duración de la consulta original (issue #336)', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation({ durationMinutes: 40 }))
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
        }),
      );

      await service.correct(
        'consultation-1',
        { consultReason: 'Motivo corregido' } as never,
        'therapist-1',
      );

      expect(prisma.consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ durationMinutes: 40 }) as unknown,
        }),
      );
    });

    // sdd/google-calendar-integration T5.6
    it('dispara calendarSync.syncGroup(groupId) tras persistir la corrección', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
        }),
      );

      await service.correct(
        'consultation-1',
        { consultReason: 'Motivo corregido' } as never,
        'therapist-1',
      );

      expect(calendarSync.syncGroup).toHaveBeenCalledWith('consultation-1');
    });

    it('un rechazo de calendarSync.syncGroup no impide que correct() se resuelva (T non-blocking)', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
        }),
      );
      calendarSync.syncGroup.mockRejectedValue(
        new Error('Google no disponible'),
      );

      await expect(
        service.correct(
          'consultation-1',
          { consultReason: 'Motivo corregido' } as never,
          'therapist-1',
        ),
      ).resolves.toEqual(expect.objectContaining({ id: 'consultation-2' }));
    });

    // issue #285: el BookedSlot debe seguir a la sesión movida.
    it('mueve el BookedSlot del grupo al nuevo horario cuando cambia sessionDate', async () => {
      const newDate = new Date('2026-01-12T15:00:00.000Z');
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
          sessionDate: newDate,
        }),
      );

      await service.correct(
        'consultation-1',
        { sessionDate: newDate.toISOString() } as never,
        'therapist-1',
      );

      expect(prisma.bookedSlot.updateMany).toHaveBeenCalledWith({
        where: { groupId: 'consultation-1' },
        data: { slotStart: newDate },
      });
    });

    it('invalida el cache de slots del terapeuta tras corregir (issue #285)', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({ id: 'consultation-2' }),
      );

      await service.correct(
        'consultation-1',
        { consultReason: 'Motivo corregido' } as never,
        'therapist-1',
      );

      expect(availabilityService.invalidate).toHaveBeenCalledWith(
        'therapist-1',
      );
    });

    it('no invalida el cache si la corrección falla (issue #285)', async () => {
      const newDate = new Date('2026-01-12T15:00:00.000Z');
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({ id: 'consultation-2', sessionDate: newDate }),
      );
      prisma.bookedSlot.updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.correct(
          'consultation-1',
          { sessionDate: newDate.toISOString() } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(availabilityService.invalidate).not.toHaveBeenCalled();
    });

    it('no toca el BookedSlot si sessionDate no cambia', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
        }),
      );

      await service.correct(
        'consultation-1',
        { consultReason: 'Motivo corregido' } as never,
        'therapist-1',
      );

      expect(prisma.bookedSlot.updateMany).not.toHaveBeenCalled();
    });

    it('traduce P2002 al mover el BookedSlot a un horario ya reservado en 409', async () => {
      const newDate = new Date('2026-01-12T15:00:00.000Z');
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
          sessionDate: newDate,
        }),
      );
      prisma.bookedSlot.updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.correct(
          'consultation-1',
          { sessionDate: newDate.toISOString() } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(calendarSync.syncGroup).not.toHaveBeenCalled();
    });

    it('no disfraza de 409 de horario un P2002 que no viene del BookedSlot', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint',
        { code: 'P2002', clientVersion: 'test' },
      );
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockRejectedValue(p2002);

      const result = service.correct(
        'consultation-1',
        { consultReason: 'Motivo corregido' } as never,
        'therapist-1',
      );

      await expect(result).rejects.toBe(p2002);
      await expect(result).rejects.not.toBeInstanceOf(ConflictException);
    });

    // sdd/online-payment-integration PR 1 (T2.5)
    it('dispara paymentsService.ensureCharge(groupId) tras persistir la corrección', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
        }),
      );

      await service.correct(
        'consultation-1',
        { consultReason: 'Motivo corregido' } as never,
        'therapist-1',
      );

      expect(paymentsService.ensureCharge).toHaveBeenCalledWith(
        'consultation-1',
      );
    });
  });

  // sdd/session-calendar-view PR1 (T1.2-1.4): design.md "Range query params
  // are ISO instants with explicit offset, half-open" + "Sync badge resolved
  // in the same response, via in-memory map" + "Grid payload excludes
  // clinical narrative".
  describe('findByRange', () => {
    const therapistId = 'therapist-1';

    function buildRangeConsultation(
      overrides: Partial<Consultation> & {
        patient?: { fullName: string };
      } = {},
    ) {
      const { patient, ...rest } = overrides;
      return {
        ...buildConsultation(rest),
        patient: patient ?? { fullName: 'Paciente Uno' },
      };
    }

    it('consulta filtrando therapistId, correctedBy null y deletedAt null dentro del rango solicitado', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);

      await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-10-01T00:00:00-03:00',
      });

      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            therapistId,
            correctedBy: null,
            deletedAt: null,
            patient: { deletedAt: null },
            sessionDate: {
              gte: new Date('2026-09-01T00:00:00-04:00'),
              lt: new Date('2026-10-01T00:00:00-03:00'),
            },
          },
        }) as unknown,
      );
    });

    it('el límite "to" es exclusivo (half-open) y "from" es inclusivo', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);

      await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-09-02T00:00:00-04:00',
      });

      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sessionDate: {
              gte: new Date('2026-09-01T00:00:00-04:00'),
              lt: new Date('2026-09-02T00:00:00-04:00'),
            },
          }) as unknown,
        }) as unknown,
      );
    });

    it('lanza BadRequestException si "to" es menor o igual a "from"', async () => {
      await expect(
        service.findByRange(therapistId, {
          from: '2026-09-05T00:00:00-04:00',
          to: '2026-09-05T00:00:00-04:00',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.consultation.findMany).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el rango solicitado supera los 62 días', async () => {
      await expect(
        service.findByRange(therapistId, {
          // 68 días
          from: '2026-01-01T00:00:00-04:00',
          to: '2026-03-10T00:00:00-04:00',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.consultation.findMany).not.toHaveBeenCalled();
    });

    it('acepta un rango de exactamente 62 días', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);

      await expect(
        service.findByRange(therapistId, {
          // exactamente 62 días
          from: '2026-01-01T00:00:00-04:00',
          to: '2026-03-04T00:00:00-04:00',
        }),
      ).resolves.toEqual([]);
    });

    it('arma un mapa de sincronización por groupId y lo fusiona en la respuesta', async () => {
      prisma.consultation.findMany.mockResolvedValue([
        buildRangeConsultation({
          id: 'c-1',
          groupId: 'group-1',
          patient: { fullName: 'Ana Paz' },
        }),
        buildRangeConsultation({
          id: 'c-2',
          groupId: 'group-2',
          patient: { fullName: 'Beto Ruiz' },
        }),
        buildRangeConsultation({
          id: 'c-3',
          groupId: 'group-3',
          patient: { fullName: 'Caro Diaz' },
        }),
      ] as never);
      prisma.calendarEventLink.findMany.mockResolvedValue([
        { groupId: 'group-1', syncStatus: 'SYNCED' },
        { groupId: 'group-2', syncStatus: 'FAILED' },
      ]);

      const result = await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-10-01T00:00:00-03:00',
      });

      expect(result.find((s) => s.groupId === 'group-1')?.calendarSync).toBe(
        'SYNCED',
      );
      expect(result.find((s) => s.groupId === 'group-2')?.calendarSync).toBe(
        'FAILED',
      );
      expect(
        result.find((s) => s.groupId === 'group-3')?.calendarSync,
      ).toBeNull();
      expect(prisma.calendarEventLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            connection: { therapistId },
            groupId: { in: ['group-1', 'group-2', 'group-3'] },
          }) as unknown,
        }) as unknown,
      );
    });

    it('devuelve solo los campos del contrato CalendarSession, sin PHI clínico', async () => {
      prisma.consultation.findMany.mockResolvedValue([
        buildRangeConsultation({
          id: 'c-1',
          groupId: 'group-1',
          patientId: 'patient-9',
          sessionDate: new Date('2026-09-10T15:00:00.000Z'),
          sessionType: 'TELEMED',
          patient: { fullName: 'Dana Vera' },
        }),
      ] as never);

      const [session] = await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-10-01T00:00:00-03:00',
      });

      expect(session).toEqual({
        id: 'c-1',
        groupId: 'group-1',
        sessionDate: '2026-09-10T15:00:00.000Z',
        sessionType: 'TELEMED',
        patientId: 'patient-9',
        patientName: 'Dana Vera',
        calendarSync: null,
        reminderEmailStatus: null,
      });
    });

    // issue #163: getReminderEmailStatusMap se queda con el ReminderDispatch
    // EMAIL más reciente por groupId (orderBy createdAt desc + "solo setear
    // la primera vez que se ve ese groupId").
    it('incluye el estado del ReminderDispatch EMAIL más reciente por groupId (issue #163)', async () => {
      prisma.consultation.findMany.mockResolvedValue([
        buildRangeConsultation({
          id: 'c-1',
          groupId: 'group-1',
          patient: { fullName: 'Ana Paz' },
        }),
        buildRangeConsultation({
          id: 'c-2',
          groupId: 'group-2',
          patient: { fullName: 'Beto Ruiz' },
        }),
      ] as never);
      prisma.reminderDispatch.findMany.mockResolvedValue([
        {
          groupId: 'group-1',
          status: 'SENT',
          deliveredAt: new Date('2026-09-10T16:00:00.000Z'),
          openedAt: null,
        },
      ]);

      const result = await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-10-01T00:00:00-03:00',
      });

      expect(
        result.find((s) => s.groupId === 'group-1')?.reminderEmailStatus,
      ).toEqual({
        status: 'SENT',
        deliveredAt: '2026-09-10T16:00:00.000Z',
        openedAt: null,
      });
      expect(
        result.find((s) => s.groupId === 'group-2')?.reminderEmailStatus,
      ).toBeNull();
      expect(prisma.reminderDispatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            groupId: { in: ['group-1', 'group-2'] },
            channel: 'EMAIL',
          }) as unknown,
        }) as unknown,
      );
    });

    it('no consulta calendarEventLink cuando no hay sesiones en el rango', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);

      const result = await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-10-01T00:00:00-03:00',
      });

      expect(result).toEqual([]);
      expect(prisma.calendarEventLink.findMany).not.toHaveBeenCalled();
    });
  });

  // sdd/patient-self-scheduling PR 3 (tasks.md 3.5, design.md Decision 1
  // "Double-booking guard"): BookedSlot es el guard REAL de concurrencia
  // (@@unique([therapistId, slotStart])) -- Consultation no puede llevar esa
  // constraint porque correct() inserta una fila nueva con el mismo
  // (therapistId, sessionDate) de la cadena. El recheck previo (buscar un
  // Consultation vigente que ya ocupe el slot) es un fast-fail para el caso
  // obvio (cache stale); el insert de BookedSlot es lo que realmente decide
  // bajo carrera concurrente (probado con Postgres real en
  // consultations.service.integration.spec.ts, tasks.md 3.11).
  describe('createFromPublicBooking', () => {
    const slotStart = new Date('2026-09-01T13:00:00.000Z');

    it('crea la consulta y el BookedSlot cuando el slot está libre', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.bookedSlot.create.mockResolvedValue({ id: 'booked-1' });
      const created = buildConsultation({ sessionDate: slotStart });
      prisma.consultation.create.mockResolvedValue(created);

      const result = await service.createFromPublicBooking(
        'therapist-1',
        'patient-1',
        '11111111-1',
        slotStart,
        50,
      );

      // Issue #299: la respuesta llega a un llamador anónimo -- solo id y
      // sessionDate, sin patientId/patientRut/therapistId/groupId.
      expect(result).toEqual({ id: created.id, sessionDate: slotStart });
      expect(prisma.bookedSlot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            therapistId: 'therapist-1',
            slotStart,
          }) as unknown,
        }),
      );
      expect(prisma.consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            therapistId: 'therapist-1',
            patientId: 'patient-1',
            patientRut: '11111111-1',
            sessionDate: slotStart,
            durationMinutes: 50,
          }) as unknown,
        }),
      );
    });

    // Regresión (tasks.md 3.9): el push de calendario debe tratar una
    // consulta creada por reserva pública IDÉNTICO a una creada por el
    // terapeuta -- mismo emitCalendarSync(groupId) fire-and-forget que
    // create()/correct() (calendar-sync spec.md "Publicly booked
    // consultation pushes a new event").
    it('dispara emitCalendarSync/emitPaymentCharge igual que create() (regresión calendar-sync)', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.bookedSlot.create.mockResolvedValue({ id: 'booked-1' });
      const created = buildConsultation({
        id: 'group-public-1',
        groupId: 'group-public-1',
        sessionDate: slotStart,
      });
      prisma.consultation.create.mockResolvedValue(created);

      await service.createFromPublicBooking(
        'therapist-1',
        'patient-1',
        '11111111-1',
        slotStart,
        50,
      );

      expect(calendarSync.syncGroup).toHaveBeenCalledWith('group-public-1');
      expect(paymentsService.ensureCharge).toHaveBeenCalledWith(
        'group-public-1',
      );
    });

    it('la respuesta no expone datos del paciente ni de la fila completa (issue #299)', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.bookedSlot.create.mockResolvedValue({ id: 'booked-1' });
      const created = buildConsultation({ sessionDate: slotStart });
      prisma.consultation.create.mockResolvedValue(created);

      const result = await service.createFromPublicBooking(
        'therapist-1',
        'patient-1',
        '11111111-1',
        slotStart,
        50,
      );

      expect(Object.keys(result).sort()).toEqual(['id', 'sessionDate']);
      expect(result).not.toHaveProperty('patientRut');
      expect(result).not.toHaveProperty('patientId');
      expect(result).not.toHaveProperty('checkoutUrl');
      expect(paymentsService.findCheckoutForBooking).not.toHaveBeenCalled();
    });

    // Issue #299: con un client externo el llamador es dueño de la
    // transacción -- no se abre otra ni se disparan efectos antes del commit.
    it('con client externo usa esa transacción y no dispara efectos post-commit', async () => {
      const tx = {
        consultation: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest
            .fn()
            .mockResolvedValue(buildConsultation({ sessionDate: slotStart })),
        },
        bookedSlot: { create: jest.fn().mockResolvedValue({ id: 'b' }) },
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'patient-1' }]),
      };

      await service.createFromPublicBooking(
        'therapist-1',
        'patient-1',
        '11111111-1',
        slotStart,
        50,
        tx as never,
      );

      expect(tx.consultation.create).toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(calendarSync.syncGroup).not.toHaveBeenCalled();
      expect(paymentsService.ensureCharge).not.toHaveBeenCalled();
      expect(availabilityService.invalidate).not.toHaveBeenCalled();
    });

    it('invalida el cache de slots del terapeuta tras la reserva (issue #285)', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.bookedSlot.create.mockResolvedValue({ id: 'booked-1' });
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({ sessionDate: slotStart }),
      );

      await service.createFromPublicBooking(
        'therapist-1',
        'patient-1',
        '11111111-1',
        slotStart,
        50,
      );

      expect(availabilityService.invalidate).toHaveBeenCalledWith(
        'therapist-1',
      );
    });

    it('recheck por intervalo: trae candidatos hasta MAX_SESSION_MINUTES antes del slot (issue #285/#336)', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.bookedSlot.create.mockResolvedValue({ id: 'booked-1' });
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({ sessionDate: slotStart }),
      );

      await service.createFromPublicBooking(
        'therapist-1',
        'patient-1',
        '11111111-1',
        slotStart,
        50,
      );

      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sessionDate: {
              gt: new Date('2026-08-31T13:00:00.000Z'),
              lt: new Date('2026-09-01T13:50:00.000Z'),
            },
          }) as unknown,
        }),
      );
    });

    // issue #336: el solape se decide con la duración guardada en la consulta
    // existente, no con la vigente del terapeuta.
    it('el terapeuta bajó la duración de 60 a 45: la cola de la sesión existente sigue ocupada (issue #336)', async () => {
      // Sesión existente 12:30-13:30 UTC (reservada con 60 min). Con la
      // duración vigente (45) se habría asumido que termina 13:15 y el slot
      // de las 13:15 habría quedado libre; con la guardada (60) sigue ocupado.
      prisma.consultation.findMany.mockResolvedValue([
        {
          sessionDate: new Date('2026-09-01T12:30:00.000Z'),
          durationMinutes: 60,
        },
      ]);

      await expect(
        service.createFromPublicBooking(
          'therapist-1',
          'patient-1',
          '11111111-1',
          new Date('2026-09-01T13:15:00.000Z'),
          45,
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.bookedSlot.create).not.toHaveBeenCalled();
    });

    it('una sesión existente que termina justo al inicio del slot no conflictúa (half-open, issue #336)', async () => {
      prisma.consultation.findMany.mockResolvedValue([
        {
          sessionDate: new Date('2026-09-01T12:30:00.000Z'),
          durationMinutes: 60,
        },
      ]);
      prisma.bookedSlot.create.mockResolvedValue({ id: 'booked-1' });
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({ sessionDate: slotStart }),
      );

      await expect(
        service.createFromPublicBooking(
          'therapist-1',
          'patient-1',
          '11111111-1',
          new Date('2026-09-01T13:30:00.000Z'),
          45,
        ),
      ).resolves.toBeDefined();
    });

    // issue #336: orden de locks User -> Patient.
    it('toma el lock FOR UPDATE del terapeuta antes del FOR SHARE del paciente', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.bookedSlot.create.mockResolvedValue({ id: 'booked-1' });
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({ sessionDate: slotStart }),
      );

      await service.createFromPublicBooking(
        'therapist-1',
        'patient-1',
        '11111111-1',
        slotStart,
        50,
      );

      const calls = prisma.$queryRaw.mock.calls as unknown[][];
      const sql = calls.map((call) =>
        (call[0] as TemplateStringsArray).join('?'),
      );
      expect(sql).toHaveLength(2);
      expect(sql[0]).toContain('"User"');
      expect(sql[0]).toContain('FOR UPDATE');
      expect(sql[1]).toContain('"Patient"');
      expect(sql[1]).toContain('FOR SHARE');
    });

    it('si el paciente fue eliminado (lock sin filas) lanza 409 sin escribir', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.createFromPublicBooking(
          'therapist-1',
          'patient-1',
          '11111111-1',
          slotStart,
          50,
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.bookedSlot.create).not.toHaveBeenCalled();
      expect(prisma.consultation.create).not.toHaveBeenCalled();
    });

    it('afterPublicBookingCommit dispara el sync y el cobro', () => {
      service.afterPublicBookingCommit('group-public-1', 'therapist-1');

      expect(calendarSync.syncGroup).toHaveBeenCalledWith('group-public-1');
      expect(paymentsService.ensureCharge).toHaveBeenCalledWith(
        'group-public-1',
      );
    });

    it('recheck: si ya existe una consulta vigente en ese horario, lanza 409 sin llegar a BookedSlot', async () => {
      prisma.consultation.findMany.mockResolvedValue([
        { sessionDate: slotStart, durationMinutes: 50 },
      ]);

      await expect(
        service.createFromPublicBooking(
          'therapist-1',
          'patient-1',
          '11111111-1',
          slotStart,
          50,
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.bookedSlot.create).not.toHaveBeenCalled();
      expect(prisma.consultation.create).not.toHaveBeenCalled();
    });

    // Triangulación: la violación de unicidad puede ocurrir recién en el
    // insert (dos requests concurrentes pasaron el recheck antes de que
    // cualquiera escribiera) -- P2002 de Prisma también debe traducirse a
    // 409, no propagar como 500.
    it('violación de unicidad en BookedSlot.create (P2002) se traduce a 409', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.bookedSlot.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createFromPublicBooking(
          'therapist-1',
          'patient-1',
          '11111111-1',
          slotStart,
          50,
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.consultation.create).not.toHaveBeenCalled();
    });
  });
});
