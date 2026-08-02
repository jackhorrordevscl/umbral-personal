import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as fs from 'fs';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SEED_ADMIN_EMAIL_DEFAULT,
  SEED_ADMIN_PASSWORD_DEFAULT,
} from '../prisma/seed-admin.defaults';

/**
 * T1.5 (issue #10): verifica que los endpoints sensibles (consultas, reportes,
 * documentos, pacientes) respeten la relación terapeuta-paciente aplicada por
 * PatientsService.findOne(patientId, userId, userRole):
 *   - el dueño (THERAPIST con patient.therapistId === userId) accede (2xx)
 *   - un THERAPIST sin relación con el paciente recibe 403
 *
 * T6.4 (issue #51) cambió el modelo de acceso elevado:
 *   - ADMIN ya NO tiene acceso a datos clínicos de pacientes, bajo ningún
 *     escenario -- rol operativo/técnico, sin base clínica.
 *   - DIRECTOR se renombró a SUPERVISOR, y su acceso sin relación de
 *     tratamiento directa ahora depende del consentimiento HEALTH_NETWORK
 *     vigente del paciente (antes veía todo sin restricción, igual que
 *     ADMIN). Ver describe('SUPERVISOR y consentimiento Red de Salud').
 *
 * Los fixtures (usuarios, paciente, consulta, documentos) se crean en
 * beforeAll con emails únicos por corrida (sufijo Date.now()) para que la
 * suite sea repetible sobre la misma base sin colisionar con datos de
 * pruebas manuales previas, y se eliminan en afterAll.
 */
