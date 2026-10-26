import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DischargeDelivery } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isMinor } from '../../common/utils/age.util';
import { logAuditFailOpen } from '../../common/utils/audit-fail-open.util';
import { CreateDischargeDeliveryDto } from './dto/create-discharge-delivery.dto';

interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
}

interface RecipientData {
  recipientName: string;
  guardianId: string | null;
  authorizationDocumentId: string | null;
  authorizationAttested: boolean;
}

// Registro de entregas del informe de alta (T4). Solo agrega filas: una entrega
// es un hecho ya ocurrido, no se edita ni se borra. Aislamiento por terapeuta:
// el informe se busca siempre por therapistId (404 uniforme si es ajeno).
@Injectable()
export class DischargeDeliveriesService {
  private readonly logger = new Logger(DischargeDeliveriesService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async record(
    dischargeId: string,
    dto: CreateDischargeDeliveryDto,
    therapistId: string,
    ctx: AuditContext,
  ): Promise<DischargeDelivery> {
    const discharge = await this.findOwned(dischargeId, therapistId);
    if (discharge.status !== 'ISSUED') {
      throw new ConflictException(
        'Solo se puede registrar la entrega de un informe emitido.',
      );
    }
    // Una versión reemplazada ya no es lo que hay que entregar, y la entrega no
    // guarda versión ni hash: registrarla dejaría una constancia ambigua.
    if (discharge.correctedBy) {
      throw new ConflictException(
        'Este informe fue reemplazado por una versión más reciente: entrega la versión vigente.',
      );
    }
    if (discharge.document?.voidedAt) {
      throw new ConflictException(
        'El PDF de este informe fue anulado: no se puede registrar su entrega.',
      );
    }

    const recipient = await this.resolveRecipient(dto, discharge);

    const delivery = await this.prisma.dischargeDelivery.create({
      data: {
        dischargeId: discharge.id,
        recipientType: dto.recipientType,
        recipientName: recipient.recipientName,
        guardianId: recipient.guardianId,
        authorizationDocumentId: recipient.authorizationDocumentId,
        authorizationAttested: recipient.authorizationAttested,
        purpose: dto.purpose,
        channel: dto.channel,
        recordedById: therapistId,
      },
    });

    // Sin nombres ni finalidad: el log de auditoría no replica datos personales.
    await logAuditFailOpen(this.auditService, this.logger, {
      userId: therapistId,
      action: 'DISCHARGE_DELIVER',
      resource: 'Discharge',
      resourceId: discharge.id,
      detail: `deliveryId=${delivery.id} recipientType=${dto.recipientType} channel=${dto.channel} authorizationAttested=${recipient.authorizationAttested}`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return delivery;
  }

  async list(
    dischargeId: string,
    therapistId: string,
  ): Promise<(DischargeDelivery & { authorizationVoidedAt: Date | null })[]> {
    const discharge = await this.findOwned(dischargeId, therapistId);
    const deliveries = await this.prisma.dischargeDelivery.findMany({
      where: { dischargeId: discharge.id },
      orderBy: { deliveredAt: 'desc' },
      include: { authorizationDocument: { select: { voidedAt: true } } },
    });
    // La autorización puede anularse después de entregar: la entrega no se
    // toca, el listado solo deja ver la anulación.
    return deliveries.map(({ authorizationDocument, ...delivery }) => ({
      ...delivery,
      authorizationVoidedAt: authorizationDocument?.voidedAt ?? null,
    }));
  }

  private async findOwned(dischargeId: string, therapistId: string) {
    const discharge = await this.prisma.treatmentDischarge.findFirst({
      where: { id: dischargeId, therapistId, patient: { deletedAt: null } },
      select: {
        id: true,
        patientId: true,
        status: true,
        correctedBy: { select: { id: true } },
        document: { select: { voidedAt: true } },
        patient: { select: { fullName: true, birthDate: true } },
      },
    });
    if (!discharge) throw new NotFoundException('Informe no encontrado');
    return discharge;
  }

  // Cada tipo de destinatario admite solo sus campos: lo que no corresponde se
  // rechaza en vez de ignorarse, para que el registro no diga más ni menos que
  // lo que el terapeuta quiso dejar asentado.
  private async resolveRecipient(
    dto: CreateDischargeDeliveryDto,
    discharge: {
      patientId: string;
      patient: { fullName: string; birthDate: Date };
    },
  ): Promise<RecipientData> {
    const hasName = dto.recipientName != null;
    const hasGuardian = dto.guardianId != null;
    const hasAuthorization = dto.authorizationDocumentId != null;

    switch (dto.recipientType) {
      case 'PATIENT': {
        this.assertOnly(dto, {
          name: false,
          guardian: false,
          auth: false,
          attested: false,
        });
        if (isMinor(discharge.patient.birthDate)) {
          throw new BadRequestException(
            'El paciente tiene menos de 18 años: el informe se entrega a su representante.',
          );
        }
        return {
          recipientName: discharge.patient.fullName,
          guardianId: null,
          authorizationDocumentId: null,
          authorizationAttested: false,
        };
      }
      case 'GUARDIAN': {
        this.assertOnly(dto, {
          name: false,
          guardian: true,
          auth: false,
          attested: false,
        });
        if (!hasGuardian) {
          throw new BadRequestException(
            'Indica el representante que recibe el informe.',
          );
        }
        const guardian = await this.prisma.legalGuardian.findFirst({
          where: {
            id: dto.guardianId,
            patientId: discharge.patientId,
            canAccessReports: true,
          },
          select: { id: true, fullName: true },
        });
        if (!guardian) {
          throw new BadRequestException(
            'El representante no existe o no tiene autorizado el acceso a informes.',
          );
        }
        return {
          recipientName: guardian.fullName,
          guardianId: guardian.id,
          authorizationDocumentId: null,
          authorizationAttested: false,
        };
      }
      case 'THIRD_PARTY': {
        this.assertOnly(dto, {
          name: true,
          guardian: false,
          auth: true,
          attested: true,
        });
        if (!hasName) {
          throw new BadRequestException(
            'Indica el nombre del tercero que recibe el informe.',
          );
        }
        if (!hasAuthorization) {
          throw new BadRequestException(
            'Entregar el informe a un tercero requiere una autorización registrada.',
          );
        }
        if (dto.authorizationAttested !== true) {
          throw new BadRequestException(
            'Confirma que revisaste la autorización antes de entregar el informe a un tercero.',
          );
        }
        const authorization = await this.prisma.patientDocument.findFirst({
          where: {
            id: dto.authorizationDocumentId,
            patientId: discharge.patientId,
            type: 'DELIVERY_AUTHORIZATION',
            voidedAt: null,
          },
          select: { id: true },
        });
        if (!authorization) {
          throw new BadRequestException(
            'La autorización indicada no existe o no es válida para este paciente.',
          );
        }
        return {
          recipientName: dto.recipientName as string,
          guardianId: null,
          authorizationDocumentId: authorization.id,
          authorizationAttested: true,
        };
      }
    }
  }

  private assertOnly(
    dto: CreateDischargeDeliveryDto,
    allowed: {
      name: boolean;
      guardian: boolean;
      auth: boolean;
      attested: boolean;
    },
  ): void {
    if (
      (dto.recipientName != null && !allowed.name) ||
      (dto.guardianId != null && !allowed.guardian) ||
      (dto.authorizationDocumentId != null && !allowed.auth) ||
      (dto.authorizationAttested != null && !allowed.attested)
    ) {
      throw new BadRequestException(
        'Hay datos del destinatario que no corresponden a este tipo de entrega.',
      );
    }
  }
}
