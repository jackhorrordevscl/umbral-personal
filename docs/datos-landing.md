# Datos verificados para la landing page

Fecha de verificación: 2026-10-06. Fuente: código del repositorio (rama `docs/sync-v1-oct2026`), README y estado de GitHub. Las cifras cambian con cada PR; vuelve a contarlas antes de publicar.

Regla general: afirma solo lo que está en la sección "Funcionalidades reales". Todo lo de "Qué NO afirmar" queda fuera del texto público.

## Producto

- **Nombre:** Umbral (en el repositorio y en la documentación técnica también aparece como "Umbral - RCE", sigla de registro clínico electrónico).
- **Descripción corta:** sistema de fichas clínicas para profesionales de salud mental que atienden por su cuenta, con agenda, cobro en línea y recordatorios, diseñado para alinearse con la normativa chilena de datos personales y de salud.
- **Descripción larga:** cada profesional tiene su propia cuenta y es dueño exclusivo de sus pacientes; no hay roles jerárquicos ni panel administrativo. El sistema reúne ficha clínica, consultas con historial de correcciones, documentos, calendario, agenda pública para que los pacientes reserven, cobro con Flow y recordatorios por email.
- **Público objetivo:** psicólogas, psicólogos y terapeutas independientes en Chile. El registro es solo por invitación (código de un solo uso).
- **Estado:** en preparación para v1 (ver `docs/evaluacion-v1.md`).

## Funcionalidades reales

### Gestión de pacientes

- Ficha con datos de identificación, contacto y contacto de emergencia; RUT validado.
- Búsqueda por nombre o RUT, listado paginado e historial de cambios de cada ficha (con motivo y diferencias).
- Eliminación lógica: la ficha no se borra físicamente, por la custodia de 15 años de la Ley 20.584.
- Origen del paciente (canal de llegada) resumido en el Dashboard.

### Consultas y notas

- Registro de cada sesión con motivo, intervención, acuerdos y próxima sesión; presencial o telemedicina.
- Editor de texto enriquecido para las notas.
- Corrección con versionado: corregir no sobrescribe, crea una versión nueva y conserva la original.
- Registro de sesión propio adjunto (opcional) al corregir una consulta.
- Estado de entrega y apertura del recordatorio por email, visible por sesión.

### Documentos y archivos

- Documentos por paciente (consentimiento informado, asentimiento informado, acuerdo de telemedicina, otros): PDF, Word, Excel, ZIP e imágenes de hasta 25 MB, cifrados antes de almacenarse.
- Anulación de documentos con motivo obligatorio; el documento se conserva (custodia) y queda marcado como anulado.
- Repositorio personal privado de archivos (plantillas, protocolos, formularios), no compartido entre profesionales.

### Consentimiento

- Consentimiento por finalidad (tratamiento y telemedicina) como registro de eventos que no se borra: otorgar o revocar no elimina el historial.
- Se exige consentimiento vigente antes de registrar datos clínicos de una consulta.

### Calendario y Google Calendar

- Calendario de sesiones.
- Conexión opcional con Google Calendar, de una sola vía (Umbral hacia Google). El evento solo lleva iniciales del paciente, un código corto y un enlace a Umbral; no incluye nombre completo, RUT ni texto clínico.
- Opcional: los horarios ocupados de tu Google Calendar pueden descontarse de la disponibilidad pública (depende de una opción de configuración del servidor).

### Agenda pública por enlace propio

- Enlace público con el nombre del terapeuta (por ejemplo `/book/nombre-apellido`); los enlaces antiguos con identificador siguen funcionando.
- El paciente ve horarios libres según el horario semanal, los bloqueos y los feriados de Chile, y reserva sin crear cuenta.
- Reserva con 24 horas de anticipación mínima y hasta 60 días hacia adelante.
- Protección contra doble reserva del mismo horario.
- Checkout en línea opcional: si el terapeuta tiene Flow conectado, el paciente puede ver el enlace de pago al confirmar (depende de una opción de configuración del servidor).

### Perfil público y sitio web

- Perfil público con nombre, foto, especialidad, bio y sitio web opcional, visible en la agenda pública.

### Pagos con Flow

- Cada terapeuta conecta su propia cuenta Flow con un asistente de 5 pasos; las credenciales se validan antes de guardarse y se almacenan cifradas.
- Cobro automático por sesión (si el paciente tiene monto configurado), con enlace de pago enviado por email.
- Reenvío del enlace de pago, reintento de cobro cuando no se pudo generar y corrección del monto.
- Conciliación periódica de pagos y aviso de cobros vencidos.
- Umbral no custodia el dinero: el pago va directo a la cuenta Flow del terapeuta.

### Recordatorios y notificaciones

- Recordatorios de sesión 24 horas y 2 horas antes, por notificación en la app y por email al terapeuta.
- Notificaciones en la app con contador de no leídas y marcado como leídas; las leídas se purgan a los 30 días.
- Avisos de Google Calendar desconectado, cobro vencido, anomalías de cobro y paciente autoagendado sin monto de sesión.

### Seguridad de la cuenta

- MFA (TOTP) obligatorio para toda cuenta, con 10 códigos de recuperación de un solo uso.
- Recuperación de contraseña y de acceso por email y códigos, sin intervención manual.
- Contraseñas con Argon2, sesiones revocables, cierre de todas las sesiones al cambiar la contraseña, cierre por inactividad en escritorio.
- Límite de intentos por ruta sensible.

