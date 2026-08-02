import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { CorrectConsultationDto } from './dto/correct-consultation.dto';

function parseDate(dateStr: string): Date {
  if (dateStr.includes('T') || dateStr.includes(' ')) {
    return new Date(dateStr);
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

const THERAPIST_SELECT = { therapist: { select: { name: true, email: true } } };

@Injectable()
export class ConsultationsService {
  constructor(
    private prisma: PrismaService,
    private patientsService: PatientsService,
  ) {}

  // T6.4 (issue #51): mismo motivo que PatientsService.create -- ADMIN no
  // tiene acceso a datos clínicos bajo ningún escenario, ni siquiera
  // creando una consulta que de todos modos no podría ver después.
  async create(dto: CreateConsultationDto, therapistId: string, userRole: string) {
    if (userRole === 'ADMIN') {
      throw new ForbiddenException('El rol ADMIN no tiene acceso a fichas clínicas');
    }
    let patientRut = dto.patientRut ?? '';
    if (!patientRut && dto.patientId) {
      const patient = await this.prisma.patient.findUnique({
        where: { id: dto.patientId },
        select: { rut: true },
      });
      patientRut = patient?.rut ?? '';
    }

    // Se genera el id de antemano para que groupId (el identificador de la
    // cadena de versiones) sea igual al id de esta primera versión.
    const id = randomUUID();

    return this.prisma.consultation.create({
      data: {
        id,
        groupId: id,
        patientId: dto.patientId,
        therapistId,
        sessionDate: parseDate(dto.sessionDate),
        consultReason: dto.consultReason,
        intervention: dto.intervention,
        agreements: dto.agreements,
        nextSessionDate: dto.nextSessionDate ? parseDate(dto.nextSessionDate) : null,
        sessionType: dto.sessionType ?? 'IN_PERSON',
        scheduledAt: dto.scheduledAt ? parseDate(dto.scheduledAt) : parseDate(dto.sessionDate),
        patientRut,
      },
    });
  }

  /**
   * El historial de correcciones vive en ConsultationHistory, siempre
   * indexado por groupId (el id de la primera versión de la cadena, que
   * nunca cambia) — no por el id de la fila que se esté mirando en ese
   * momento, para que cualquier versión de una consulta muestre el mismo
   * historial completo.
   */
  private async getHistory(
    groupId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return client.consultationHistory.findMany({
      where: { consultationId: groupId },
      orderBy: { editedAt: 'desc' },
      include: { editedBy: { select: { name: true, email: true } } },
    });
  }

  async findByPatient(patientId: string, userId: string, userRole: string) {
    // Lanza NotFoundException/ForbiddenException si el usuario no tiene acceso a este paciente
    await this.patientsService.findOne(patientId, userId, userRole);

    // Solo la versión vigente de cada consulta (correctedBy: null = nadie la corrigió después)
    const consultations = await this.prisma.consultation.findMany({
      where: { patientId, correctedBy: null, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: THERAPIST_SELECT,
    });

    return Promise.all(
      consultations.map(async (c) => ({
        ...c,
        history: await this.getHistory(c.groupId),
      })),
    );
  }

  async findOne(id: string, userId: string, userRole: string) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id, deletedAt: null },
      include: THERAPIST_SELECT,
    });
    if (!consultation) throw new NotFoundException('Consulta no encontrada');

    // Lanza ForbiddenException si el usuario no tiene acceso al paciente dueño de esta consulta
    await this.patientsService.findOne(consultation.patientId, userId, userRole);

    const history = await this.getHistory(consultation.groupId);

    return { ...consultation, history };
  }

  async correct(
    id: string,
    dto: CorrectConsultationDto,
    therapistId: string,
    userRole: string,
  ) {
    const original = await this.findOne(id, therapistId, userRole);

    const alreadySuperseded = await this.prisma.consultation.findFirst({
      where: { correctsId: id },
      select: { id: true },
    });
    if (alreadySuperseded) {
      throw new ConflictException(
        'Esta versión ya fue corregida — corrige la versión vigente en su lugar.',
      );
    }

    // Snapshot del estado actual antes de crear la corrección
    const snapshot = JSON.parse(JSON.stringify({
      sessionDate: original.sessionDate,
      consultReason: original.consultReason,
      intervention: original.intervention,
      agreements: original.agreements,
      nextSessionDate: original.nextSessionDate,
      sessionType: original.sessionType,
    }));

    return this.prisma.$transaction(async (tx) => {
      // El snapshot queda indexado por groupId, no por el id de la versión
      // que se está corrigiendo, para que el historial sea el mismo visto
      // desde cualquier versión de la cadena.
      await tx.consultationHistory.create({
        data: {
          consultationId: original.groupId,
          editedById: therapistId,
          snapshot,
        },
      });

      // Nunca se toca la fila original — se crea una fila nueva que la
      // sucede vía correctsId. La original queda bit a bit idéntica y
      // consultable por su id de siempre.
      const corrected = await tx.consultation.create({
        data: {
          groupId: original.groupId,
          patientId: original.patientId,
          therapistId: original.therapistId,
          sessionDate: dto.sessionDate ? parseDate(dto.sessionDate) : original.sessionDate,
          consultReason: dto.consultReason ?? original.consultReason,
          intervention: dto.intervention ?? original.intervention,
          agreements: dto.agreements ?? original.agreements,
          nextSessionDate: dto.nextSessionDate ? parseDate(dto.nextSessionDate) : original.nextSessionDate,
          sessionType: dto.sessionType ?? original.sessionType,
          scheduledAt: original.scheduledAt,
          reminderSent: original.reminderSent,
          patientRut: original.patientRut,
          correctsId: id,
        },
        include: THERAPIST_SELECT,
      });

      return { ...corrected, history: await this.getHistory(original.groupId, tx) };
    });
  }
}
