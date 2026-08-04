import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { RecordConsentDto } from './dto/record-consent.dto';
import { ConsentPurpose } from '@prisma/client';
import { toJsonSnapshot } from '../../common/utils/json-clone.util';

function normalizeRut(rut: string): string {
  return rut.replace(/\./g, '').trim().toUpperCase();
}

function isDate(val: unknown): val is Date {
  return val !== null && val !== undefined && Object.prototype.toString.call(val) === '[object Date]';
}

type ConsentStatusMap = Record<ConsentPurpose, boolean>;

function emptyConsentStatus(): ConsentStatusMap {
  return { TREATMENT: false, TELEMEDICINE: false };
}

@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async create(dto: CreatePatientDto, therapistId: string) {
    const rut = normalizeRut(dto.rut);

    const existing = await this.prisma.patient.findUnique({
      where: { rut },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Ya existe un paciente con ese RUT');
    }

    const patient = await this.prisma.patient.create({
      data: {
        ...dto,
        rut,
        birthDate: new Date(dto.birthDate),
        therapistId,
      },
    });
    this.logger.log(
      `Paciente creado: id=${patient.id} therapistId=${therapistId}`,
    );
    return patient;
  }

  // T6.1 (issue #27): estado vigente de consentimiento por finalidad para un
  // lote de pacientes en una sola consulta (evita N+1 al listar). Toma la
  // última fila (por recordedAt) por (patientId, purpose) vía DISTINCT ON;
  // Prisma requiere que los campos de `distinct` encabecen el `orderBy` para
  // que el resultado sea determinístico.
  async getConsentStatusMap(
    patientIds: string[],
  ): Promise<Map<string, ConsentStatusMap>> {
    const map = new Map<string, ConsentStatusMap>();
    if (patientIds.length === 0) return map;

    const latestEvents = await this.prisma.patientConsent.findMany({
      where: { patientId: { in: patientIds } },
      distinct: ['patientId', 'purpose'],
      orderBy: [
        { patientId: 'asc' },
        { purpose: 'asc' },
        { recordedAt: 'desc' },
      ],
    });

    for (const id of patientIds) map.set(id, emptyConsentStatus());
    for (const event of latestEvents) {
      const status = map.get(event.patientId) ?? emptyConsentStatus();
      status[event.purpose] = event.action === 'GRANT';
      map.set(event.patientId, status);
    }
    return map;
  }

  // Sin page/pageSize devuelve la lista completa (retrocompatible); con
  // ambos, pagina con take/skip (issue #48).
  async findAll(userId: string, pagination?: { page?: number; pageSize?: number }) {
    const where = { therapistId: userId, deletedAt: null };
    const { page, pageSize } = pagination ?? {};
    const isPaginated = !!page && !!pageSize;

    const [patients, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...(isPaginated ? { take: pageSize, skip: (page - 1) * pageSize } : {}),
      }),
      isPaginated ? this.prisma.patient.count({ where }) : Promise.resolve(undefined),
    ]);

    const consentMap = await this.getConsentStatusMap(patients.map((p) => p.id));
    const data = patients.map((p) => ({
      ...p,
      consents: consentMap.get(p.id) ?? emptyConsentStatus(),
    }));

    return isPaginated ? { data, total, page, pageSize } : data;
  }

  // Guard de autorización liviano: solo confirma que `id` existe y pertenece
  // a `userId`, sin traer consultas/documentos/consentimientos. Para usarlo
  // en los módulos (consultations, documents, reports) que solo necesitan
  // validar acceso, no el detalle completo del paciente -- antes todos
  // pagaban el costo de `findOne` (joins + query de consentimientos) solo
  // para un chequeo de ownership.
  async assertAccess(id: string, userId: string): Promise<{ id: string; rut: string }> {
    const patient = await this.prisma.patient.findFirst({
      where: { id, therapistId: userId, deletedAt: null },
      select: { id: true, rut: true },
    });
    // NotFoundException uniforme tanto si el paciente no existe como si
    // pertenece a otro profesional: no distinguir evita filtrar (vía 403 vs
    // 404) que un id ajeno corresponde a un paciente real.
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    return patient;
  }

  async findOne(id: string, userId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id, therapistId: userId, deletedAt: null },
      include: {
        therapist: { select: { id: true, name: true } },
        // Solo la versión vigente de cada consulta (T2.3: corregir crea una
        // fila nueva en vez de sobrescribir, así que hay que excluir las
        // versiones ya superadas para no listar la misma consulta dos veces)
        consultations: {
          where: { correctedBy: null, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
        documents: true,
      },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    const consents = (await this.getConsentStatusMap([id])).get(id) ?? emptyConsentStatus();
    return { ...patient, consents };
  }

  async update(id: string, dto: UpdatePatientDto, userId: string) {
    const current = await this.findOne(id, userId);

    const { reason, ...fields } = dto;

    // Calcular diff: solo campos que realmente cambian
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
      const incoming = fields[key];
      if (incoming === undefined) continue;

      const currentVal = (current as Record<string, unknown>)[key];

      const incomingStr = isDate(incoming)
        ? incoming.toISOString()
        : String(incoming);
      const currentStr = isDate(currentVal)
        ? currentVal.toISOString()
        : currentVal !== null && currentVal !== undefined
          ? String(currentVal)
          : null;

      if (incomingStr !== currentStr) {
        diff[key] = { from: currentVal, to: incoming };
      }
    }

    // Sin cambios reales → no tocar la DB
    if (Object.keys(diff).length === 0) {
      return current;
    }

    // Snapshot sin relaciones ni campos computados (consents es agregado en
    // findOne desde el ledger PatientConsent, no una columna real de Patient)
    const { therapist, consultations, documents, consents, ...snapshot } = current as any;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.patientHistory.create({
        data: {
          patientId: id,
          changedById: userId,
          reason,
          snapshot: toJsonSnapshot(snapshot),
          diff: toJsonSnapshot(diff),
        },
      });

      return tx.patient.update({
        where: { id },
        data: {
          ...fields,
          ...(fields.rut && { rut: normalizeRut(fields.rut) }),
          ...(fields.birthDate && { birthDate: new Date(fields.birthDate) }),
        },
      });
    });
    this.logger.log(
      `Paciente actualizado: id=${id} userId=${userId} campos=${Object.keys(diff).join(',')}`,
    );
    return updated;
  }

  async softDelete(id: string, userId: string) {
    await this.assertAccess(id, userId);
    const deleted = await this.prisma.patient.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.logger.log(
      `Paciente eliminado (soft delete): id=${id} userId=${userId}`,
    );
    return deleted;
  }

  async getHistory(id: string, userId: string) {
    await this.assertAccess(id, userId);

    return this.prisma.patientHistory.findMany({
      where: { patientId: id },
      include: {
        changedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { changedAt: 'desc' },
    });
  }

  // T6.1 (issue #27): registra un evento de otorgamiento/revocación para una
  // finalidad puntual.
  async recordConsent(id: string, dto: RecordConsentDto, userId: string) {
    await this.assertAccess(id, userId);

    return this.prisma.patientConsent.create({
      data: {
        patientId: id,
        purpose: dto.purpose,
        action: dto.action,
        recordedById: userId,
        evidence: dto.evidence,
      },
    });
  }

  async getConsentLedger(id: string, userId: string) {
    await this.assertAccess(id, userId);

    return this.prisma.patientConsent.findMany({
      where: { patientId: id },
      include: {
        recordedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async getCurrentConsentStatus(id: string, userId: string): Promise<ConsentStatusMap> {
    await this.assertAccess(id, userId);
    return (await this.getConsentStatusMap([id])).get(id) ?? emptyConsentStatus();
  }
}
