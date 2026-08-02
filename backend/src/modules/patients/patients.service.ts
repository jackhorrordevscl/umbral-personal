import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { RecordConsentDto } from './dto/record-consent.dto';
import { ConsentPurpose } from '@prisma/client';

function normalizeRut(rut: string): string {
  return rut.replace(/\./g, '').trim().toUpperCase();
}

function isDate(val: unknown): val is Date {
  return val !== null && val !== undefined && Object.prototype.toString.call(val) === '[object Date]';
}

type ConsentStatusMap = Record<ConsentPurpose, boolean>;

function emptyConsentStatus(): ConsentStatusMap {
  return { TREATMENT: false, TELEMEDICINE: false, HEALTH_NETWORK: false };
}

@Injectable()
export class PatientsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  // T6.4 (issue #51): ADMIN no tiene acceso a datos clínicos bajo ningún
  // escenario -- ni siquiera pudiendo crear un paciente y quedar como su
  // therapistId, que de todos modos no podría ver después (findOne lo
  // bloquea de forma incondicional, sin importar ownership). Se corta acá
  // en vez de dejar que cree registros huérfanos que nadie puede gestionar.
  async create(dto: CreatePatientDto, therapistId: string, userRole: string) {
    if (userRole === 'ADMIN') {
      throw new ForbiddenException('El rol ADMIN no tiene acceso a fichas clínicas');
    }
    return this.prisma.patient.create({
      data: {
        ...dto,
        rut: normalizeRut(dto.rut),
        birthDate: new Date(dto.birthDate),
        therapistId,
      },
    });
  }

  // T6.1 (issue #27): estado vigente de consentimiento por finalidad para un
  // lote de pacientes en una sola consulta (evita N+1 al listar). Toma la
  // última fila (por recordedAt) por (patientId, purpose) vía DISTINCT ON;
  // Prisma requiere que los campos de `distinct` encabecen el `orderBy` para
  // que el resultado sea determinístico.
  private async getConsentStatusMap(
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

  // T6.4 (issue #51): ADMIN es un rol operativo/técnico sin base clínica
  // para ver datos de pacientes -- perdió el acceso irrestricto que tenía
  // antes junto con DIRECTOR/SUPERVISOR. SUPERVISOR (ex-DIRECTOR) conserva
  // visión ampliada, pero ahora condicionada al consentimiento HEALTH_NETWORK
  // del paciente (ver findOne) salvo que sea además el terapeuta tratante.
  async findAll(userId: string, userRole: string) {
    if (userRole === 'ADMIN') {
      throw new ForbiddenException('El rol ADMIN no tiene acceso a fichas clínicas');
    }

    let patients;
    if (userRole === 'SUPERVISOR') {
      patients = await this.prisma.patient.findMany({
        where: { deletedAt: null },
        include: { therapist: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      patients = await this.prisma.patient.findMany({
        where: { therapistId: userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    }

    const consentMap = await this.getConsentStatusMap(patients.map((p) => p.id));

    // COORDINATOR/THERAPIST ya vienen filtrados a los propios por el query
    // de arriba (isOwner siempre true para ellos acá), así que este filtro
    // solo tiene efecto real sobre SUPERVISOR.
    const visible = patients.filter((p) => {
      if (p.therapistId === userId) return true;
      const consents = consentMap.get(p.id) ?? emptyConsentStatus();
      return userRole === 'SUPERVISOR' && consents.HEALTH_NETWORK;
    });

    return visible.map((p) => ({
      ...p,
      consents: consentMap.get(p.id) ?? emptyConsentStatus(),
    }));
  }

  // Fetch compartido por findOne y accessOverride (T6.5, #52): misma forma
  // de datos (paciente + consultas vigentes + documentos + consentimientos),
  // sin decidir todavía si el llamante tiene permiso -- eso es
  // responsabilidad de cada método, que aplica su propia regla de acceso.
  private async fetchPatientWithConsents(id: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id, deletedAt: null },
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
    return { patient, consents };
  }

  async findOne(id: string, userId: string, userRole: string) {
    const { patient, consents } = await this.fetchPatientWithConsents(id);

    if (userRole === 'ADMIN') {
      throw new ForbiddenException('El rol ADMIN no tiene acceso a fichas clínicas');
    }

    const isOwner = patient.therapistId === userId;

    // La relación de tratamiento directa (isOwner) siempre da acceso, sin
    // importar el consentimiento de Red de Salud -- ese consentimiento
    // regula compartir la ficha con terceros FUERA de esa relación (Ley
    // 21.719), no la relación en sí, que se sostiene por otra base legal
    // (Ley 20.584).
    if (!isOwner) {
      if (userRole === 'COORDINATOR') {
        throw new ForbiddenException(
          'Como Coordinador solo puedes ver la ficha clínica de tus propios pacientes',
        );
      }
      if (userRole !== 'SUPERVISOR') {
        throw new ForbiddenException('Acceso denegado a este paciente');
      }
    }

    // T6.4 (issue #51): SUPERVISOR sin relación de tratamiento directa queda
    // sujeto al consentimiento HEALTH_NETWORK -- antes veía cualquier ficha
    // sin restricción, igual que ADMIN. accessOverride (T6.5, #52) es la
    // única vía para sortear este bloqueo, y deja motivo auditado -- esta
    // ruta nunca lo hace de forma implícita.
    if (!isOwner && userRole === 'SUPERVISOR' && !consents.HEALTH_NETWORK) {
      throw new ForbiddenException(
        'Acceso denegado: el paciente no ha otorgado consentimiento de Red de Salud',
      );
    }

    return { ...patient, consents };
  }

  // T6.5 (issue #52): única vía para que SUPERVISOR acceda a una ficha sin
  // relación de tratamiento directa y sin consentimiento HEALTH_NETWORK
  // vigente -- pensada para supervisión clínica legítima (incidentes,
  // auditorías internas, denuncias) que findOne bloquearía de otro modo.
  //
  // No repite el chequeo de ADMIN/COORDINATOR/THERAPIST de findOne a
  // propósito: el guard del controller (@Roles('SUPERVISOR')) ya garantiza
  // que solo SUPERVISOR llega acá. Si algún otro rol necesitara esta vía en
  // el futuro, el chequeo de rol tendría que agregarse acá también, no solo
  // en el guard.
  async accessOverride(
    id: string,
    userId: string,
    userRole: string,
    overrideReason: string,
  ) {
    // Verifica que el override realmente correspondía: si findOne ya le
    // daría acceso normal a este userId (dueño, o SUPERVISOR con
    // consentimiento ya otorgado), no se otorga por esta vía -- una fila de
    // auditoría con motivo en una ficha a la que igual se accedía sin
    // excepción le resta valor probatorio al trail entero ante una revisión
    // real. NotFoundException se deja propagar tal cual (404, no 403): el
    // problema ahí no es el gate de consentimiento.
    let alreadyAccessible = true;
    try {
      await this.findOne(id, userId, userRole);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      alreadyAccessible = false;
    }
    if (alreadyAccessible) {
      throw new ForbiddenException(
        'Ya tenés acceso normal a esta ficha; el acceso excepcional no corresponde acá',
      );
    }

    const { patient, consents } = await this.fetchPatientWithConsents(id);

    // Escritura de auditoría SÍNCRONA y bloqueante, a diferencia del log
    // automático de AuditInterceptor (fail-open por diseño: la atención al
    // paciente no depende de la disponibilidad del log, ver
    // audit.interceptor.ts). Acá el cálculo es al revés -- esta acción ES
    // saltarse un gate de consentimiento, así que sin trail persistido no
    // hay excepción auditada, solo un bypass silencioso. Si falla, se corta
    // el acceso en vez de entregarlo igual.
    await this.auditService.log({
      userId,
      action: 'VIEW',
      resource: 'patient',
      resourceId: id,
      detail:
        'Acceso excepcional de SUPERVISOR sin consentimiento HEALTH_NETWORK (T6.5, issue #52)',
      overrideReason,
    });

    return { ...patient, consents };
  }

  // T6.5 (issue #52): única vía para que SUPERVISOR ubique una ficha que no
  // aparece en su findAll (excluida por falta de consentimiento
  // HEALTH_NETWORK) y así pueda disparar accessOverride sobre su id. Resuelve
  // el RUT a un id y delega el resto por completo en findOne -- misma regla
  // de acceso, ningún atajo nuevo. Restringido a SUPERVISOR (guard del
  // controller) a propósito: THERAPIST/COORDINATOR ya tienen su búsqueda
  // funcionando sobre la lista que su propio findAll les devuelve, y
  // exponerles esta ruta agregaría una forma de confirmar si un RUT
  // cualquiera pertenece a algún paciente de la clínica, sin necesitarlo.
  async findByRut(rut: string, userId: string, userRole: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { rut: normalizeRut(rut), deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    try {
      return await this.findOne(patient.id, userId, userRole);
    } catch (err) {
      // Esta ruta es SUPERVISOR-only (guard del controller): a diferencia
      // de findOne llamado desde cualquier otro lado, acá el único motivo
      // posible de un 403 es el gate de consentimiento HEALTH_NETWORK (un
      // SUPERVISOR nunca cae en las ramas de COORDINATOR/THERAPIST/ADMIN de
      // findOne). Se re-lanza con el id incluido para que el frontend pueda
      // ofrecer el acceso excepcional (accessOverride, T6.5/#52) sin tener
      // que adivinar el id -- el RUT que el usuario tipeó no alcanza por sí
      // solo para eso.
      if (err instanceof ForbiddenException) {
        throw new ForbiddenException({
          message:
            'Acceso denegado: el paciente no ha otorgado consentimiento de Red de Salud',
          patientId: patient.id,
        });
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdatePatientDto, userId: string, userRole?: string) {
    const current = await this.findOne(id, userId, userRole ?? 'THERAPIST');

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

   return this.prisma.$transaction(async (tx) => {
  await tx.patientHistory.create({
    data: {
      patientId: id,
      changedById: userId,
      reason,
      snapshot: JSON.parse(JSON.stringify(snapshot)),
      diff: JSON.parse(JSON.stringify(diff)),
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
  }

  async softDelete(id: string, userId: string, userRole?: string) {
    await this.findOne(id, userId, userRole ?? 'THERAPIST');
    return this.prisma.patient.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getHistory(id: string, userId: string, userRole: string) {
    await this.findOne(id, userId, userRole);

    return this.prisma.patientHistory.findMany({
      where: { patientId: id },
      include: {
        changedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { changedAt: 'desc' },
    });
  }

  // T6.1 (issue #27): registra un evento de otorgamiento/revocación para una
  // finalidad puntual. findOne aplica el mismo control de acceso que el
  // resto de las mutaciones del módulo (dueño, o SUPERVISOR si el
  // consentimiento HEALTH_NETWORK ya está otorgado -- T6.4, issue #51).
  //
  // Caso borde conocido, sin resolver acá: un SUPERVISOR sin relación
  // directa no puede usar esta ruta para otorgar el primer HEALTH_NETWORK de
  // un paciente que todavía no lo tiene, porque findOne lo bloquea antes de
  // llegar a este método. En la práctica quien registra consentimiento casi
  // siempre es el terapeuta tratante (isOwner=true, sin este problema); el
  // acceso excepcional de T6.5 (#52) es la vía prevista para el caso
  // contrario.
  async recordConsent(
    id: string,
    dto: RecordConsentDto,
    userId: string,
    userRole: string,
  ) {
    await this.findOne(id, userId, userRole);

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

  async getConsentLedger(id: string, userId: string, userRole: string) {
    await this.findOne(id, userId, userRole);

    return this.prisma.patientConsent.findMany({
      where: { patientId: id },
      include: {
        recordedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async getCurrentConsentStatus(
    id: string,
    userId: string,
    userRole: string,
  ): Promise<ConsentStatusMap> {
    await this.findOne(id, userId, userRole);

    const status = emptyConsentStatus();
    const latestEvents = await this.prisma.patientConsent.findMany({
      where: { patientId: id },
      distinct: ['purpose'],
      orderBy: { recordedAt: 'desc' },
    });
    for (const event of latestEvents) {
      status[event.purpose] = event.action === 'GRANT';
    }
    return status;
  }

}