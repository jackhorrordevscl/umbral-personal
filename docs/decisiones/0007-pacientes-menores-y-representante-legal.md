# ADR 0007 - Pacientes menores de edad y representante legal

- **Estado:** aceptada
- **Fecha:** 2026-10-08
- **Rama:** `feat/menores-representante-legal-esquema` (bloque Menores, tareas M1 a M6)

> El número 0006 queda reservado para el ADR del informe de alta (firma simple
> y hash de integridad), que se escribe con ese bloque.

## Contexto

Hasta este cambio el sistema no distinguía a un menor de edad: no calculaba la
edad, no registraba a un representante, no guardaba quién otorgó cada
consentimiento y todos los avisos al paciente iban a su propio email. El
documento `INFORMED_ASSENT` se podía subir, pero no tenía efecto en el ledger.
El caso había quedado diferido (T4 de `odd/tasks/patient-consent-mandatory.md`)
como hipotético. Dejó de serlo: el usuario confirmó que hay menores reales en
producción (una consulta de solo lectura arrojó 1 paciente menor de 18 años).

### Marco normativo (fuentes parciales)

Lo que sigue es un resumen de trabajo, no una validación legal.

- Ley 20.584, art. 14: el consentimiento informado recae en el representante
  legal cuando el paciente no puede darlo. No hay una edad explícita desde la
  cual un adolescente consienta solo una atención psicológica. La excepción de
  los 14 años del mismo artículo es solo para la prueba de PCR.
- Ley 21.331, art. 25, y Ley 21.430 (arts. 11, 28 y 40): el niño, niña o
  adolescente tiene derecho a ser informado y oído, y debe constar. El art. 25
  de la Ley 20.584 fue derogado por la Ley 21.331 (2021-05-11); el comentario
  de `documents.service.ts` que lo citaba se corrigió.
- Ley 21.719 (art. 16 quáter de la Ley 19.628): interés superior y autonomía
  progresiva; menores de 14 requieren consentimiento de los padres o de quien
  tenga el cuidado personal, y los datos sensibles (incluye salud) de menores
  de 16 también. Vigencia prevista el 2026-12-01, salvo que se publique la
  postergación del Boletín 18.623-07 (ingresó el 2026-09-01; sin aprobación
  verificada al 2026-10-08).
- Pendiente de lectura: art. 13 consolidado de la Ley 20.584 en BCN y el
  código de ética vigente del Colegio de Psicólogos.

El diseño de este ADR es una **recomendación conservadora de producto**, no una
exigencia legal verificada.

## Decisión

### 1. Representante legal y asentimiento del paciente

Para un paciente menor de 18 años el tratamiento se apoya en dos registros
distintos:

- **Autorización del representante legal.** Modelo `LegalGuardian` (hasta 2 por
  paciente): nombre, RUT, relación (`MOTHER`, `FATHER`, `LEGAL_GUARDIAN`,
  `CURATOR`, `CAREGIVER`, `OTHER`), email, teléfono y las marcas `isPayer`,
  `receivesCommunications`, `canAccessReports`, `canConsent`, además de custodia
  (`SOLE`, `SHARED`, `UNKNOWN`) y `hasConflict`. El consentimiento de un menor
  se registra en `PatientConsent` con `grantedBy = GUARDIAN` y el `guardianId`
  de quien lo otorga.
- **Asentimiento del paciente.** Ledger append-only `PatientAssent` con la
  acción (`GRANTED`, `REFUSED`, `WITHDRAWN`, `INFORMED_AND_HEARD`), una nota
  opcional de hasta 500 caracteres y el documento de respaldo opcional. El
  asentimiento nunca reemplaza el consentimiento del representante. Un rechazo
  del paciente alerta al terapeuta en la ficha y **no bloquea** el registro ni
  la agenda.

Tramos etarios, calculados en el servidor desde `birthDate` (nunca aceptados
del cliente): `UNDER_14` (informado y oído) y `AGE_14_17` (asentimiento
expreso). Una `birthDate` futura se rechaza.

### 2. Transición suave con fecha límite

Como ya hay un menor con consentimiento otorgado por él mismo (valor por
defecto histórico `grantedBy = PATIENT`), endurecer todo de golpe habría
impedido agendarle consultas. Reglas:

- Constante `MINOR_GUARDIAN_ENFORCEMENT_DATE = '2026-12-01'` (día calendario de
  America/Santiago) en `backend/src/modules/patients/patients.constants.ts`.
  Vive en código, sin variable de entorno, para no tocar `render.yaml`. La fecha
  coincide con la vigencia prevista de la Ley 21.719, pero es una decisión de
  producto independiente.
- **Escrituras estrictas desde el deploy.** Para un menor de 18 años, un `GRANT`
  de consentimiento solo se acepta con `grantedBy = GUARDIAN` y un `guardianId`
  de un representante del mismo paciente con `canConsent`. Un `REVOKE` se acepta
  siempre. Para un adulto, indicar un representante da 400.
- **Lecturas laxas hasta la fecha.** El guardrail de consultas
  (`assertTreatmentConsent`) acepta hasta el 2026-11-30 un consentimiento
  vigente otorgado por el paciente (legado). Desde el 2026-12-01 exige, para un
  menor, al menos un representante con `canConsent` y que todo consentimiento
  vigente haya sido otorgado por un representante.
