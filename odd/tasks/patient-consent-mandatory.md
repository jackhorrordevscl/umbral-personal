# Issue #131 — Consentimiento obligatorio de pacientes

## Objetivo
Que ningún tratamiento clínico real (`Consultation`) ocurra sin un `PatientConsent` vigente registrado en el ledger, sin importar por qué canal se creó el paciente (panel manual o auto-agenda pública), y que ese registro se genere automáticamente al subir el documento firmado — sin depender de que el terapeuta haga un paso manual extra.

## Marco legal (Chile)
- **Ley 20.584** (Derechos y Deberes de los Pacientes):
  - Art. 12 — la ficha clínica se abre desde el primer contacto. Crear el `Patient` sin consentimiento todavía NO es una infracción.
  - Art. 14 — el consentimiento informado debe existir **antes de iniciar el tratamiento/procedimiento**. Esta es la línea legal real que hay que blindar.
  - Art. 1° N°2 — un documento firmado (físico o digital) e incorporado a la ficha es forma válida de consentimiento; en telemedicina también se acepta firma electrónica simple o registro de aceptación verbal con constancia expresa.
  - Art. 25 — menores: consentimiento de padre/tutor + registro de la opinión del menor según su desarrollo.
  - Art. 13 — conservación de la ficha (y su consentimiento) por 15 años mínimo.
- **Ley 19.628 / 21.719** — datos de salud como categoría sensible; refuerza la exigencia de consentimiento informado para el tratamiento de esos datos.

## Hallazgo clave (por qué esto es más simple de lo que parecía al principio)
El schema **ya tiene todo lo necesario, pero desconectado**:
- `DocumentType` ya incluye `INFORMED_CONSENT`, `INFORMED_ASSENT` (asentimiento de menores) y `TELEMED_AGREEMENT` (`backend/prisma/schema.prisma:211-218`).
- `PatientConsent` ya es el ledger de eventos GRANT/REVOKE por finalidad (`schema.prisma:376`), con `purpose: TREATMENT` (mostrado en frontend como **"Presencial"**, `frontend/src/types/patient.ts:6`) y `TELEMEDICINE`.
- El estado visual en la ficha (`"Consentimiento ✓"` / `"Pendiente"`, `frontend/src/pages/PatientsPage.tsx:254,321`) ya lee ese ledger vía `hasAnyConsent()`.
- El upload de documentos (`DocumentsService.uploadDocument`, `backend/src/modules/documents/documents.service.ts:59-68`) crea el `PatientDocument`, pero **nunca dispara un evento en `PatientConsent`**. Son dos features que no se hablan entre sí — ese es el único gap real de código.
- `ConsultationsService.create()` (`backend/src/modules/consultations/consultations.service.ts:90-105`) no valida consentimiento antes de crear la consulta — ahí falta el guardrail.

## Diseño acordado

1. **Creación del `Patient` (ambos canales, incluida auto-agenda):** sin bloqueo. Consistente con Art. 12 — la ficha se abre igual, consentimiento queda "pendiente".
2. **Auto-agenda pública:** no se construye firma digital nueva. El terapeuta gestiona el consentimiento por el canal que prefiera (mail con PDF para firmar y devolver, o en persona antes de la primera sesión) y lo sube como documento — mismo mecanismo que el alta manual. Sin desarrollo nuevo específico para este canal.
3. **Al subir `PatientDocument` de tipo `INFORMED_CONSENT` / `INFORMED_ASSENT` / `TELEMED_AGREEMENT`:** se dispara automáticamente `PatientsService.recordConsent()` con `purpose` correspondiente (`TREATMENT` si presencial, `TELEMEDICINE` si remoto) y `action: GRANT`, con `evidence` autogenerado (ej. nombre/id del documento, cumpliendo el mínimo de 10 caracteres del DTO). Esto hace que el checkbox "Presencial"/"Telemedicina" y el badge verde de la ficha se actualicen solos, sin acción manual del terapeuta.
4. **Guardrail en `ConsultationsService.create()`:** después de `assertAccess` (línea 95-98) y antes de `prisma.consultation.create`, verificar `getConsentStatusMap([patientId])` — si no hay `TREATMENT` ni `TELEMEDICINE` en `true`, se rechaza la consulta.

## Checklist

