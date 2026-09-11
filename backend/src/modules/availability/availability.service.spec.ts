import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AvailabilityService,
  computeAvailableSlots,
} from './availability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_SESSION_MINUTES } from '../calendar-integration/calendar-integration.constants';

// sdd/patient-self-scheduling PR 2 (design.md "Slot grid" + tasks.md 2.2/2.3/2.7):
// computeAvailableSlots is the pure core (Jest, fixed clock, no I/O) --
// AvailabilityService only wires Prisma + a 5-minute in-process cache around
// it (Testing Strategy: "Jest, pure computeSlots with fixed clock").
describe('computeAvailableSlots (pure)', () => {
  const NOW = new Date('2026-06-01T12:00:00.000Z'); // lunes, invierno (GMT-4)

  function baseInput(
    overrides: Partial<Parameters<typeof computeAvailableSlots>[0]> = {},
  ) {
    return {
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-08T00:00:00.000Z'),
      now: NOW,
      sessionDurationMinutes: 50,
      weeklyRules: [],
      blockouts: [],
      holidayDayKeys: new Set<string>(),
      occupiedConsultations: [],
      ...overrides,
    };
  }

  it('expande una regla semanal en slots de la duración configurada', () => {
    // Lunes 2026-06-01, ventana 09:00-13:00, sesiones de 50 min: 09:00,
    // 09:50, 10:40, 11:30 (11:30+50=12:20, el siguiente candidato 12:20+50
    // =13:10 > 13:00, no entra un quinto).
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
        ],
        now: new Date('2026-05-01T00:00:00.000Z'), // lejos, para no chocar con el lead time
      }),
    );

    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({
      start: '2026-06-01T13:00:00.000Z', // 09:00 Chile GMT-4
      end: '2026-06-01T13:50:00.000Z',
    });
    expect(result[3].start).toBe('2026-06-01T15:30:00.000Z'); // 11:30 Chile
  });

  // Triangulación: otro día/otra duración -> otra cantidad de slots, no hardcodeado.
  it('con una duración distinta produce una cantidad distinta de slots', () => {
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
        ],
        sessionDurationMinutes: 60,
        now: new Date('2026-05-01T00:00:00.000Z'),
      }),
    );
    // 09:00, 10:00, 11:00, 12:00 (13:00 sería el borde exacto -> no cabe otro)
    expect(result).toHaveLength(4);
  });

  it('un blockout de día completo elimina todos los slots de ese día', () => {
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
        ],
        blockouts: [
          {
            startsAt: new Date('2026-06-01T00:00:00.000Z'),
            endsAt: new Date('2026-06-02T00:00:00.000Z'),
          },
        ],
        now: new Date('2026-05-01T00:00:00.000Z'),
      }),
    );
    expect(result).toHaveLength(0);
  });

  it('un blockout parcial elimina solo los slots que se solapan con su rango', () => {
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
        ],
        // 10:00-11:00 Chile (GMT-4) = 14:00-15:00 UTC -- se solapa con el slot
        // de 09:50 (09:50-10:40 Chile) y el de 10:40 (10:40-11:30 Chile).
        blockouts: [
          {
            startsAt: new Date('2026-06-01T14:00:00.000Z'),
            endsAt: new Date('2026-06-01T15:00:00.000Z'),
          },
        ],
        now: new Date('2026-05-01T00:00:00.000Z'),
      }),
    );
    // De los 4 slots posibles (09:00, 09:50, 10:40, 11:30), 09:50 y 10:40 se
    // solapan con el blockout 10:00-11:00 y quedan excluidos; quedan 2.
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.start)).not.toContain(
      '2026-06-01T13:50:00.000Z',
    );
    expect(result.map((s) => s.start)).not.toContain(
      '2026-06-01T14:40:00.000Z',
    );
  });

  it('un feriado elimina todos los slots de ese día calendario, sin configuración del terapeuta', () => {
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
        ],
        holidayDayKeys: new Set(['2026-06-01']),
        now: new Date('2026-05-01T00:00:00.000Z'),
      }),
    );
    expect(result).toHaveLength(0);
  });

  it('una consulta existente elimina el slot que ocupa', () => {
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
        ],
        // sessionDate = 09:00 Chile = 13:00 UTC -> ocupa el primer slot.
        occupiedConsultations: [
          { sessionDate: new Date('2026-06-01T13:00:00.000Z') },
        ],
        now: new Date('2026-05-01T00:00:00.000Z'),
      }),
    );
    // De los 4 slots posibles, el ocupado por la consulta (09:00 Chile)
    // queda excluido; quedan 3.
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.start)).not.toContain(
      '2026-06-01T13:00:00.000Z',
    );
  });

  it('rechaza slots dentro de las 24 horas mínimas de anticipación', () => {
    // now = 2026-06-01T12:00:00Z; el slot de las 09:00 Chile (13:00Z) del
    // mismo día cae dentro de las próximas 24h -> no debe devolverse.
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
        ],
        from: new Date('2026-06-01T00:00:00.000Z'),
        to: new Date('2026-06-02T00:00:00.000Z'),
        now: NOW, // 2026-06-01T12:00:00Z
      }),
    );
    expect(result).toHaveLength(0);
  });

  it('acepta un slot justo fuera de la ventana de 24 horas', () => {
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [
          { dayOfWeek: 2, startMinute: 9 * 60, endMinute: 10 * 60 },
        ], // martes
        from: new Date('2026-06-01T00:00:00.000Z'),
        to: new Date('2026-06-03T00:00:00.000Z'),
        now: NOW, // 2026-06-01T12:00:00Z -> +24h = 2026-06-02T12:00:00Z
      }),
    );
    // martes 2026-06-02 09:00 Chile = 13:00Z, posterior a las 12:00Z del límite.
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe('2026-06-02T13:00:00.000Z');
  });

  it('rechaza slots más allá del horizonte máximo de 60 días', () => {
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 },
        ],
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-08T00:00:00.000Z'),
        now: NOW, // 2026-06-01T12:00:00Z + 60d = 2026-07-31T12:00:00Z
      }),
    );
    expect(result).toHaveLength(0);
  });

  it('DST -- gap de horario de verano: el slot cuya hora no existe se omite en vez de romper', () => {
    // 2026-09-06 es domingo (weekday 7); 00:00-00:59 no existe ese día
    // (chile-time.util.spec.ts). Una regla 00:00-02:00 con sesiones de 60 min
    // pediría slots en 00:00 y 01:00 -- el primero no existe y debe omitirse,
    // el segundo sí existe (primera hora real tras el gap).
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [{ dayOfWeek: 7, startMinute: 0, endMinute: 2 * 60 }],
        sessionDurationMinutes: 60,
        from: new Date('2026-09-06T00:00:00.000Z'),
        to: new Date('2026-09-07T00:00:00.000Z'),
        now: new Date('2026-08-01T00:00:00.000Z'), // dentro de las 24h/60d de 2026-09-06
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe('2026-09-06T04:00:00.000Z'); // 01:00 Chile, primera hora tras el gap
  });

  it('DST -- hora repetida al terminar el horario de verano: genera el slot en la PRIMERA ocurrencia', () => {
    // 2026-04-04 es sábado (weekday 6); 23:00 ocurre dos veces. Una regla
    // 23:00-24:00 (1440 min) de 60 min debe anclar al primer instante real.
    const result = computeAvailableSlots(
      baseInput({
        weeklyRules: [
          { dayOfWeek: 6, startMinute: 23 * 60, endMinute: 24 * 60 },
        ],
        sessionDurationMinutes: 60,
        from: new Date('2026-04-04T00:00:00.000Z'),
        to: new Date('2026-04-05T12:00:00.000Z'),
        now: new Date('2026-03-01T00:00:00.000Z'), // dentro de las 24h/60d del rango
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe('2026-04-05T02:00:00.000Z');
  });

  it('sin reglas semanales no hay slots', () => {
    expect(computeAvailableSlots(baseInput())).toEqual([]);
  });
});

describe('AvailabilityService (cache)', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    therapistAvailability: { findMany: jest.Mock };
    availabilityBlockout: { findMany: jest.Mock };
    publicHoliday: { findMany: jest.Mock };
    consultation: { findMany: jest.Mock };
  };
  let service: AvailabilityService;

  const from = new Date('2026-06-01T00:00:00.000Z');
  const to = new Date('2026-06-08T00:00:00.000Z');
  const now = new Date('2026-05-01T00:00:00.000Z');

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ sessionDurationMinutes: 50 }),
      },
      therapistAvailability: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 },
          ]),
      },
      availabilityBlockout: { findMany: jest.fn().mockResolvedValue([]) },
      publicHoliday: { findMany: jest.fn().mockResolvedValue([]) },
      consultation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new AvailabilityService(prisma as unknown as PrismaService);
  });

  it('reutiliza el resultado cacheado dentro de la ventana de ~5 minutos', async () => {
    const first = await service.computeSlots('therapist-1', from, to, now);
    const second = await service.computeSlots(
      'therapist-1',
      from,
      to,
      new Date(now.getTime() + 4 * 60 * 1000),
    );

    expect(second).toEqual(first);
    expect(prisma.therapistAvailability.findMany).toHaveBeenCalledTimes(1);
  });

  // Triangulación: fuera de la ventana de cache, recalcula.
  it('recalcula una vez expirado el TTL del cache', async () => {
    await service.computeSlots('therapist-1', from, to, now);
    await service.computeSlots(
      'therapist-1',
      from,
      to,
      new Date(now.getTime() + 6 * 60 * 1000),
    );

    expect(prisma.therapistAvailability.findMany).toHaveBeenCalledTimes(2);
  });

  it('invalidate() fuerza un recálculo aunque el TTL siga vigente', async () => {
    await service.computeSlots('therapist-1', from, to, now);
    service.invalidate('therapist-1');
    await service.computeSlots(
      'therapist-1',
      from,
      to,
      new Date(now.getTime() + 1000),
    );

    expect(prisma.therapistAvailability.findMany).toHaveBeenCalledTimes(2);
  });
});

