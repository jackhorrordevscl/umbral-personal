# Datos verificados para la landing page

Fecha de verificación: 2026-10-27. Fuente: código del repositorio (`main` en `733181a`, posterior a `959a5a8`, etiquetado como `v1.0.0` el 2026-10-16), README y estado de GitHub. Las cifras cambian con cada PR; vuelve a contarlas antes de publicar.

Nota del 2026-10-17: el cifrado de los textos clínicos libres quedó activo en producción ese día con el recifrado de los datos existentes terminado (ADR 0004, `docs/evaluacion-v1.md` A3).

Regla general: afirma solo lo que está en la sección "Funcionalidades reales". Todo lo de "Qué NO afirmar" queda fuera del texto público.

## Producto

- **Nombre:** Umbral (en el repositorio y en la documentación técnica también aparece como "Umbral - RCE", sigla de registro clínico electrónico).
- **Descripción corta:** sistema de fichas clínicas para profesionales de salud mental que atienden por su cuenta, con agenda, cobro en línea y recordatorios, diseñado para alinearse con la normativa chilena de datos personales y de salud.
- **Descripción larga:** cada profesional tiene su propia cuenta y es dueño exclusivo de sus pacientes; no hay roles jerárquicos ni panel administrativo. El sistema reúne ficha clínica, consultas con historial de correcciones, documentos, calendario, agenda pública para que los pacientes reserven, cobro con Flow, recordatorios por email, cierre de tratamiento con informe de alta y registro de representante legal para pacientes niños, niñas y adolescentes (NNA).
- **Público objetivo:** psicólogas, psicólogos y terapeutas independientes en Chile. El registro es solo por invitación (código de un solo uso).
- **Estado:** `v1.0.0` etiquetada el 2026-10-16, con condiciones de salida abiertas (ver `docs/evaluacion-v1.md`).

## Funcionalidades reales

### Gestión de pacientes

- Ficha con datos de identificación, contacto y contacto de emergencia; RUT validado.
- Búsqueda por nombre o RUT, listado paginado e historial de cambios de cada ficha (con motivo y diferencias).
- Eliminación lógica: la ficha no se borra físicamente, por la custodia de 15 años de la Ley 20.584.
- Origen del paciente (canal de llegada) resumido en el Dashboard.

### Consultas y notas

- Registro de cada sesión con motivo, intervención, acuerdos y próxima sesión; presencial o telemedicina.
- Los textos libres de la consulta (motivo, intervención y acuerdos), incluidas las versiones anteriores del historial de correcciones, se guardan cifrados en la base de datos.
- Editor de texto enriquecido para las notas.
- Corrección con versionado: corregir no sobrescribe, crea una versión nueva y conserva la original.
- Registro de sesión propio adjunto (opcional) al corregir una consulta.
- Estado de entrega y apertura del recordatorio por email, visible por sesión.

### Documentos y archivos

- Documentos por paciente (consentimiento informado, asentimiento informado, acuerdo de telemedicina, informe del paciente, resumen de sesión, resultado de examen, informe de alta, autorización de entrega, otros): PDF, Word, Excel, ZIP e imágenes de hasta 25 MB, cifrados antes de almacenarse.
- Anulación de documentos con motivo obligatorio; el documento se conserva (custodia) y queda marcado como anulado.
- Repositorio personal privado de archivos (plantillas, protocolos, formularios), no compartido entre profesionales.

### Consentimiento

- Consentimiento por finalidad (tratamiento y telemedicina) como registro de eventos que no se borra: otorgar o revocar no elimina el historial.
- Se exige consentimiento vigente antes de registrar datos clínicos de una consulta.

### Pacientes NNA

- Registro de hasta 2 representantes legales por paciente (nombre, RUT, relación, contacto, custodia y roles: pagador, avisos, informes, consentimiento).
- El consentimiento de un NNA lo otorga un representante. Hasta el 2026-12-01 el sistema aún acepta el consentimiento legado otorgado por el propio NNA; desde esa fecha lo exige otorgado por un representante.
- Registro del asentimiento del niño, niña o adolescente (informado y oído, otorgado, rechazado o retirado) como ledger que no se borra. El asentimiento expreso (otorgado) se registra desde los 14 años; en un menor de 14 solo se registra "informado y oído". Nunca reemplaza el consentimiento del representante.
- No se admite repetir el RUT de un representante ni usar el del propio paciente.
- Los cobros de sesión y los avisos de cobro vencido y de cancelación de un NNA se dirigen a sus representantes, no a su email.

### Cierre de tratamiento e informe de alta

