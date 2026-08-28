# Cláusula de transferencia internacional de datos — consentimiento informado

> ✅ **Aplicada — 2026-08-03.** El texto de abajo ya se agregó a los dos
> documentos reales de consentimiento informado (issue #59, cerrado). Este
> archivo queda como registro de la redacción y de dónde vive en cada
> documento.

## Contexto

Ver `docs/registro-actividades-tratamiento.md`, sección "Transferencia
internacional de datos": la base primaria de datos clínicos vive en
Supabase (São Paulo, Brasil) y los backups cifrados en Backblaze B2
(Estados Unidos). El consentimiento informado que firma cada paciente hoy
no menciona este hecho. Este documento existe para darle un lugar
versionado a la cláusula que debería agregarse, hasta ahora inexistente en
el repo (el consentimiento informado real es un documento externo en
papel/PDF, no un texto que viva en el código de la app).

## Propuesta de texto

> Su ficha clínica y el resto de sus datos de atención se gestionan a
> través de **Umbral**, un sistema de registro clínico electrónico (RCE)
> que, para garantizar su disponibilidad, seguridad y respaldo continuo,
> opera sobre infraestructura de nube (*cloud computing*). Por este
> motivo, sus datos clínicos (ficha, consultas, documentos asociados) se
> almacenan y procesan en servidores ubicados en **São Paulo, Brasil**.
> Adicionalmente, se generan copias de seguridad cifradas (AES-256) de
> forma diaria, que se almacenan en servidores ubicados en **Estados
> Unidos**; estas copias solo son legibles con una clave de cifrado que
> custodia el profesional tratante, por lo que el proveedor de
> almacenamiento no tiene acceso al contenido de las mismas.

## Dónde va este texto

No hay un generador de PDF de consentimiento en la app — el flujo actual
es: el profesional gestiona el documento externo, lo hace firmar, y sube
el PDF firmado vía `PatientDocument` tipo `INFORMED_CONSENT`. Se revisaron
los dos documentos reales que usa el profesional (no versionados en este
repo por contener su nombre — ver `.gitignore`), y ambos ya tienen una
sección de confidencialidad/protección de datos donde esta cláusula encaja
como un subpunto nuevo:

- **`CONSENTIMIENTO INFORMADO ADULTOS Y NNA.docx`** — sección **IV.
  CONFIDENCIALIDAD Y PROTECCIÓN DE DATOS PERSONALES**. Insertar como
  **4.2** (después de "4.1 Principio general de confidencialidad", antes
  de la actual 4.2 "Excepciones legales a la confidencialidad", que pasa a
  ser 4.3; la actual 4.3 "Supervisión y consulta clínica" pasa a 4.4).
- **`CONSENTIMIENTO INFORMADO TELEPSICOLOGÍA.docx`** — sección **V.
  CONFIDENCIALIDAD Y PROTECCIÓN DE DATOS PERSONALES**, mismo patrón:
  insertar como **5.2** (después de "5.1", antes de la actual 5.2
  "Excepciones Legales a la Confidencialidad", que pasa a ser 5.3).

Encabezado sugerido para el subpunto nuevo en ambos documentos:
**"Almacenamiento y transferencia internacional de datos"**.

## Estado

- [x] Issue #55 (base habilitante DPA) cerrado el 2026-08-03, con gap
      residual sobre Backblaze/Chile aceptado y documentado en el RAT.
- [x] Texto agregado a ambos `.docx` (4.2 y 5.2 respectivamente),
      renumerando las secciones siguientes, el 2026-08-03.
- [ ] Pendiente, fuera del alcance técnico de este repo: que el
      profesional use la versión actualizada de los documentos con cada
      paciente nuevo desde ahora, y --si aplica-- actualice la fecha de
      vigencia en `docs/manual-terapeutas.md`.
- [ ] **No incluido todavía: sincronización con Google Calendar**
      (sdd/google-calendar-integration, issue #78). El RAT
      (`docs/registro-actividades-tratamiento.md`, fila 11) ya documenta
      esta transferencia a Google LLC (Estados Unidos), pero deja
      explícitamente sin resolver si aplica la misma base habilitante que
      esta cláusula (consentimiento informado del paciente) o la de
      cuenta de profesional — el contenido enviado es metadata minimizada
      (iniciales + código no reversible + fecha/hora), no una
      identificación directa del paciente. No se agrega texto a esta
      cláusula hasta que esa base habilitante se resuelva en el RAT; no
      corresponde redactarlo por adelantado sin esa decisión.
