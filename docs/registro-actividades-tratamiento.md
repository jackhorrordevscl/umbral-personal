# Registro de Actividades de Tratamiento (RAT)

Inventario de qué datos personales trata el sistema, con qué finalidad, bajo
qué base legal, quién accede y por cuánto tiempo se conservan. Documento
exigido por la Ley 21.719 (y consistente con las obligaciones de custodia de
la Ley 20.584 y de seguridad de la Ley 19.628) — issue #29 (T6.3), parte del
plan de compliance derivado de la auditoría técnica y legal (14 jul 2026).

Este documento se deriva directamente del modelo de datos real
(`backend/prisma/schema.prisma`) y de las decisiones ya implementadas en el
código (versionado de consultas, ledger de consentimientos, bitácora de
auditoría). Debe actualizarse cada vez que se agregue un modelo o un campo
que trate datos personales.

## Responsable del tratamiento

Umbral - RCE, a través del sistema de gestión de fichas clínicas descrito en
este repositorio.

## Inventario de actividades de tratamiento

| # | Actividad | Modelo(s) Prisma | Datos tratados | Finalidad | Base legal / consentimiento | Quién accede | Retención |
|---|---|---|---|---|---|---|---|
| 1 | Ficha clínica | `Patient` | Identificación, RUT, contacto, contacto de emergencia, médico/psiquiatra tratante | Prestación del servicio psicológico | Consentimiento informado — purpose `TREATMENT` en `PatientConsent` | Terapeuta tratante (`therapistId`); único rol del sistema (`enum Role { PROFESSIONAL }`), sin ruta de acceso excepcional | 15 años desde el cierre (Ley 20.584). Soft delete (`deletedAt`), nunca se borra físicamente |
| 2 | Consulta clínica | `Consultation` + `ConsultationHistory` | Motivo de consulta, intervención, acuerdos, próxima sesión | Registro obligatorio de cada sesión | Consentimiento `TREATMENT`; versionado append-only (`groupId`, `correctsId`) | Terapeuta tratante; correcciones quedan en `ConsultationHistory` | Igual que ficha (15 años); ninguna versión se sobreescribe |
| 3 | Telemedicina | `Consultation.sessionType = TELEMED`, `PatientDocument.type = TELEMED_AGREEMENT` | Datos de la consulta + acuerdo de telemedicina firmado | Atención remota | Consentimiento específico — purpose `TELEMEDICINE` | Terapeuta tratante | Igual que ficha |
| 4 | Email transaccional (verificación de cuenta / reset de contraseña) | `MailService` vía Resend (`backend/src/modules/mail/mail.service.ts`) | Nombre y email del profesional (dato del usuario del sistema, no del paciente) | Verificar la cuenta y permitir recuperar el acceso | Necesidad contractual para operar la cuenta — no requiere consentimiento del paciente porque no trata sus datos | Resend (procesador, EE.UU.); nadie más — el link de verificación/reset no viaja a ningún otro tercero | El email en sí no se retiene por Umbral más allá del envío; el token asociado expira (30 min en el reset) |
| 5 | Documentos adjuntos | `PatientDocument` (consentimiento informado, informes, otros) | Archivos/PDFs vinculados al paciente | Soporte de la ficha clínica | Consentimiento `TREATMENT` | Quien subió (`uploadedBy`) + terapeuta tratante | Igual que ficha |
| 6 | Exportación de PDF de ficha | Servicio de reportes (acción `EXPORT_PDF` en `AuditLog`) | Ficha + historial clínico completo | Entrega al paciente o a fiscalización | Deriva del consentimiento `TREATMENT` ya otorgado | Quien exporta, queda auditado | Hereda la retención de 15 años (obligación de custodia impresa en el pie del PDF) |
| 7 | Bitácora de auditoría | `AuditLog` | Usuario, acción, recurso, IP, user agent, detalle | Trazabilidad y evidencia ante fiscalización | Obligación legal / interés legítimo — no requiere consentimiento del paciente | Terapeuta tratante (lectura); inserción automática por el sistema, tabla append-only | **15 años**, igual que la ficha que audita — el log solo tiene razón de ser mientras existe el dato que audita |
| 8 | Historial de cambios de ficha | `PatientHistory` (snapshot + diff) | Ficha completa antes/después de cada edición | Trazabilidad de modificaciones a datos clínicos | Deriva de `TREATMENT` | Quien edita (`changedBy`), auditoría | Igual que ficha |
| 9 | Archivos compartidos (biblioteca interna) | `SharedFile` | Plantillas, formularios, protocolos — no son datos de pacientes | Recursos operativos del equipo | No aplica (no es dato personal de paciente) | Todo el staff autenticado | Sin retención legal específica — política interna |
| 10 | Backups | Workflow `.github/workflows/backup.yml` (fuera de Prisma; reemplaza a `backups/backup.sh`, pensado para una VM propia que ya no existe) | Volcado cifrado (AES-256, `openssl`) de toda la base | Continuidad operativa / recuperación ante desastre | Obligación de seguridad (Ley 19.628 art. 11 bis) | Quien tenga las credenciales de Backblaze B2 y la frase de cifrado (gestor de contraseñas del terapeuta) | Sin rotación: se conserva **todo, indefinidamente** — a este volumen (~40 KB/backup diario) 15 años de historial completo ocupan ~230 MB, muy por debajo de los 10 GB gratis de B2, así que no hace falta distinguir "operativo" de "custodia legal" con políticas de borrado distintas (issue #8, cerrado 2026-08-03) |
| 11 | Sincronización con Google Calendar (opcional, por terapeuta) | `GoogleCalendarConnection`, `CalendarEventLink` (`backend/src/modules/calendar-integration/`) | Iniciales del paciente + código corto no reversible (`sha256` truncado sobre `patient.id`, sin clave), fecha/hora de la sesión, link de vuelta a Umbral. Nunca RUT, nombre completo, `sessionType` ni texto clínico. El refresh token OAuth del terapeuta se cifra AES-256-GCM (`GOOGLE_TOKEN_ENCRYPTION_KEY`, dedicada — no comparte clave con `DocumentEncryptionService`) | Que el terapeuta vea sus sesiones de Umbral en su propia agenda de Google, sin re-tipearlas | No es un dato del paciente identificable fuera de Umbral (contenido minimizado por diseño) — la base habilitante es la necesidad contractual de operar la cuenta del terapeuta, quien conecta voluntariamente su propia cuenta de Google (`calendar.events`, `access_type=offline`) | El terapeuta dueño de la conexión (su propio Google Calendar); Google LLC como procesador de los eventos minimizados | Mientras la conexión esté `CONNECTED`; el evento y el mapeo (`CalendarEventLink`) se borran al eliminar la sesión/paciente o al desconectar; una revocación (`invalid_grant`) marca la conexión `DISCONNECTED` y detiene el envío sin reintentos |

> **Nota sobre la fila 1 (versiones previas de este documento):** este RAT
> describía anteriormente roles `SUPERVISOR`/`COORDINATOR`/`ADMIN` y un modo
> de "acceso excepcional" con `AuditLog.overrideReason`, y una fila 4 de
> "Compartir con red de salud" (purpose `HEALTH_NETWORK`). Ninguno de los
> tres existe en el código: el schema colapsó a un único rol
> (`schema.prisma:63-64`, ver comentario en `schema.prisma:210-217`),
> `AuditLog` solo tiene `detail` (no `overrideReason`, `schema.prisma:178-189`)
> y `ConsentPurpose` solo tiene `TREATMENT`/`TELEMEDICINE`
> (`schema.prisma:293-295`) — `HEALTH_NETWORK` se eliminó por migración
> (`20260802100000_remove_health_network_consent`, ver issue #71). Corregido
> issue #65.

## Transferencia internacional de datos

Toda la tabla de arriba asume implícitamente que los datos se procesan en
Chile, pero eso ya no es así:

- La base de datos primaria (**todas** las filas 1-9: fichas, consultas,
  documentos, auditoría, historial) vive en **Supabase, hosteado en São
  Paulo, Brasil**.
- La copia de backup (fila 10) vive en **Backblaze B2, hosteado en Estados
  Unidos** — mitigado parcialmente porque llega cifrada con AES-256 antes de
  subir, así que Backblaze nunca tiene acceso al contenido en claro (a
  diferencia de Supabase, que sí lo tiene por necesidad operativa: no se
  puede consultar/actualizar una ficha clínica sin que la base la lea en
  claro).
- El email transaccional (fila 4) se envía vía **Resend, hosteado en Estados
  Unidos** ("Company's primary processing operations take place in the
  United States") — pero a diferencia de las filas 1-9, acá el dato que
  transita es del **profesional que usa el sistema** (nombre, email), no del
  paciente. No es una transferencia de datos de salud, así que la base
  habilitante que aplica no es el consentimiento informado del paciente sino
  la necesidad contractual de operar la cuenta del profesional.
- La sincronización opcional con Google Calendar (fila 11) envía a la
  **Google Calendar API (Google LLC, Estados Unidos)** únicamente contenido
  ya minimizado: iniciales + código no reversible + fecha/hora + link de
  vuelta a Umbral. Igual que con Resend, el dato que sale es del
  **terapeuta** operando su propia cuenta de Google, no una identificación
  directa del paciente — pero al tratarse de metadata de una sesión clínica
  (fecha/hora de atención), no está resuelto si la Ley 21.719 lo trata igual
  que el email transaccional de la fila 4 o si, por derivarse de un dato de
  salud, requiere la misma base habilitante que las filas 1-9. Pendiente de
  revisión legal, igual que el resto de esta sección.

Esto constituye una transferencia internacional de datos de salud, que la
Ley 21.719 regula explícitamente (requiere alguna base habilitante: nivel de
protección adecuado del país destino, cláusulas contractuales con el
proveedor, consentimiento explícito informado del paciente sobre dónde se
almacenan sus datos, u otra excepción legal). **Esto no está resuelto ni
evaluado legalmente** — determinar si la configuración actual (Supabase
Brasil + Backblaze EE.UU.) cumple la Ley 21.719, y qué hace falta si no
cumple (cláusulas contractuales, ajustar el texto del consentimiento
informado, u otra medida), requiere revisión de alguien con conocimiento
legal real, no es una decisión de ingeniería. Hasta que se resuelva, este
punto queda documentado acá como riesgo abierto y conocido, no como algo ya
evaluado y aceptado.

Evidencia recopilada hasta ahora (issue #55), guardada en
`docs/evidencia-compliance/` (snapshots en PDF, con fecha, de páginas
públicas que los proveedores pueden actualizar):

- **Supabase**: `supabase-dpa-2026-08-03.pdf` — el DPA se incorpora
  automáticamente al aceptar los Términos de Servicio (cláusula 12.2:
  *"acceptance of the Agreement shall have the same effect as signing the
  SCCs"*), sin firma separada. Confirmado por fuente oficial.
- **Backblaze**: `backblaze-dpa-eea-eu-2026-08-03.pdf` +
  `backblaze-tos-2026-08-03.pdf` — mismo mecanismo de incorporación
  automática, pero el DPA público encontrado está textualmente acotado a
  *"when GDPR applies"* (UE/EEA). No confirma por sí solo que aplique a una
  transferencia desde Chile. Pendiente: respuesta de
  `privacy@backblaze.com` sobre si combinan su DPA/SCCs con las Cláusulas
  Contractuales Modelo (CCM) que el Ministerio de Economía de Chile aprobó
  en diciembre 2025 (Resolución RAEX202503748) para transferencias bajo la
  Ley 21.719 -- ojo que la validez de esa aprobación ministerial también
  está en debate legal (¿le correspondía a la futura Agencia de Protección
  de Datos Personales, no al Ministerio?).
- **Resend**: `resend-dpa-2026-08-04.pdf` — mismo mecanismo de incorporación
  automática del DPA al aceptar los Términos de Servicio
  (`resend.com/legal/dpa`). Procesamiento primario en Estados Unidos; lista
  de subprocesadores en `resend.com/legal/subprocessors`. El alcance del
  DPA es amplio (EU SCCs/GDPR, UK SCCs, Suiza FADP, CCPA) pero, igual que
  con Backblaze, no menciona Chile ni la Ley 21.719 explícitamente.

## Pendientes conocidos

- **Transferencia internacional de datos** — ver sección de arriba. Es el
  pendiente más importante de este documento hoy. Incluye, desde esta
  versión, la sincronización opcional con Google Calendar (fila 11):
  falta recopilar evidencia del DPA de Google (mismo criterio que
  `supabase-dpa-2026-08-03.pdf`/`resend-dpa-2026-08-04.pdf` en
  `docs/evidencia-compliance/`) y resolver si aplica la base habilitante de
  dato de salud o la de cuenta de profesional.
- **Firma electrónica avanzada** (filas 2 y 6, a futuro): la firma de cada
  consulta/corrección y el sello de tiempo en los PDF exportados dependen de
  elegir un proveedor acreditado por la Ley 19.799 — ver issues #24, #25, #26
  (T5.1, T5.2, T5.3).

## Mantenimiento de este documento

Actualizar esta tabla cuando:

- Se agregue un modelo o campo nuevo en `schema.prisma` que trate datos
  personales de pacientes o usuarios.
- Se agregue una nueva finalidad de consentimiento (`ConsentPurpose`).
- Cambie algún plazo de retención o se resuelva alguno de los pendientes
  listados arriba.