- [x] **T1** — Conectado `uploadDocument` → `recordConsent` en `backend/src/modules/documents/documents.service.ts`. `INFORMED_CONSENT`→`TREATMENT`, `TELEMED_AGREEMENT`→`TELEMEDICINE`, ambos con `action: GRANT` y evidencia trazable al documento (nombre + id). `INFORMED_ASSENT` a propósito NO dispara consentimiento automático (el asentimiento de un menor no reemplaza el consentimiento del tutor, Art. 25 — ver T4). Si el registro del evento falla, se loguea pero no revierte el upload — falla "cerrado" (el guardrail de T2 sigue bloqueando tratamiento). Type-check OK. Falta test unitario (cubierto en T6).
- [x] **T2** — Guardrail agregado en `ConsultationsService.create()` (`consultations.service.ts:90`) y también en `correct()` (`consultations.service.ts:297`) — hallazgo durante la implementación: `createFromPublicBooking()` crea una `Consultation` placeholder sin contenido clínico real (coherente con no bloquear la reserva), pero el contenido clínico real se carga después vía `correct()`, que no tenía ningún guardrail. Ambos puntos ahora chequean `getConsentStatusMap` y rechazan con `ForbiddenException` si no hay `TREATMENT` ni `TELEMEDICINE` vigente — mismo criterio que el badge de la ficha (issue #27, cualquiera de las dos finalidades habilita). Tests unitarios agregados (4 nuevos, 34/34 verdes). Con Postgres levantado, corrida la suite de integración: falló como se esperaba (7/8, pacientes seed sin `PatientConsent`) — se agregó el registro de consentimiento a los 3 fixtures que usan `create()`/`correct()` directamente (`consultations.service.integration.spec.ts`, bloques "Google Fallando", "Rango", "Pagos"; el de "public-booking-concurrency" no lo necesita porque usa `createFromPublicBooking()`, sin guardrail). Eso destapó un segundo bug: el `afterAll` de esos 3 bloques no borraba `PatientConsent` antes del paciente — mismo patrón de FK ya documentado con `AuditLog` (`project_auditlog_fk_permission_bug`). Corregido agregando `patientConsent.deleteMany` antes de `patient.deleteMany` en cada cleanup. 8/8 integración verde.
- [x] **T3** — Confirmado: el documento de consentimiento lo genera el propio terapeuta, fuera de la plataforma (no es una feature a construir). El cumplimiento del contenido mínimo del Art. 14 es responsabilidad del terapeuta, no del sistema. Fuera de alcance de código.
- [x] **T4** — Menores de edad (Art. 25): sacado de este issue. Hoy no hay pacientes menores en la plataforma (caso hipotético, confirmado por el usuario). Queda anotado para abrir como issue separado si/cuando aparezca un caso real — requeriría campo de representante legal en `Patient` + flujo de doble documento (consentimiento del tutor + `INFORMED_ASSENT` del menor).
- [x] **T5** — Decisión del usuario: "Aviso + bulk-declare temporal" — el terapeuta declara en bloque el consentimiento de sus pacientes activos (papel/expediente físico previo) antes de que el guardrail se aplique estricto.
  - Backend: `BulkDeclareConsentDto` (`backend/src/modules/patients/dto/bulk-declare-consent.dto.ts`), `PatientsService.bulkDeclareConsent()` (reutiliza `recordConsent` por paciente — un id inválido/ajeno no aborta el resto del lote), endpoint `POST /patients/consents/bulk-declare`. Tests unitarios (2 nuevos, 29/29 verdes).
  - Frontend: `frontend/src/api/patients.ts` (`bulkDeclarePatientConsent`), `frontend/src/hooks/usePatients.ts` (`useBulkDeclareConsent`), `frontend/src/pages/PatientsPage.tsx` — checkbox por fila (solo en pacientes sin consentimiento, desktop y mobile), barra de acción con selector de finalidad + evidencia + botón "Declarar", reporta si algún paciente del lote falló. Type-check y lint limpios.
- [x] **T6** — Tests e2e agregados en `backend/test/patient-consent.e2e-spec.ts` (17/17 verdes, contra Postgres real): guardrail en `create()`/`correct()` de `Consultation` (403 sin consentimiento, 2xx con consentimiento, 403 tras revocar), upload de `INFORMED_CONSENT` dispara el evento automático (y `INFORMED_ASSENT` deliberadamente NO), y `POST /patients/consents/bulk-declare` (declara los propios, reporta el ajeno sin abortar el lote, valida evidencia mínima). Suites completas de `patients`/`consultations`/`documents` re-corridas: 81/81 verdes.

## Criterios de aceptación
- Subir un documento de tipo consentimiento genera automáticamente el evento GRANT correspondiente en `PatientConsent`, sin acción manual adicional.
- No existe forma de crear un `Consultation` para un paciente sin consentimiento vigente.
- El estado visual de la ficha (`"Consentimiento ✓"`) refleja ese ledger sin intervención manual.
- Tests e2e cubren ambos puntos.
- T4 (menores) resuelto explícitamente (en alcance o issue separado) antes de cerrar.

## Fuera de alcance
- Firma digital/e-signature embebida en el flujo de auto-agenda (evaluado y descartado por ahora — mayor esfuerzo para resolver algo que el mecanismo de documentos ya cubre).
- Migración retroactiva masiva de pacientes ya existentes (T5 solo define la decisión, no la ejecuta).

## Estado
Diseño confirmado con el usuario tras corrección legal (Ley 20.584 Arts. 12/14/25) y aclaración del flujo real (upload de archivo, no checkbox digital). TDD: a resolver según configuración del proyecto al empezar T1.

## Review (RDD, review-reliability, riesgo medio)
Aprobado, 3 hallazgos no bloqueantes atendidos:
- **R3-001** (`documents.service.ts`): rama catch de `recordConsent` sin cobertura. Creado `documents.service.spec.ts` (no existía) con 6 tests, incluyendo el camino de falla.
- **R3-002** (`PatientsPage.tsx`): UI de bulk-declare sin tests, y el aviso de fallos parciales quedaba anidado dentro de la caja de selección — al limpiar la selección (siempre, incluso con fallos), el mensaje de error desaparecía antes de que el terapeuta lo viera. Bug real, corregido moviendo el aviso afuera de esa caja. Agregados 3 tests en `PatientsPage.spec.tsx`.
- **R3-003** (`consultations.service.ts` `correct()`): el guardrail de consentimiento corría antes del chequeo de "versión ya corregida", cambiando la precedencia (403 en vez de 409 esperado). Reordenado: el chequeo de versión va primero. Agregado test de precedencia en `consultations.service.spec.ts`.

Todo re-verificado tras las correcciones: backend 88/88 (unit+integración), e2e 17/17, frontend 128/128.

### Segunda review (sobre el diff acumulado, ambos commits)
Aprobado de nuevo, 5 hallazgos no bloqueantes — anotados, sin atender todavía:
- **R3-001** (WARNING, `consultations.service.ts:101-116`): el chequeo de consentimiento y la escritura de la `Consultation` no están en la misma transacción — una revocación justo entre medio (carrera de concurrencia) no se detecta, la consulta se crea igual con datos stale.
- **R3-002** (WARNING, `patients.service.ts:326-332`): `bulkDeclareConsent()` devuelve `err.message` tal cual al cliente. Solo probado el caso esperado (404); un error inesperado de DB podría filtrar detalle interno en la respuesta de un endpoint de datos de salud.
- **R3-003** (SUGGESTION, `bulk-declare-consent.dto.ts:16-19`): `patientIds` sin límite de tamaño ni chequeo de duplicados — lote gigante puede colgar el request, un id repetido genera eventos GRANT duplicados en el ledger.
- **R3-004** (SUGGESTION, `documents.service.ts:97-106`): si `recordConsent` falla durante el upload, la respuesta sigue siendo 2xx sin ninguna señal — el frontend no se entera en el momento de que el consentimiento no quedó registrado.
- **R3-005** (SUGGESTION, `PatientsPage.tsx:276`): el revisor no pudo confirmar solo con el diff que `AlertCircle` esté importado (ícono preexistente en el archivo, probablemente OK, pero no verificable desde el diff).

## Hallazgos de la segunda review — atendidos (WARNING)
- **R3-001**: chequeo de consentimiento movido dentro de la misma transacción que la escritura de `Consultation`, en `create()` y `correct()` (`consultations.service.ts`) — cierra la ventana de carrera entre el chequeo y el insert. `getConsentStatusMap` ahora acepta un cliente de transacción opcional.
- **R3-002**: `bulkDeclareConsent` (`patients.service.ts`) solo devuelve `err.message` cuando es una `HttpException` conocida; cualquier otro error se loguea server-side y responde un mensaje genérico, para no filtrar detalle interno de un endpoint de datos de salud.
- R3-003, R3-004, R3-005 (SUGGESTION) quedan sin atender — no bloqueantes, anotados por si se retoma esta área.

Verificado tras la corrección: type-check limpio, unitarios 604/604 (suite completa) + 65/65 específicos de `consultations`/`patients`, integración 14/14 y e2e de consentimiento 17/17 contra Postgres local.

## Review RDD (candidato: fix R3-001/R3-002)
Aprobada (`review-reliability`, riesgo medio, 180 líneas/5 archivos). Reconocida con `gentle-ai review acknowledge-approved` — autoridad quemada (`lineage review-fd484b95e0694763`).

## Próximo paso
Todas las tareas (T1-T6) completas y verificadas. Primera review: 3 hallazgos atendidos. Segunda review: los 2 WARNING (R3-001, R3-002) atendidos y con su propia review RDD aprobada; los 3 SUGGESTION quedan anotados sin atender. Issue #131 listo para push/PR cuando el usuario lo pida.