### Auditoría y reportes

- Bitácora de auditoría append-only (la base impide modificarla o borrarla).
- Exportación en PDF de la ficha clínica completa con historial y pie de página con referencia a la Ley 20.584.

## Cifras (verificadas el 2026-10-06)

| Dato | Valor | Cómo se verificó |
|---|---|---|
| Módulos de backend | 15 | carpetas de `backend/src/modules/` |
| Modelos de base de datos | 23 | `model` en `backend/prisma/schema.prisma` |
| Migraciones | 65 | carpetas de `backend/prisma/migrations/` |
| Endpoints HTTP | unos 83 | conteo de decoradores de ruta en `backend/src` |
| Tests unitarios backend | 86 specs | archivos `*.spec.ts` en `backend/src` |
| Tests e2e backend | 26 specs | `backend/test` |
| Tests frontend | 65 specs + 1 e2e Playwright (este último no corre en CI) | `frontend/src` y `frontend/e2e` |
| Páginas del frontend | 17 | archivos en `frontend/src/pages/` |
| Commits | 403 | `git rev-list --count HEAD` |
| Pull requests mergeados | 173 | `gh pr list --state merged` |
| Issues | 195 cerrados, 11 abiertos | `gh issue list` |
| Días de desarrollo | 65 | desde el primer commit, 2026-08-02, hasta 2026-10-06 |
| Vulnerabilidades de producción | 0 | `npm audit --omit=dev` en CI (al 2026-10-06 según la auditoría previa) |

## Stack

- **Frontend:** React 19.2, TypeScript, Vite 7, Tailwind CSS 3.4, React Router 8, TanStack Query, React Hook Form con Zod 4, Tiptap 3, Vitest 4, Playwright.
- **Backend:** NestJS 11, TypeScript, Prisma 6.19, PostgreSQL 16, Passport con JWT, Argon2, PDFKit, Helmet.
- **Node:** 22 en CI.

## Integraciones

| Servicio | Uso |
|---|---|
| Flow | Cobro en línea; cada terapeuta usa su propia cuenta |
| Google Calendar | Sincronización opcional de sesiones |
| Resend | Email transaccional y de recordatorios, con seguimiento de entrega y apertura |
| Backblaze B2 | Almacenamiento de avatares, archivos, documentos cifrados y respaldos cifrados |
| Supabase | Base de datos PostgreSQL de producción (São Paulo, Brasil) |
| Render | Hosting del backend (plan gratuito a la fecha) |
| Vercel | Hosting del frontend |
| Sentry | Registro de errores opcional, con datos personales redactados |

## Seguridad y cumplimiento: redacción segura

Frases que se pueden usar:

- "Diseñado para alinearse con la Ley 20.584, la Ley 19.628 y la Ley 21.719 de Chile."
- "Cada profesional ve únicamente a sus propios pacientes."
- "Autenticación de dos factores obligatoria."
- "Los documentos clínicos subidos se almacenan cifrados."
- "Las fichas y consultas nunca se borran físicamente: se conservan para cumplir la custodia de 15 años."
- "Respaldos diarios cifrados fuera de la plataforma principal."
- "Registro de auditoría que no se puede modificar."

Reglas:

- Nunca escribir "certificado", "certificación" ni "cumple plenamente" respecto de ninguna ley o norma. El proyecto no tiene certificaciones ni validación legal; el RAT mantiene pendientes de revisión legal (transferencia internacional de datos, bases habilitantes).
- No afirmar aislamiento "a nivel de base de datos" ni por RLS: la separación entre profesionales la hace el código de la aplicación.
- No afirmar que las notas clínicas están cifradas: solo se cifran los documentos subidos, los tokens de Google, las credenciales de pago y el secreto MFA.
- No afirmar ubicación de datos solo en Chile: la base está en São Paulo y los archivos y respaldos en Estados Unidos.
- No prometer disponibilidad ni recordatorios garantizados mientras el backend siga en el plan gratuito de Render (ver `docs/evaluacion-v1.md`).

## Qué NO afirmar

- Múltiples pasarelas de pago: hoy solo existe Flow (la arquitectura permite agregar otras, pero no hay otra implementada).
- Recordatorios por WhatsApp (#161): pospuesto, no existe.
- Boleta electrónica automática del SII (#160): pospuesto, no existe.
- Transcripción de sesiones con IA (#162): pospuesto, no existe.
- Varios tipos de servicio con precio distinto en la agenda pública (#156): no existe.
- Email de confirmación de la reserva al paciente o al terapeuta: no se envía hoy; la reserva queda en la lista de consultas.
- Registro libre: el alta requiere código de invitación.
- App móvil nativa: no existe (es una aplicación web).
- Cierre automático por inactividad en móvil: hoy no funciona de forma confiable (#367).

## Roadmap público (issues abiertos de funcionalidad)

| Issue | Tema | Estado |
|---|---|---|
| #156 | Múltiples tipos de servicio con precio en la agenda pública | Abierto |
| #160 | Boleta electrónica automática al confirmar pago (SII) | Pospuesto |
| #161 | Recordatorios de sesión por WhatsApp | Pospuesto |
| #162 | Transcriptor de sesiones a notas automáticas | Pospuesto |

Otros issues abiertos son de mantenimiento, infraestructura o cumplimiento (#63, #75, #123, #255, #367, #371, #376) y no deben presentarse como funcionalidades.