- **Alerta `minorStatus`.** Toda respuesta de paciente incluye:
  - `NOT_MINOR`: mayor de 18 años.
  - `OK`: menor con representante con `canConsent` y sin consentimiento legado.
  - `MISSING_GUARDIAN`: menor sin ningún representante con `canConsent`.
  - `LEGACY_CONSENT`: menor con representante, pero con un consentimiento
    vigente otorgado por el propio paciente.

  Para los menores se agrega `guardianEnforcementDate`. La ficha muestra un aviso
  ámbar con el plazo para `MISSING_GUARDIAN` y `LEGACY_CONSENT`.
- Un menor existente se regulariza cargando al representante y registrando un
  nuevo consentimiento otorgado por él.

### 3. Comunicaciones y pagos van al representante

Para un menor, el link de pago y el aviso de pago atrasado se envían al
representante con `receivesCommunications` y email (se prefiere el que tiene
`isPayer`), redactados en torno al paciente y sin datos clínicos. El email del
propio menor nunca se usa. Sin representante elegible el envío se omite
(`linkDelivery = SKIPPED_NO_EMAIL`) y queda un aviso en el log; no se cae al
email del terapeuta para los avisos.

Excepción técnica: Flow exige un email de pagador al crear la orden. Si ningún
representante tiene email, el pagador técnico ante Flow es el email del
terapeuta, con un `warn` en el log para que no sea silencioso. Solo un
representante a la vez puede ser `isPayer`: marcar uno limpia la marca en el
otro.

Los recordatorios de sesión no cambian: van al terapeuta. El aviso de
cancelación al representante queda para el bloque del informe de alta.

### 4. Agenda pública

La reserva pública admite "reservo en nombre de un menor". El servidor decide
por la fecha de nacimiento si corresponde enviar los datos del representante.
La identidad del paciente **no depende del email del tutor** (un tutor con dos
hijos colisionaría): se resuelve por el RUT del paciente dentro del terapeuta y
se verifica además el RUT de un representante ya registrado. Cualquier fallo de
identidad devuelve el mismo 409 uniforme del flujo adulto y los logs no llevan
RUT ni email. El representante de un paciente nuevo se crea con `isPayer`,
`receivesCommunications`, `canAccessReports` y `canConsent` en verdadero y
custodia `UNKNOWN`. No se captura consentimiento en el formulario público: el
terapeuta lo registra después. El formulario tiene una única nota de privacidad
general (paciente y representante); la revisión legal de su texto sigue en el
issue #376.

### 5. Informe de alta de un menor

Decidido para el bloque del informe de alta (aún sin implementar): en v1 se
entrega solo al representante con `canAccessReports`, no al adolescente de 14 a
17 años; a un tercero (por ejemplo un colegio) solo con autorización del
representante; a un tribunal solo con oficio, registrando el documento.

## Consecuencias

- La migración es aditiva y sin backfill. Los menores existentes quedan sin
  representante hasta que el terapeuta lo cargue.
- Mientras no llegue la fecha límite, un menor con consentimiento legado sigue
  pudiendo agendar; el riesgo se acota con la alerta visible y el plazo.
- Desde 2026-12-01 un menor sin regularizar no podrá recibir consultas nuevas
  (403 con mensaje explícito). Conviene regularizar antes.
- `hasConflict` y `custody` son datos informativos: el sistema los guarda y
  muestra la etiqueta "Conflicto entre representantes", pero **no bloquea**
  ninguna operación. Si los padres están separados, la decisión de a quién
  pedir la autorización queda en el terapeuta (política de producto, no norma
  verificada).
- `canAccessReports` se persiste y se muestra, pero hoy ninguna funcionalidad
  lo consulta; cobrará efecto con el informe de alta.
- Un representante que firmó un consentimiento no se puede eliminar (FK
  `RESTRICT`, 409), para no romper el ledger append-only.
- Condición de carrera menor aceptada: `canConsent` se valida fuera de la
  transacción de `recordConsent`.
- Cada alta, edición o baja de representante y cada asentimiento queda en la
  bitácora de auditoría.

## Seguimientos

- Restricciones en base de datos para la coherencia entre representante y
  paciente en `PatientConsent` y para el pagador único (hoy lo garantiza el
  servicio, con bloqueo `FOR UPDATE` sobre `Patient`). Requiere migración.
- Etiqueta de auditoría propia al borrar un representante: hoy el interceptor
  lo registra como `SOFT_DELETE` por su mapeo fijo.
- Revisión legal de la tensión entre la confidencialidad del adolescente y el
  derecho de los padres; incluye decidir si el terapeuta podrá ocultar notas al
  representante en el tramo 14 a 17.
- Confirmar el estado del Boletín 18.623-07 y leer el art. 13 de la Ley 20.584
  y el código de ética del Colegio de Psicólogos.
- Aviso de cancelación de consultas al representante (bloque del informe de
  alta) y alta de menores nuevos con consentimiento diferido hasta cargar al
  representante (ya implementado en la ficha).
- Deber de denuncia (Código Procesal Penal, art. 175) y secreto profesional: hoy
  solo hay una guía en el manual del terapeuta, sin funcionalidad, y requiere
  revisión legal.
