import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeRut } from '../../common/utils/rut.util';
import { PatientsService } from './patients.service';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';
import { MAX_GUARDIANS_PER_PATIENT } from './patients.constants';

const GUARDIAN_NOT_FOUND = 'Representante no encontrado';

// Normalizes what the DTO lets through: canonical RUT, and blank email/phone
// stored as null (the form sends "" for an empty field).
function toGuardianData(
  dto: CreateGuardianDto | UpdateGuardianDto,
): Prisma.LegalGuardianUncheckedUpdateInput {
  const { rut, email, phone, ...rest } = dto;
  return {
    ...rest,
    ...(rut !== undefined && { rut: normalizeRut(rut) }),
    ...(email !== undefined && { email: email || null }),
    ...(phone !== undefined && { phone: phone || null }),
  };
}

@Injectable()
export class GuardiansService {
  private readonly logger = new Logger(GuardiansService.name);

  constructor(
    private prisma: PrismaService,
    private patientsService: PatientsService,
  ) {}

  async list(patientId: string, therapistId: string) {
    await this.patientsService.assertAccess(patientId, therapistId);
    return this.prisma.legalGuardian.findMany({
      where: { patientId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(patientId: string, dto: CreateGuardianDto, therapistId: string) {
    const patient = await this.patientsService.assertAccess(
      patientId,
      therapistId,
    );

    return this.prisma.$transaction(async (tx) => {
      await this.lockPatient(tx, patientId);

      const count = await tx.legalGuardian.count({ where: { patientId } });
      if (count >= MAX_GUARDIANS_PER_PATIENT) {
        throw new ConflictException(
          `Un paciente puede tener como máximo ${MAX_GUARDIANS_PER_PATIENT} representantes`,
        );
      }

      await this.assertGuardianRutIsFree(tx, patient.rut, patientId, dto.rut);

      // Only one guardian per patient can be the payer: marking a new one
      // clears the flag on the others instead of rejecting the request, so
      // changing payer is a single call.
      if (dto.isPayer) {
        await tx.legalGuardian.updateMany({
          where: { patientId, isPayer: true },
          data: { isPayer: false },
        });
      }

      const guardian = await tx.legalGuardian.create({
        data: {
          ...(toGuardianData(dto) as Prisma.LegalGuardianUncheckedCreateInput),
          patientId,
        },
      });
      this.logger.log(
        `Representante creado: id=${guardian.id} patientId=${patientId} therapistId=${therapistId}`,
      );
      return guardian;
    });
  }

  async update(
    patientId: string,
    guardianId: string,
    dto: UpdateGuardianDto,
    therapistId: string,
  ) {
    const patient = await this.patientsService.assertAccess(
      patientId,
      therapistId,
    );

    return this.prisma.$transaction(async (tx) => {
      await this.lockPatient(tx, patientId);
      const current = await this.findGuardianOrFail(tx, patientId, guardianId);

      // Only when the RUT actually changes: a guardian saved before this rule
      // can still be edited without being blocked (same as the patient RUT,
      // issue #289).
      if (dto.rut !== undefined && normalizeRut(dto.rut) !== current.rut) {
        await this.assertGuardianRutIsFree(
          tx,
          patient.rut,
          patientId,
          dto.rut,
          guardianId,
        );
      }

      // Same single-payer rule as create(): the other guardians lose the flag.
      if (dto.isPayer) {
        await tx.legalGuardian.updateMany({
          where: { patientId, isPayer: true, id: { not: guardianId } },
          data: { isPayer: false },
        });
      }

      return tx.legalGuardian.update({
        where: { id: guardianId },
        data: toGuardianData(dto),
      });
    });
  }

  // PatientConsent.guardianId is ON DELETE RESTRICT: a guardian who signed a
  // consent cannot be removed (the ledger is append-only). The count gives a
  // clear 409; a P2003 from a consent recorded concurrently maps to the same.
  async remove(patientId: string, guardianId: string, therapistId: string) {
    await this.patientsService.assertAccess(patientId, therapistId);

    const message =
      'No se puede eliminar al representante porque tiene consentimientos registrados a su nombre';
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockPatient(tx, patientId);
        await this.findGuardianOrFail(tx, patientId, guardianId);

        const referenced = await tx.patientConsent.count({
          where: { guardianId },
        });
        if (referenced > 0) throw new ConflictException(message);

        // T4: DischargeDelivery.guardianId también es ON DELETE RESTRICT (la
        // entrega de un informe de alta es un hecho que debe quedar registrado).
        const deliveries = await tx.dischargeDelivery.count({
          where: { guardianId },
        });
        if (deliveries > 0) {
          throw new ConflictException(
            'No se puede eliminar al representante porque recibió la entrega de un informe de alta',
          );
        }

        const deleted = await tx.legalGuardian.delete({
          where: { id: guardianId },
        });
        this.logger.log(
          `Representante eliminado: id=${guardianId} patientId=${patientId} therapistId=${therapistId}`,
        );
        return deleted;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException(message);
      }
      throw err;
    }
  }

  // FOR UPDATE on the Patient row serializes concurrent guardian writes for the
  // same patient (cap of two, single payer) and against softDelete(), which
  // takes the same lock. A patient deleted since assertAccess() yields 404.
  private async lockPatient(
    tx: Prisma.TransactionClient,
    patientId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Patient"
      WHERE id = ${patientId} AND "deletedAt" IS NULL
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException('Paciente no encontrado');
    }
  }

  // issue #488: a guardian cannot share the patient's RUT (the public booking
  // already rejects it) nor repeat the RUT of another guardian of the same
  // patient. Runs under lockPatient(), so two concurrent writes cannot both
  // pass. `exceptGuardianId` keeps an edited guardian from colliding with itself.
  private async assertGuardianRutIsFree(
    tx: Prisma.TransactionClient,
    patientRut: string,
    patientId: string,
    rawRut: string,
    exceptGuardianId?: string,
  ): Promise<void> {
    const rut = normalizeRut(rawRut);
    if (rut === patientRut) {
      throw new ConflictException(
        'El RUT del representante debe ser distinto al del paciente.',
      );
    }
    const others = await tx.legalGuardian.findMany({
      where: {
        patientId,
        ...(exceptGuardianId && { id: { not: exceptGuardianId } }),
      },
      select: { rut: true },
    });
    if (others.some((other) => other.rut === rut)) {
      throw new ConflictException(
        'Ya existe un representante con ese RUT para este paciente.',
      );
    }
  }

  private async findGuardianOrFail(
    tx: Prisma.TransactionClient,
    patientId: string,
    guardianId: string,
  ) {
    const guardian = await tx.legalGuardian.findFirst({
      where: { id: guardianId, patientId },
    });
    if (!guardian) throw new NotFoundException(GUARDIAN_NOT_FOUND);
    return guardian;
  }
}