// sdd/patient-self-scheduling PR 2 (tasks.md 2.4): CRUD que respalda
// AvailabilityController -- schedule (grid + sessionDurationMinutes,
// guardado atómico) y blockouts.
describe('AvailabilityService (CRUD)', () => {
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    therapistAvailability: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
    availabilityBlockout: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: AvailabilityService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ sessionDurationMinutes: 50 }),
        update: jest.fn(),
      },
      therapistAvailability: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      availabilityBlockout: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      // Mismo criterio que patients.service.spec.ts: el caso callback
      // (usado en saveSchedule) alcanza con invocar la función pasándole el
      // propio mock de prisma como `tx`.
      $transaction: jest.fn((arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)(prisma);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    service = new AvailabilityService(prisma as unknown as PrismaService);
  });

  describe('getSchedule', () => {
    it('devuelve sessionDurationMinutes y las entries del terapeuta', async () => {
      prisma.user.findUnique.mockResolvedValue({ sessionDurationMinutes: 45 });
      prisma.therapistAvailability.findMany.mockResolvedValue([
        { id: 'entry-1', dayOfWeek: 1, startMinute: 540, endMinute: 780 },
      ]);

      const result = await service.getSchedule('therapist-1');

      expect(result).toEqual({
        sessionDurationMinutes: 45,
        entries: [
          { id: 'entry-1', dayOfWeek: 1, startMinute: 540, endMinute: 780 },
        ],
      });
    });

    // Triangulación: sin duración configurada, cae al default del sistema.
    it('sin sessionDurationMinutes configurado usa el default del sistema', async () => {
      prisma.user.findUnique.mockResolvedValue({
        sessionDurationMinutes: null,
      });

      const result = await service.getSchedule('therapist-1');

      expect(result.sessionDurationMinutes).toBe(DEFAULT_SESSION_MINUTES);
    });
  });

  describe('saveSchedule', () => {
    it('reemplaza las entries y actualiza la duración en una transacción', async () => {
      await service.saveSchedule('therapist-1', {
        sessionDurationMinutes: 60,
        entries: [{ dayOfWeek: 1, startMinute: 540, endMinute: 780 }],
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.therapistAvailability.deleteMany).toHaveBeenCalledWith({
        where: { therapistId: 'therapist-1' },
      });
      expect(prisma.therapistAvailability.createMany).toHaveBeenCalledWith({
        data: [
          {
            therapistId: 'therapist-1',
            dayOfWeek: 1,
            startMinute: 540,
            endMinute: 780,
          },
        ],
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'therapist-1' },
        data: { sessionDurationMinutes: 60 },
      });
    });

    it('invalida el cache del terapeuta tras guardar', async () => {
      const invalidateSpy = jest.spyOn(service, 'invalidate');

      await service.saveSchedule('therapist-1', {
        sessionDurationMinutes: 60,
        entries: [],
      });

      expect(invalidateSpy).toHaveBeenCalledWith('therapist-1');
    });

    // Bug reportado en pruebas manuales: dos entries idénticas (mismo día,
    // mismo horario) llegaban intactas hasta el unique constraint de Postgres
    // (therapistId, dayOfWeek, startMinute) y explotaban como 500 crudo en
    // vez de un 400 legible -- nada entre el DTO y el service las rechazaba.
    it('rechaza dos entries del mismo día con el mismo horario', async () => {
      await expect(
        service.saveSchedule('therapist-1', {
          sessionDurationMinutes: 60,
          entries: [
            { dayOfWeek: 1, startMinute: 600, endMinute: 720 },
            { dayOfWeek: 1, startMinute: 600, endMinute: 720 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.therapistAvailability.createMany).not.toHaveBeenCalled();
    });

    // Triangulación: el mismo problema con horarios que se pisan sin ser
    // idénticos (09:00-11:00 y 10:00-12:00 el mismo lunes) no viola el
    // unique constraint (distinto startMinute) pero es igual de inválido
    // desde el punto de vista de negocio -- dos slots del mismo terapeuta no
    // pueden coexistir en el mismo rango horario de un día.
    it('rechaza dos entries del mismo día que se superponen sin ser idénticas', async () => {
      await expect(
        service.saveSchedule('therapist-1', {
          sessionDurationMinutes: 60,
          entries: [
            { dayOfWeek: 1, startMinute: 540, endMinute: 660 },
            { dayOfWeek: 1, startMinute: 600, endMinute: 720 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // Reportado por el usuario probando el flujo real: el mensaje original
    // exponía dayOfWeek numérico y minutos desde medianoche ("día 4",
    // "540-900"), ilegible para un terapeuta. Debe leer nombre del día y
    // horas HH:MM.
    it('el mensaje de superposición usa nombre de día y horas legibles', async () => {
      await expect(
        service.saveSchedule('therapist-1', {
          sessionDurationMinutes: 60,
          entries: [
            { dayOfWeek: 4, startMinute: 540, endMinute: 900 },
            { dayOfWeek: 4, startMinute: 540, endMinute: 600 },
          ],
        }),
      ).rejects.toThrow(
        'jueves tiene horarios que se superponen: 09:00–15:00 y 09:00–10:00',
      );
    });

    it('acepta entries del mismo día que no se superponen', async () => {
      await service.saveSchedule('therapist-1', {
        sessionDurationMinutes: 60,
        entries: [
          { dayOfWeek: 1, startMinute: 540, endMinute: 600 },
          { dayOfWeek: 1, startMinute: 600, endMinute: 720 },
        ],
      });

      expect(prisma.therapistAvailability.createMany).toHaveBeenCalled();
    });
  });

  describe('listBlockouts', () => {
    it('devuelve los blockouts del terapeuta ordenados por startsAt', async () => {
      const blockouts = [
        {
          id: 'b1',
          startsAt: new Date('2026-06-01'),
          endsAt: new Date('2026-06-02'),
          kind: 'FULL_DAY',
          reason: null,
        },
      ];
      prisma.availabilityBlockout.findMany.mockResolvedValue(blockouts);

      const result = await service.listBlockouts('therapist-1');

      expect(result).toBe(blockouts);
      expect(prisma.availabilityBlockout.findMany).toHaveBeenCalledWith({
        where: { therapistId: 'therapist-1' },
        orderBy: { startsAt: 'asc' },
      });
    });
  });

  describe('createBlockout', () => {
    it('crea el blockout scopeado al terapeuta e invalida el cache', async () => {
      const dto = {
        startsAt: new Date('2026-06-08'),
        endsAt: new Date('2026-06-09'),
        kind: 'FULL_DAY' as const,
      };
      const created = { id: 'b1', therapistId: 'therapist-1', ...dto };
      prisma.availabilityBlockout.create.mockResolvedValue(created);
      const invalidateSpy = jest.spyOn(service, 'invalidate');

      const result = await service.createBlockout('therapist-1', dto);

      expect(result).toBe(created);
      expect(prisma.availabilityBlockout.create).toHaveBeenCalledWith({
        data: { ...dto, therapistId: 'therapist-1' },
      });
      expect(invalidateSpy).toHaveBeenCalledWith('therapist-1');
    });
  });

  describe('deleteBlockout', () => {
    it('elimina el blockout cuando pertenece al terapeuta', async () => {
      prisma.availabilityBlockout.findFirst.mockResolvedValue({ id: 'b1' });
      const invalidateSpy = jest.spyOn(service, 'invalidate');

      await service.deleteBlockout('b1', 'therapist-1');

      expect(prisma.availabilityBlockout.findFirst).toHaveBeenCalledWith({
        where: { id: 'b1', therapistId: 'therapist-1' },
        select: { id: true },
      });
      expect(prisma.availabilityBlockout.delete).toHaveBeenCalledWith({
        where: { id: 'b1' },
      });
      expect(invalidateSpy).toHaveBeenCalledWith('therapist-1');
    });

    // Mismo criterio de no-distinción que PatientsService.assertAccess: no
    // existe vs. pertenece a otro terapeuta deben verse igual desde afuera.
    it('lanza NotFoundException cuando el blockout no existe o es de otro terapeuta', async () => {
      prisma.availabilityBlockout.findFirst.mockResolvedValue(null);

      await expect(service.deleteBlockout('b1', 'therapist-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.availabilityBlockout.delete).not.toHaveBeenCalled();
    });
  });
});
