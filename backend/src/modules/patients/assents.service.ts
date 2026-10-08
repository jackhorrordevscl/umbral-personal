import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UNPAGINATED_SAFETY_LIMIT } from '../../common/dto/pagination.dto';
import { getAgeBand } from '../../common/utils/age.util';
import { PatientsService } from './patients.service';
import { RecordAssentDto } from './dto/record-assent.dto';

// Append-only ledger of the assent of a patient under 18 (informed and heard
// under 14, express assent from 14 to 17). It never replaces the guardian's
// consent and a refusal does not block anything: it alerts the therapist.
@Injectable()
export class AssentsService {
  private readonly logger = new Logger(AssentsService.name);

  constructor(
    private prisma: PrismaService,
    private patientsService: PatientsService,
  ) {}

  async list(patientId: string, therapistId: string) {
    await this.patientsService.assertAccess(patientId, therapistId);
    return this.prisma.patientAssent.findMany({
      where: { patientId },
      include: {
        recordedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { recordedAt: 'desc' },
      take: UNPAGINATED_SAFETY_LIMIT,
    });
  }

  async record(patientId: string, dto: RecordAssentDto, therapistId: string) {
    // Uniform 404 for a missing or foreign patient.
    const patient = await this.patientsService.assertAccess(
      patientId,
      therapistId,
    );

    const ageBand = getAgeBand(patient.birthDate);
    if (ageBand === 'ADULT') {
      throw new BadRequestException(
        'El asentimiento solo se registra para pacientes menores de 18 años.',
      );
    }

    if (dto.documentId) {
      const document = await this.prisma.patientDocument.findFirst({
        where: { id: dto.documentId, patientId, voidedAt: null },
        select: { id: true, type: true },
      });
      if (!document) {
        throw new BadRequestException(
          'El documento indicado no existe, está anulado o no pertenece a este paciente.',
        );
      }
      if (document.type !== 'INFORMED_ASSENT') {
        throw new BadRequestException(
          'El documento indicado no es un asentimiento informado.',
        );
      }
    }

    const assent = await this.prisma.patientAssent.create({
      data: {
        patientId,
        ageBand,
        action: dto.action,
        note: dto.note?.trim() || null,
        documentId: dto.documentId ?? null,
        recordedById: therapistId,
      },
    });
    this.logger.log(
      `Asentimiento registrado: id=${assent.id} patientId=${patientId} action=${dto.action} therapistId=${therapistId}`,
    );
    return assent;
  }
}