- Estado del tratamiento (activo, alta, derivación, deserción). Al cerrar el tratamiento se cancelan las consultas futuras del paciente y se avisa por email al paciente o a su representante.
- Informe de alta en PDF, con firma simple del terapeuta (nombre, RUT y registro profesional) y hash SHA-256 para verificar que no fue alterado. No es firma electrónica avanzada. También se puede subir un PDF propio.
- Los textos libres del informe de alta (motivo, diagnóstico, evolución, estado al alta, recomendaciones, nota de deserción y destino de derivación) se guardan cifrados en la base de datos; el hash se calcula sobre el texto en claro, así que sigue siendo verificable.
- Un informe emitido no se modifica: corregirlo crea una versión nueva y la anterior queda marcada como reemplazada.
- Registro de las entregas del informe (paciente, representante o tercero; canal y finalidad). El sistema no envía el informe: se descarga y se registra la entrega. Para un tercero se exige adjuntar un documento de autorización y que el terapeuta declare haberlo revisado; el sistema no comprueba su validez legal.
- Las reservas públicas se rechazan para un paciente con el tratamiento cerrado.

### Calendario y Google Calendar

- Calendario de sesiones.
- Conexión opcional con Google Calendar, de una sola vía (Umbral hacia Google). El evento solo lleva iniciales del paciente, un código corto y una descripción genérica que remite a la cuenta de Umbral; no incluye nombre completo, RUT, texto clínico, identificadores ni enlaces en el título ni en la descripción (el identificador interno del grupo de consultas va solo en una propiedad privada del evento).
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
- Notificaciones en la app con contador de no leídas y marcado como leídas; las leídas se purgan a los 30 días y las no leídas a los 90 días de generadas; el título y el cuerpo se guardan cifrados.
- Avisos de Google Calendar desconectado, cobro vencido, anomalías de cobro y paciente autoagendado sin monto de sesión.

### Seguridad de la cuenta

