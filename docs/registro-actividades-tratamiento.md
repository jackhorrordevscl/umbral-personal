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

Umbral SpA, a través del sistema de gestión de fichas clínicas descrito en
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
| 10 | Backups | `backups/backup.sh` (fuera de Prisma) | Volcado cifrado de toda la base | Continuidad operativa / recuperación ante desastre | Obligación de seguridad (Ley 19.628 art. 11 bis) | Quien tenga acceso al servidor/NAS | Operativo: rota cada `RETENTION_DAYS`. Custodia legal: mensual, nunca se borra (15 años, Ley 20.584) |

## Pendientes conocidos

- **Copia offsite real de backups** (fila 10): hoy solo existe una segunda
  copia local en un dispositivo físico distinto (NAS), que **no** cumple la
  regla de offsite real (no protege contra un desastre de sitio). Bloqueado
  hasta definir un proveedor externo (S3/B2/rclone) — ver issue #17 (T3.3).
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
