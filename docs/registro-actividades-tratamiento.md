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
| 1 | Ficha clínica | `Patient` | Identificación, RUT, contacto, contacto de emergencia, médico/psiquiatra tratante | Prestación del servicio psicológico | Consentimiento informado — purpose `TREATMENT` en `PatientConsent` | Terapeuta tratante (`therapistId`); `SUPERVISOR`/`COORDINATOR` según rol | 15 años desde el cierre (Ley 20.584). Soft delete (`deletedAt`), nunca se borra físicamente |
| 2 | Consulta clínica | `Consultation` + `ConsultationHistory` | Motivo de consulta, intervención, acuerdos, próxima sesión | Registro obligatorio de cada sesión | Consentimiento `TREATMENT`; versionado append-only (`groupId`, `correctsId`) | Terapeuta tratante; correcciones quedan en `ConsultationHistory` | Igual que ficha (15 años); ninguna versión se sobreescribe |
| 3 | Telemedicina | `Consultation.sessionType = TELEMED`, `PatientDocument.type = TELEMED_AGREEMENT` | Datos de la consulta + acuerdo de telemedicina firmado | Atención remota | Consentimiento específico — purpose `TELEMEDICINE` | Terapeuta tratante | Igual que ficha |
| 4 | Compartir con red de salud | `PatientConsent` purpose `HEALTH_NETWORK` | Datos clínicos ya existentes de la ficha | Continuidad de atención con otro profesional/institución | Consentimiento explícito `HEALTH_NETWORK`, o acceso excepcional auditado de `SUPERVISOR` (T6.5) | Profesional autorizado; `SUPERVISOR` en modo excepcional | Igual que ficha; el acceso excepcional queda registrado en `AuditLog.overrideReason` |
| 5 | Documentos adjuntos | `PatientDocument` (consentimiento informado, informes, otros) | Archivos/PDFs vinculados al paciente | Soporte de la ficha clínica | Consentimiento `TREATMENT` | Quien subió (`uploadedBy`) + terapeuta tratante | Igual que ficha |
| 6 | Exportación de PDF de ficha | Servicio de reportes (acción `EXPORT_PDF` en `AuditLog`) | Ficha + historial clínico completo | Entrega al paciente o a fiscalización | Deriva del consentimiento `TREATMENT` ya otorgado | Quien exporta, queda auditado | Hereda la retención de 15 años (obligación de custodia impresa en el pie del PDF) |
| 7 | Bitácora de auditoría | `AuditLog` | Usuario, acción, recurso, IP, user agent, motivo de excepción | Trazabilidad y evidencia ante fiscalización | Obligación legal / interés legítimo — no requiere consentimiento del paciente | `SUPERVISOR`/`ADMIN` (lectura); inserción automática por el sistema, tabla append-only | **15 años**, igual que la ficha que audita — el log solo tiene razón de ser mientras existe el dato que audita |
| 8 | Historial de cambios de ficha | `PatientHistory` (snapshot + diff) | Ficha completa antes/después de cada edición | Trazabilidad de modificaciones a datos clínicos | Deriva de `TREATMENT` | Quien edita (`changedBy`), auditoría | Igual que ficha |
| 9 | Archivos compartidos (biblioteca interna) | `SharedFile` | Plantillas, formularios, protocolos — no son datos de pacientes | Recursos operativos del equipo | No aplica (no es dato personal de paciente) | Todo el staff autenticado | Sin retención legal específica — política interna |
| 10 | Backups | Workflow `.github/workflows/backup.yml` (fuera de Prisma; reemplaza a `backups/backup.sh`, pensado para una VM propia que ya no existe) | Volcado cifrado (AES-256, `openssl`) de toda la base | Continuidad operativa / recuperación ante desastre | Obligación de seguridad (Ley 19.628 art. 11 bis) | Quien tenga las credenciales de Backblaze B2 y la frase de cifrado (gestor de contraseñas del terapeuta) | Sin rotación: se conserva **todo, indefinidamente** — a este volumen (~40 KB/backup diario) 15 años de historial completo ocupan ~230 MB, muy por debajo de los 10 GB gratis de B2, así que no hace falta distinguir "operativo" de "custodia legal" con políticas de borrado distintas (issue #8, cerrado 2026-08-03) |

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

## Pendientes conocidos

- **Transferencia internacional de datos** — ver sección de arriba. Es el
  pendiente más importante de este documento hoy.
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