- MFA (TOTP) obligatorio para toda cuenta, con 10 códigos de recuperación de un solo uso.
- Recuperación de contraseña y de acceso por email y códigos, sin intervención manual.
- Sesión en cookie `HttpOnly` (no legible por scripts), contraseñas con Argon2, sesiones revocables, cierre de todas las sesiones al cambiar la contraseña, cierre por inactividad a los 8 minutos (corregido en móvil, issue #367).
- Límite de intentos por ruta sensible y, además, por cuenta para el código del segundo factor (bloqueo temporal tras 5 intentos fallidos).
- Los códigos de invitación se guardan con hash.

### Auditoría y reportes

- Bitácora de auditoría append-only (la base impide modificarla o borrarla).
- Exportación en PDF de la ficha clínica completa con historial y pie de página con referencia a la Ley 20.584.

## Cifras (verificadas el 2026-10-27)

| Dato | Valor | Cómo se verificó |
|---|---|---|
| Módulos de backend | 16 | carpetas de `backend/src/modules/` (además de `health` y `shared-files` en `backend/src/`) |
| Modelos de base de datos | 27 | `model` en `backend/prisma/schema.prisma` |
| Migraciones | 77 | carpetas de `backend/prisma/migrations/` |
| Endpoints HTTP | unos 104 | conteo de decoradores de ruta en `backend/src` |
| Tests unitarios backend | 140 specs | archivos `*.spec.ts` en `backend/src` |
| Tests e2e backend | 33 specs | archivos `*.e2e-spec.ts` en `backend/test` |
| Tests frontend | 84 specs + 4 e2e Playwright (corren en el job `e2e` de CI) | `frontend/src` y `frontend/e2e` |
| Páginas del frontend | 17 | archivos de página (sin contar specs) en `frontend/src/pages/` |
| Commits | 816 | `git rev-list --count HEAD` |
| Pull requests mergeados | 361 | `gh pr list --state merged` |
| Issues | 239 cerrados, 6 abiertos | `gh issue list` |
| Días de desarrollo | 86 | desde el primer commit, 2026-08-02, hasta 2026-10-27 |
| Vulnerabilidades de producción | Sin hallazgos de nivel high o critical | `npm audit --omit=dev --audit-level=high` en CI; el CI de `main` pasó el 2026-10-27. Con `npm audit --omit=dev` el backend tiene 1 moderate (`sanitize-html`) y el frontend 0 |

## Stack

- **Frontend:** React 19.2, TypeScript, Vite 7, Tailwind CSS 4, React Router 8, TanStack Query, React Hook Form con Zod 4, Tiptap 3, Vitest 4, Playwright.
- **Backend:** NestJS 11, TypeScript, Prisma 7.10 (driver adapter `pg`), PostgreSQL (16 en CI; Supabase corre 17.x según `backup.yml`), Passport con JWT, Argon2, PDFKit, Helmet.
- **Node:** 22 en CI.

## Integraciones

| Servicio | Uso |
|---|---|
| Flow | Cobro en línea; cada terapeuta usa su propia cuenta |
| Google Calendar | Sincronización opcional de sesiones |
| Resend | Email transaccional y de recordatorios, con seguimiento de entrega y apertura |
| Backblaze B2 | Almacenamiento de avatares, archivos, documentos cifrados y respaldos cifrados |
| Supabase | Base de datos PostgreSQL de producción (São Paulo, Brasil) |
| Render | Hosting del backend (plan gratuito a la fecha; región Oregón, EE.UU.) |
| Cloudflare | Delante del backend: el tráfico de la API pasa por Cloudflare antes de llegar a Render (`render.yaml`, `TRUSTED_PROXY_HOPS`) |
| Vercel | Hosting del frontend |
| Google Fonts | Tipografías cargadas desde servidores de Google (`frontend/src/index.css`) |
| UptimeRobot | Monitor externo que hace ping a `/api/v1/health` para que Render no duerma el servicio (issue #422; ver README) |
| Sentry | Registro de errores opcional, con datos personales redactados |

## Seguridad y cumplimiento: redacción segura

Frases que se pueden usar:

- "Diseñado para alinearse con la Ley 20.584, la Ley 19.628 y la Ley 21.719 de Chile."
- "Cada profesional ve únicamente a sus propios pacientes."
- "Autenticación de dos factores obligatoria."
- "Los documentos clínicos subidos se almacenan cifrados."
- "Los textos clínicos de las consultas y de los informes de alta se almacenan cifrados en la base de datos (cifrado a nivel de aplicación, AES-256-GCM)."
- "Las fichas y consultas nunca se borran físicamente: se conservan para cumplir la custodia de 15 años."
- "Respaldos diarios cifrados fuera de la plataforma principal."
- "Registro de auditoría que no se puede modificar."

Reglas:

- Nunca escribir "certificado", "certificación" ni "cumple plenamente" respecto de ninguna ley o norma. El proyecto no tiene certificaciones ni validación legal; el RAT mantiene pendientes de revisión legal (transferencia internacional de datos, bases habilitantes).
- No afirmar aislamiento "a nivel de base de datos" ni por RLS: la separación entre profesionales la hace el código de la aplicación.
- No afirmar que todos los datos personales están cifrados: se cifran los textos clínicos libres de consultas e informes de alta, el título y el cuerpo de las notificaciones internas, los documentos subidos (incluido el PDF del informe de alta), los tokens de Google, las credenciales de pago y el secreto MFA. El nombre, el RUT y los datos de contacto del paciente se guardan en texto plano en la base (paso 3 del ADR 0004).
- No afirmar cifrado "de extremo a extremo" ni que la plataforma no puede leer las notas: Umbral las descifra para mostrarlas y la clave está en el servidor. Tampoco afirmar que el cifrado impide alterar los textos con acceso de escritura a la base: no liga cada texto a su fila (ADR 0004, issue #486).
- No afirmar ubicación de datos solo en Chile: la base está en São Paulo, los archivos y respaldos en Estados Unidos, el backend en Render (Oregón) y el tráfico pasa por Cloudflare y Vercel.
- No afirmar firma electrónica avanzada ni validez legal del informe de alta: lleva firma simple y un hash de integridad (ADR 0006).
- No afirmar que el sistema valida la autorización para entregar un informe de alta a un tercero: solo registra el documento cargado y la declaración del terapeuta.
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
- Envío del informe de alta por el sistema: no existe; el informe se descarga y la entrega se registra a mano.

## Roadmap público (issues abiertos de funcionalidad)

| Issue | Tema | Estado |
|---|---|---|
| #156 | Múltiples tipos de servicio con precio en la agenda pública | Abierto |
| #160 | Boleta electrónica automática al confirmar pago (SII) | Pospuesto |
| #161 | Recordatorios de sesión por WhatsApp | Pospuesto |
| #162 | Transcriptor de sesiones a notas automáticas | Pospuesto |

Los otros dos issues abiertos son de infraestructura y seguridad interna (#63, plan de Render, y #486, ligar el cifrado de textos clínicos al paciente y al campo) y no deben presentarse como funcionalidades. El issue #123 (verificación de la app OAuth de Google) está cerrado.
