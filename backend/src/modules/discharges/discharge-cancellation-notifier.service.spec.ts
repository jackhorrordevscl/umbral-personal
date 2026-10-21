import { DischargeCancellationNotifier } from './discharge-cancellation-notifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const SESSIONS = [
  { sessionDate: new Date('2026-10-20T14:00:00.000Z') },
  { sessionDate: new Date('2026-10-27T14:00:00.000Z') },
];

const ADULT_BIRTH = new Date('1990-05-20T00:00:00.000Z');
const MINOR_BIRTH = new Date('2015-05-20T00:00:00.000Z');

function discharge(patient: Record<string, unknown> = {}) {
  return {
    patientId: 'patient-1',
    therapist: { name: 'Dra. Pérez' },
    patient: {
      fullName: 'Luis Soto',
      email: 'luis@example.com',
      birthDate: ADULT_BIRTH,
      ...patient,
    },
  };
}

describe('DischargeCancellationNotifier (T4b)', () => {
  let notifier: DischargeCancellationNotifier;
  let prisma: {
    consultation: { findMany: jest.Mock };
    treatmentDischarge: { findUnique: jest.Mock };
    legalGuardian: { findMany: jest.Mock };
  };
  let mail: { sendConsultationCancelledEmail: jest.Mock };

  beforeEach(() => {
    prisma = {
      consultation: { findMany: jest.fn().mockResolvedValue(SESSIONS) },
      treatmentDischarge: {
        findUnique: jest.fn().mockResolvedValue(discharge()),
      },
      legalGuardian: { findMany: jest.fn().mockResolvedValue([]) },
    };
    mail = {
      sendConsultationCancelledEmail: jest.fn().mockResolvedValue(true),
    };
    notifier = new DischargeCancellationNotifier(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
    );
  });

  it('avisa al paciente adulto con todas las fechas canceladas en un solo mail', async () => {
    await notifier.notify('dis-1');

    expect(prisma.consultation.findMany).toHaveBeenCalledWith({
      where: { cancelledByDischargeId: 'dis-1' },
      select: { sessionDate: true },
      orderBy: { sessionDate: 'asc' },
    });
    expect(mail.sendConsultationCancelledEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendConsultationCancelledEmail).toHaveBeenCalledWith(
      'luis@example.com',
      'Luis Soto',
      'Dra. Pérez',
      [SESSIONS[0].sessionDate, SESSIONS[1].sessionDate],
    );
    expect(prisma.legalGuardian.findMany).not.toHaveBeenCalled();
  });

  it('si el cierre no canceló consultas no envía nada', async () => {
    prisma.consultation.findMany.mockResolvedValue([]);

    await notifier.notify('dis-1');

    expect(mail.sendConsultationCancelledEmail).not.toHaveBeenCalled();
    expect(prisma.treatmentDischarge.findUnique).not.toHaveBeenCalled();
  });

  it('un paciente adulto sin email no recibe aviso y no falla', async () => {
    prisma.treatmentDischarge.findUnique.mockResolvedValue(
      discharge({ email: null }),
    );

    await expect(notifier.notify('dis-1')).resolves.toBeUndefined();
    expect(mail.sendConsultationCancelledEmail).not.toHaveBeenCalled();
  });

  it('a un NNA se avisa solo a los representantes que reciben comunicaciones y nunca a su propio email', async () => {
    prisma.treatmentDischarge.findUnique.mockResolvedValue(
      discharge({ birthDate: MINOR_BIRTH, email: 'menor@example.com' }),
    );
    prisma.legalGuardian.findMany.mockResolvedValue([
      { fullName: 'María Soto', email: 'maria@example.com' },
    ]);

    await notifier.notify('dis-1');

    expect(prisma.legalGuardian.findMany).toHaveBeenCalledWith({
      where: {
        patientId: 'patient-1',
        receivesCommunications: true,
        email: { not: null },
      },
      select: { fullName: true, email: true },
    });
    expect(mail.sendConsultationCancelledEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendConsultationCancelledEmail).toHaveBeenCalledWith(
      'maria@example.com',
      'María Soto',
      'Dra. Pérez',
      [SESSIONS[0].sessionDate, SESSIONS[1].sessionDate],
    );
  });

  it('a un NNA sin representantes elegibles no se le envía nada', async () => {
    prisma.treatmentDischarge.findUnique.mockResolvedValue(
      discharge({ birthDate: MINOR_BIRTH, email: 'menor@example.com' }),
    );

    await notifier.notify('dis-1');

    expect(mail.sendConsultationCancelledEmail).not.toHaveBeenCalled();
  });

  it('el fallo de un envío no impide los demás ni lanza', async () => {
    prisma.treatmentDischarge.findUnique.mockResolvedValue(
      discharge({ birthDate: MINOR_BIRTH }),
    );
    prisma.legalGuardian.findMany.mockResolvedValue([
      { fullName: 'María Soto', email: 'maria@example.com' },
      { fullName: 'Pedro Soto', email: 'pedro@example.com' },
    ]);
    mail.sendConsultationCancelledEmail
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);

    await expect(notifier.notify('dis-1')).resolves.toBeUndefined();
    expect(mail.sendConsultationCancelledEmail).toHaveBeenCalledTimes(2);
  });

  it('un error de base de datos se registra y no se propaga', async () => {
    prisma.consultation.findMany.mockRejectedValue(new Error('db down'));

    await expect(notifier.notify('dis-1')).resolves.toBeUndefined();
    expect(mail.sendConsultationCancelledEmail).not.toHaveBeenCalled();
  });
});