describe('RBAC ownership guard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  // ADMIN_EMAIL/ADMIN_PASSWORD: mismo default compartido con seed.ts y las
  // demás suites de auth (ver prisma/seed-admin.defaults.ts) — evita un
  // literal hardcodeado acá, que dispararía falsos positivos de secret
  // scanning (GitGuardian) en cada PR que toque este spec.
  const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? SEED_ADMIN_EMAIL_DEFAULT;
  const ADMIN_PASSWORD =
    process.env.SEED_ADMIN_PASSWORD ?? SEED_ADMIN_PASSWORD_DEFAULT;
  const TEST_PASSWORD = 'TestPass123!';

  let adminToken: string;
  let supervisorToken: string;
  let therapistAToken: string;
  let therapistBToken: string;
  let therapistAId: string;
  let therapistBId: string;
  let supervisorId: string;

  let patientId: string;
  let consultationId: string;
  let ownerDocumentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);

    // T4.1 (issue #19): ADMIN/DIRECTOR quedan forzados a enrolar MFA en su
    // primer login sin MFA. Se resetea el estado MFA del ADMIN seedeado
    // antes de loguear para que esta suite sea determinística sin importar
    // si una corrida previa ya completó el enrolamiento forzado (la
    // cobertura completa de ese flujo vive en
    // auth-mfa-enforcement.e2e-spec.ts).
    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { mfaEnabled: false, mfaSecret: null, mustChangePassword: false },
    });

    // 1. Login como ADMIN seedeado: al ser ADMIN sin MFA, el backend
    // entrega un setupToken de enrolamiento forzado en vez de accessToken.
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);
    expect(adminLogin.body.requiresMfaSetup).toBe(true);

    const beginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken: adminLogin.body.setupToken })
      .expect(201);

    const adminTotp = speakeasy.totp({
      secret: beginSetup.body.secret,
      encoding: 'base32',
    });

    const confirmSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({ setupToken: adminLogin.body.setupToken, token: adminTotp })
      .expect(201);
    adminToken = confirmSetup.body.accessToken;

    // 2. Crear dos usuarios THERAPIST de prueba con emails únicos
    const therapistAEmail = `rbac.therapist.a.${runId}@umbral.cl`;
    const therapistBEmail = `rbac.therapist.b.${runId}@umbral.cl`;

    const therapistACreate = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: therapistAEmail,
        password: TEST_PASSWORD,
        name: 'RBAC Therapist A',
        role: 'THERAPIST',
      })
      .expect(201);
    therapistAId = therapistACreate.body.id;

    const therapistBCreate = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: therapistBEmail,
        password: TEST_PASSWORD,
        name: 'RBAC Therapist B',
        role: 'THERAPIST',
      })
      .expect(201);
    therapistBId = therapistBCreate.body.id;

    // 2b. Crear un usuario SUPERVISOR de prueba (T6.4, issue #51): su acceso
    // a pacientes sin relación de tratamiento directa depende del
    // consentimiento HEALTH_NETWORK, a diferencia de ADMIN (sin acceso) y
    // del propio SUPERVISOR cuando sí es el terapeuta tratante.
    const supervisorEmail = `rbac.supervisor.${runId}@umbral.cl`;
    const supervisorCreate = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: supervisorEmail,
        password: TEST_PASSWORD,
        name: 'RBAC Supervisor',
        role: 'SUPERVISOR',
      })
      .expect(201);
    supervisorId = supervisorCreate.body.id;

    // SUPERVISOR también requiere enrolamiento MFA forzado (T4.1), igual que
    // ADMIN -- mismo flujo login -> setup/begin -> setup/confirm.
    const supervisorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: supervisorEmail, password: TEST_PASSWORD })
      .expect(201);
    expect(supervisorLogin.body.requiresMfaSetup).toBe(true);

    const supervisorBeginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken: supervisorLogin.body.setupToken })
      .expect(201);

    const supervisorTotp = speakeasy.totp({
      secret: supervisorBeginSetup.body.secret,
      encoding: 'base32',
    });

    const supervisorConfirmSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({
        setupToken: supervisorLogin.body.setupToken,
        token: supervisorTotp,
      })
      .expect(201);
    supervisorToken = supervisorConfirmSetup.body.accessToken;

    // 3. Login como cada terapeuta
    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: therapistAEmail, password: TEST_PASSWORD })
      .expect(201);
    therapistAToken = loginA.body.accessToken;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: therapistBEmail, password: TEST_PASSWORD })
      .expect(201);
    therapistBToken = loginB.body.accessToken;

    // 4. Con el token de A: crear un paciente y una consulta para ese paciente
    const patientCreate = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .send({
        fullName: 'RBAC Test Patient',
        rut: `RBAC${runId}`,
        birthDate: '1990-01-01',
      })
      .expect(201);
    patientId = patientCreate.body.id;

    const consultationCreate = await request(app.getHttpServer())
      .post('/api/v1/consultations')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .send({
        patientId,
        sessionDate: '2026-01-01',
        consultReason: 'Motivo de prueba RBAC',
        intervention: 'Intervención de prueba RBAC',
      })
      .expect(201);
    consultationId = consultationCreate.body.id;
  });

  afterAll(async () => {
    try {
      // Guard explícito: si beforeAll falló antes de crear el paciente
      // fixture, patientId queda undefined. `where: { patientId: undefined }`
      // / `where: { id: undefined }` en Prisma NO filtra por "ningún match":
      // significa "sin filtro en ese campo", así que deleteMany() borraría
      // TODOS los pacientes/documentos/consultas de la base. El flujo de
      // login del ADMIN seedeado ahora hace varias llamadas HTTP más (T4.1,
      // issue #19: enrolamiento MFA forzado), lo que aumenta la superficie
      // para que beforeAll falle a mitad de camino, así que este guard es
      // necesario, no solo defensivo.
      if (patientId) {
        // Limpieza de archivos físicos subidos durante la suite
        const docs = await prisma.patientDocument.findMany({
          where: { patientId },
        });
        for (const doc of docs) {
          try {
            fs.unlinkSync(doc.storagePath);
          } catch {
            // el archivo puede no existir (p.ej. intento no-dueño ya autolimpiado); se ignora
          }
        }

        // Borrado respetando FKs: documentos/consentimientos/historial de
        // consultas -> consultas -> paciente. patientConsent se agrega acá
        // (T6.4, issue #51): el describe de SUPERVISOR otorga HEALTH_NETWORK
        // sobre este paciente, y PatientConsent.patientId es RESTRICT
        // (ledger append-only, T6.1) -- sin este borrado previo, deleteMany
        // del paciente falla con violación de FK.
        await prisma.patientDocument.deleteMany({ where: { patientId } });
        await prisma.patientConsent.deleteMany({ where: { patientId } });
        await prisma.consultationHistory.deleteMany({
          where: { consultation: { patientId } },
        });
        await prisma.consultation.deleteMany({ where: { patientId } });
        await prisma.patient.deleteMany({ where: { id: patientId } });
      }

      // Los usuarios de prueba ya generaron filas en AuditLog durante la
      // suite (cada request autenticado audita). AuditLog.userId ahora usa
      // onDelete: Restrict a propósito (T2.1) para que hard-deletear un
      // usuario con historial de auditoría sea imposible — igual que en
      // producción, donde no existe ningún prisma.user.delete(), solo
      // soft delete. Se limpia acá de la misma forma. `in: []` cuando ambos
      // ids quedan undefined no matchea nada (a diferencia de `id: undefined`
      // suelto), así que este filtro ya era seguro.
      const idsToSoftDelete = [therapistAId, therapistBId, supervisorId].filter(Boolean);
      if (idsToSoftDelete.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: idsToSoftDelete } },
          data: { deletedAt: new Date() },
        });
      }

      // El beforeAll de esta suite enrola MFA en el admin seedeado (línea
      // ~60) y ningún test posterior lo deshace. Sin este reset, el admin
      // queda con mfaEnabled=true y un mfaSecret generado por speakeasy que
      // no sirve fuera del test — inutilizable para cualquiera que loguee
      // después (otra suite, o un dev haciendo login manual) sin ese
      // secreto. Mismo patrón que auth-mfa-enforcement.e2e-spec.ts.
      await prisma.user.updateMany({
        where: { email: ADMIN_EMAIL },
        data: { mfaEnabled: false, mfaSecret: null },
      });
    } finally {
      await app.close();
    }
  });

  describe('Guard sin token', () => {
    it('GET /patients/:id sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}`)
        .expect(401);
    });
  });

  describe('GET /patients/:id', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });

    it('ADMIN recibe 403 (sin acceso a datos clínicos, T6.4)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  describe('POST /documents/upload', () => {
    it('el terapeuta dueño puede subir un documento (2xx)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .field('patientId', patientId)
        .field('type', 'OTHER')
        .attach('file', Buffer.from('contenido de prueba'), 'test-owner.pdf')
        .expect(201);
      ownerDocumentId = res.body.id;
      expect(ownerDocumentId).toBeDefined();
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .field('patientId', patientId)
        .field('type', 'OTHER')
        .attach('file', Buffer.from('contenido de prueba'), 'test-nonowner.pdf')
        .expect(403);
    });

    it('ADMIN recibe 403 al intentar subir un documento (T6.4)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('patientId', patientId)
        .field('type', 'OTHER')
        .attach('file', Buffer.from('contenido de prueba'), 'test-admin.pdf')
        .expect(403);
    });
  });

  describe('GET /documents/patient/:patientId', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });

    it('ADMIN recibe 403 (sin acceso a datos clínicos, T6.4)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/patient/${patientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  describe('GET /documents/:id/download', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/${ownerDocumentId}/download`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/${ownerDocumentId}/download`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });

    it('ADMIN recibe 403 (sin acceso a datos clínicos, T6.4)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/${ownerDocumentId}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  describe('GET /consultations/patient/:patientId', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/consultations/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/consultations/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });

    it('ADMIN recibe 403 (sin acceso a datos clínicos, T6.4)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/consultations/patient/${patientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  describe('GET /consultations/:id', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/consultations/${consultationId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/consultations/${consultationId}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });

    it('ADMIN recibe 403 (sin acceso a datos clínicos, T6.4)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/consultations/${consultationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  describe('PATCH /consultations/:id/correct (versionado inmutable, T2.3)', () => {
    let correctedId: string;

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/consultations/${consultationId}/correct`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .send({ consultReason: 'Intento no autorizado' })
        .expect(403);
    });

    it('el terapeuta dueño puede corregir: crea una versión nueva (2xx)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/consultations/${consultationId}/correct`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({ consultReason: 'Motivo corregido por el dueño' })
        .expect(200);

      correctedId = res.body.id;
      expect(correctedId).toBeDefined();
      expect(correctedId).not.toBe(consultationId);
      expect(res.body.consultReason).toBe('Motivo corregido por el dueño');
      expect(res.body.history.length).toBe(1);
    });

    it('la versión original queda intacta y consultable por su id original', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/consultations/${consultationId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect(res.body.id).toBe(consultationId);
      expect(res.body.consultReason).toBe('Motivo de prueba RBAC');
    });

    it('corregir la versión original ya superada devuelve 409', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/consultations/${consultationId}/correct`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({ consultReason: 'Intento sobre versión vieja' })
        .expect(409);
    });

    it('ADMIN recibe 403 al intentar corregir (T6.4)', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/consultations/${correctedId}/correct`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ consultReason: 'Motivo corregido por ADMIN' })
        .expect(403);
    });
  });

  describe('GET /reports/patient/:patientId', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/reports/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200)
        .expect('Content-Type', 'application/pdf');
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/reports/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });

    it('ADMIN recibe 403 (sin acceso a datos clínicos, T6.4)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/reports/patient/${patientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  describe('SUPERVISOR y consentimiento Red de Salud (T6.4, issue #51)', () => {
    it('sin relación directa y sin consentimiento HEALTH_NETWORK recibe 403 en findOne, y queda excluido de findAll', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(403);

      // findAll (GET /patients, la lista) tiene su propia lógica de filtro
      // en memoria -- no delega en findOne -- así que se prueba por
      // separado: sin consentimiento, el paciente no debe aparecer ahí
      // tampoco, no solo al pedirlo por id.
      const list = await request(app.getHttpServer())
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);
      expect(list.body.map((p: any) => p.id)).not.toContain(patientId);
    });

    it('con HEALTH_NETWORK otorgado (por el terapeuta dueño) accede vía findOne y aparece en findAll', async () => {
      // Solo el dueño puede otorgar consentimiento acá: un SUPERVISOR sin
      // acceso previo tampoco podría llamar a esta ruta (caso borde
      // documentado en patients.service.ts, resuelto por T6.5/#52).
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          purpose: 'HEALTH_NETWORK',
          action: 'GRANT',
          evidence: 'Paciente autoriza compartir con la red de salud',
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);

      const list = await request(app.getHttpServer())
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);
      expect(list.body.map((p: any) => p.id)).toContain(patientId);
    });
  });

  describe('POST /patients y POST /consultations bloqueados para ADMIN (T6.4, issue #51)', () => {
    it('POST /patients con ADMIN recibe 403', () => {
      return request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: 'Paciente Creado Por Admin',
          rut: `ADMINCREATE${runId}`,
          birthDate: '1990-01-01',
        })
        .expect(403);
    });

    it('POST /consultations con ADMIN recibe 403', () => {
      return request(app.getHttpServer())
        .post('/api/v1/consultations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          sessionDate: '2026-01-01',
          consultReason: 'Intento de ADMIN',
          intervention: 'Intento de ADMIN',
        })
        .expect(403);
    });
  });

  describe('Acceso excepcional de SUPERVISOR (T6.5, issue #52)', () => {
    // Paciente propio, sin consentimientos -- separado del `patientId`
    // compartido de arriba, que ya quedó con HEALTH_NETWORK otorgado por el
    // describe de T6.4.
    let overridePatientId: string;
    const overrideRut = `T65${runId}`;

    beforeAll(async () => {
      const create = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          fullName: 'Paciente Sin Consentimiento Red De Salud',
          rut: overrideRut,
          birthDate: '1990-01-01',
        })
        .expect(201);
      overridePatientId = create.body.id;
    });

    afterAll(async () => {
      await prisma.patientConsent.deleteMany({
        where: { patientId: overridePatientId },
      });
      await prisma.patient.deleteMany({ where: { id: overridePatientId } });
    });

    describe('GET /patients/by-rut/:rut', () => {
      it('THERAPIST recibe 403 (ruta restringida a SUPERVISOR)', () => {
        return request(app.getHttpServer())
          .get(`/api/v1/patients/by-rut/${overrideRut}`)
          .set('Authorization', `Bearer ${therapistAToken}`)
          .expect(403);
      });

      it('RUT inexistente devuelve 404', () => {
        return request(app.getHttpServer())
          .get(`/api/v1/patients/by-rut/NOEXISTE${runId}`)
          .set('Authorization', `Bearer ${supervisorToken}`)
          .expect(404);
      });

      it('SUPERVISOR sin consentimiento recibe 403 con el id del paciente en el body', async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/patients/by-rut/${overrideRut}`)
          .set('Authorization', `Bearer ${supervisorToken}`)
          .expect(403);
        // Sin este id, el frontend no tiene forma de llamar a
        // access-override -- el RUT tipeado por el usuario no alcanza.
        expect(res.body.patientId).toBe(overridePatientId);
      });
    });

    describe('POST /patients/:id/access-override', () => {
      it('THERAPIST recibe 403 (ruta restringida a SUPERVISOR)', () => {
        return request(app.getHttpServer())
          .post(`/api/v1/patients/${overridePatientId}/access-override`)
          .set('Authorization', `Bearer ${therapistAToken}`)
          .send({ overrideReason: 'Intento no autorizado de override' })
          .expect(403);
      });

      it('rechaza motivo menor a 10 caracteres (400)', () => {
        return request(app.getHttpServer())
          .post(`/api/v1/patients/${overridePatientId}/access-override`)
          .set('Authorization', `Bearer ${supervisorToken}`)
          .send({ overrideReason: 'corto' })
          .expect(400);
      });

      it('rechaza sin motivo (400)', () => {
        return request(app.getHttpServer())
          .post(`/api/v1/patients/${overridePatientId}/access-override`)
          .set('Authorization', `Bearer ${supervisorToken}`)
          .send({})
          .expect(400);
      });

      it('rechaza un motivo de solo espacios (400) -- el DTO trimea antes de validar', () => {
        return request(app.getHttpServer())
          .post(`/api/v1/patients/${overridePatientId}/access-override`)
          .set('Authorization', `Bearer ${supervisorToken}`)
          .send({ overrideReason: '              ' })
          .expect(400);
      });

      it('sobre una ficha a la que SUPERVISOR ya tiene acceso normal recibe 403, no la otorga igual', () => {
        // Reutiliza el `patientId` compartido del describe de T6.4: a esta
        // altura del archivo ya tiene HEALTH_NETWORK otorgado (ver arriba),
        // así que SUPERVISOR accede normal ahí -- el acceso excepcional no
        // corresponde y no debería quedar registrado como si lo fuera.
        return request(app.getHttpServer())
          .post(`/api/v1/patients/${patientId}/access-override`)
          .set('Authorization', `Bearer ${supervisorToken}`)
          .send({
            overrideReason: 'Intento de override sobre ficha ya accesible',
          })
          .expect(403);
      });

      it('con motivo válido accede (2xx), sin dejar la ruta normal abierta, y queda auditado', async () => {
        const reason = 'Revisión por denuncia recibida, T6.5 issue #52';

        const res = await request(app.getHttpServer())
          .post(`/api/v1/patients/${overridePatientId}/access-override`)
          .set('Authorization', `Bearer ${supervisorToken}`)
          .send({ overrideReason: reason })
          .expect(201);
        expect(res.body.id).toBe(overridePatientId);

        // El override es una excepción puntual, no una sesión: GET
        // /patients/:id normal debe seguir bloqueando después, sin bypass
        // implícito.
        await request(app.getHttpServer())
          .get(`/api/v1/patients/${overridePatientId}`)
          .set('Authorization', `Bearer ${supervisorToken}`)
          .expect(403);

        // AuditInterceptor adjunta overrideReason al log automático del
        // POST -- se verifica que quede la fila, distinguible de un acceso
        // normal (que siempre tiene overrideReason null).
        const auditRow = await prisma.auditLog.findFirst({
          where: { resourceId: overridePatientId, overrideReason: { not: null } },
          orderBy: { createdAt: 'desc' },
        });
        expect(auditRow).not.toBeNull();
        expect(auditRow?.overrideReason).toBe(reason);
        expect(auditRow?.userId).toBeDefined();
      });
    });
  });
});
