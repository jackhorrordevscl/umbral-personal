# ADR 0006 - Informe de alta: firma simple y hash de integridad

- **Estado:** aceptada
- **Fecha:** 2026-10-13
- **Ramas:** `feat/informe-alta-t1-esquema` a `feat/informe-alta-t4c-entregas-ui` (tareas T1 a T5 del informe de alta; esta decisión se documenta en T6)

## Contexto

Hasta este cambio no existía alta, egreso ni cierre de tratamiento: el paciente
estaba activo o dado de baja (`deletedAt`). La epicrisis forma parte del
registro de la ficha clínica (Decreto 41, art. 6), pero ninguna norma
verificada obliga a un psicólogo independiente a emitirla ni fija su formato o
su contenido mínimo. Es un documento profesional con campos recomendados.

Tampoco hay obligación de usar firma electrónica avanzada. Un informe de este
tipo es un instrumento privado, y la Ley 19.799 admite la firma electrónica
simple para ese efecto, con el valor probatorio que corresponda en cada caso.

## Decisión

### 1. Firma simple más hash SHA-256 (decidido por el usuario el 2026-10-08)

El informe no lleva firma electrónica avanzada. Se emite con:

- **Firma simple:** un snapshot del firmante (nombre, RUT y registro
  profesional del terapeuta) congelado en el informe al emitir. El RUT es
  obligatorio para el informe generado por el sistema y el registro
  profesional es opcional.
- **Hash de integridad:** SHA-256 en hexadecimal, guardado en
  `TreatmentDischarge.contentHash` e impreso en el pie del PDF.

El hash prueba que el contenido no cambió desde la emisión. No prueba por sí
solo quién lo emitió: esa atribución descansa en la cuenta autenticada con MFA y
en la bitácora de auditoría (`DISCHARGE_ISSUE`).

### 2. Qué se hashea (informe generado por el sistema)

El hash se calcula sobre un JSON canónico, implementado en
`backend/src/modules/discharges/util/discharge-hash.util.ts`:

- Las claves se ordenan recursivamente, las fechas se serializan en ISO UTC y
  `undefined` se trata como `null`, de modo que el resultado no depende del
  orden de inserción ni del motor que serialice.
- Cubre el **contenido**: origen (`source`), motivo de cierre, motivo de
  deserción y su nota, destino de la derivación, fechas de ingreso y de alta,
  número de sesiones, motivo de consulta, diagnóstico opcional, resumen de
  evolución, estado al alta y recomendaciones.
- Cubre el **snapshot del firmante**.
- Cubre los **anclajes**: id del informe, del paciente, del terapeuta y del
  grupo; la versión; `issuedAt`; y `correctsId`, el enlace a la versión que esta
  corrige (`null` en la versión raíz).
- No cubre `status`, porque siempre es `ISSUED` al hashear. Tampoco cubre
  `documentId` ni `pdfSha256`.

Incluir `correctsId` y la versión hace que mover un informe a otra posición de
la cadena de correcciones, o reasignarlo a otro paciente o terapeuta, rompa la
verificación.

Además se guarda `pdfSha256`, el SHA-256 de los bytes del PDF generado. Es un
control separado: detecta que el objeto almacenado cambió o desapareció, sin
mezclarse con el hash del contenido.

### 3. Informe subido por el terapeuta (`source = UPLOADED`)

El terapeuta puede aportar su propio PDF en lugar de generarlo. En ese caso:

- `contentHash` y `pdfSha256` son el SHA-256 de los **bytes del archivo**. Es
  integridad en reposo, no una firma: el sistema no firma el archivo ni lo
  presenta como firmado por él.
- La verificación y la interfaz indican que es un "documento aportado por el
  terapeuta" (`providedByTherapist`).
- El archivo debe ser `application/pdf` y empezar con `%PDF-`.
- Los campos de contenido (motivo, evolución, recomendaciones) quedan vacíos,
  porque el contenido vive en el archivo.

### 4. Inmutabilidad y correcciones

Un informe emitido no se edita. Corregirlo crea una versión nueva (mismo patrón
que `Consultation`: `groupId` y `correctsId`). La versión anterior sigue
existiendo y verificable, se marca como reemplazada (`isCurrent = false`) y, si
es un PDF subido, su documento se anula con el mecanismo existente sin borrado
físico. Las acciones quedan en `AuditLog` como `DISCHARGE_ISSUE` y
`DISCHARGE_CORRECT`.

### 5. Verificación

`GET /discharges/:id/verify` recalcula el hash desde lo que hay en la base y lo
compara en tiempo constante con el guardado. Devuelve metadatos (`valid`,
`isCurrent`, `source`, estado del PDF), nunca el contenido. Para un informe
subido, `valid` compara el SHA-256 de los bytes descifrados con `contentHash`.
Un objeto ausente o alterado es inválido; un fallo de infraestructura no se
afirma ni se niega (`pdf.intact = null`).

### 6. Cierre del tratamiento

Emitir un informe es lo que cierra el tratamiento. En una sola transacción y con
bloqueo `FOR UPDATE` (orden de locks `User` y luego `Patient`):

- se fija `Patient.treatmentStatus` (`DISCHARGED`, `REFERRED` o `DROPPED_OUT`);
- se cancelan las consultas futuras del paciente, se liberan sus reservas
  públicas (`BookedSlot`) y se anulan los cobros impagos;
- se audita `TREATMENT_CLOSED` y una fila `CONSULTATION_CANCELLED` por consulta.

El alta **no** usa `Patient.deletedAt`: eso liberaría el RUT por el índice
parcial único y ocultaría al paciente. Un paciente cerrado no recibe reservas
públicas nuevas (409). Crear una consulta manual lo reabre, con confirmación
explícita del terapeuta; el informe anterior queda como histórico.

Si el motivo es deserción, el terapeuta elige un motivo principal de una lista
cerrada (`DropoutReason`). Es una síntesis propia a partir de la literatura de
deserción en psicoterapia, no un estándar validado ni hay una taxonomía
chilena para práctica privada. El texto libre lleva el aviso "no incluir datos
sensibles".

### 7. Entregas

Cada entrega del informe se registra (`DischargeDelivery`, solo se agregan):
destinatario (`PATIENT`, `GUARDIAN` o `THIRD_PARTY`), canal (en persona,
email, correo postal u otro), finalidad y fecha fijada por el servidor.

- A un paciente menor de 18 años no se le entrega directamente: se entrega al
  representante con `canAccessReports`. `PATIENT` se rechaza (400).
- A un tercero se exige una autorización ya cargada en la ficha
  (`DocumentType.DELIVERY_AUTHORIZATION`), que puede ser la autorización del
  paciente o del representante, o el oficio de un tribunal. El sistema no
  distingue si el documento es de uno u otro tipo.
- La auditoría `DISCHARGE_DELIVER` no incluye nombres ni finalidad.
- El sistema **no envía** el informe por correo. Se descarga y se registra la
  entrega.

### 8. Aviso de cancelación

Al cerrar el tratamiento, un correo avisa la cancelación de las consultas. Se
envía automáticamente si hay destinatario con email; si no lo hay o el envío
falla, se omite y no interrumpe el cierre. No incluye el motivo del cierre, para no exponer el estado clínico a
un correo posiblemente compartido. Para un adulto va a su email; para un menor,
solo a los representantes con `receivesCommunications` y email, nunca al email
del menor.

## Consecuencias

- El informe es verificable sin una dependencia externa de firma, pero tiene
  menos fuerza probatoria que uno con firma electrónica avanzada (Ley 19.799).
- Quien controle la base de datos y el código podría recalcular un hash
  coherente tras alterar el contenido. El control compensatorio son la
  auditoría, los backups cifrados y el `pdfSha256` del objeto almacenado; no es
  un sello de tiempo de un tercero.
- Cambiar los campos que cubre el hash invalida los informes ya emitidos. Si
  hace falta ampliar el contenido hasheado, debe versionarse el algoritmo
  (hoy no hay campo de versión del esquema del hash).

## Vacíos pendientes de revisión legal

Esta sección es un resumen de trabajo, no una validación legal.

- **Art. 13 de la Ley 20.584: entrega a terceros.** Se leyó el 2026-10-13, pero
  no desde el texto consolidado de BCN (no cargó): se reconstruyó con la
  transcripción de SUSESO (texto anterior a 2024) y el Diario Oficial de la Ley
  21.668 (2024-05-28), que reemplazó el inciso primero y agregó las letras f) y
  g). Conviene confirmarlo contra BCN. Lo que dice, en lo que importa aquí:
  - El prestador conserva la ficha al menos quince años y responde por su
    reserva; los terceros no relacionados con la atención no acceden a ella.
  - La información de la ficha "será entregada, total o parcialmente, a
    solicitud expresa" de: a) el titular, su representante legal o, si falleció,
    sus herederos; b) **un tercero autorizado por el titular mediante poder
    simple otorgado ante notario**; c) los tribunales de justicia, si se
    relaciona con las causas que conocen; d) fiscales del Ministerio Público y
    abogados, **previa autorización del juez**; e) el Instituto de Salud
    Pública y el Ministerio de Salud; f) la Superintendencia de Salud; g) el
    prestador individual y los profesionales que participan en la atención.
  - Quienes reciben la información deben resguardar la reserva de la identidad
    del titular y usarla solo para el fin con que la pidieron.
  - Consecuencia para esta funcionalidad: la ley no lista a un colegio ni a
    otro tercero particular como destinatario directo; la vía de la letra b)
    exige poder simple **ante notario**, y el sistema hoy acepta cualquier
    documento cargado como "Autorización de entrega de informe", sin exigir ni
    comprobar esa formalidad. Tampoco distingue entre la letra c) (tribunal) y
    la d) (fiscal o abogado, con autorización del juez). La entrega a un menor
    a través de su representante encaja en la letra a). Falta definir con
    asesoría legal si la autorización del paciente o de su representante
    basta, o si la app debe exigir y marcar la formalidad notarial.
  - La epicrisis forma parte de la ficha clínica (Decreto 41, art. 6), así que
    este régimen le aplica; no se revisó jurisprudencia ni dictámenes.
- **Código de ética del Colegio de Psicólogos.** Solo se encontró el Código de
  Ética Profesional de 1996, alojado en la Universidad de Chile; no se pudo
  confirmar que siga vigente ni que exista una versión posterior. Según esa
  copia, el secreto profesional dura indefinidamente (art. 5.1), no se puede
  revelar sin orden judicial expresa o autorización escrita del cliente o
  paciente mayor de edad, con discernimiento e informado (5.2), y su violación
  es una infracción ética grave (5.5); la confidencialidad exige resguardar los
  antecedentes de personas no autorizadas (6.1). Para un menor, el texto de 1996
  no resuelve quién autoriza. Falta confirmar la versión vigente.
- **Fuerza probatoria de la firma simple.** Falta confirmar con asesoría legal
  si un informe con firma simple y hash es suficiente para los usos previstos
  (colegios, tribunales, otros prestadores).
- **Informe de un menor de 14 a 17 años.** En v1 se entrega solo al
  representante con `canAccessReports`. Falta resolver la tensión entre la
  confidencialidad del adolescente y el derecho de los padres (ver ADR 0007).
- **Oficios de tribunales.** El sistema no valida que el documento cargado
  sea un oficio ni que la solicitud sea legítima.
- **Deber de denuncia (Código Procesal Penal, art. 175) y secreto
  profesional.** Solo hay una guía en el manual del terapeuta, sin
  funcionalidad.
- **Ley 21.719.** Vigencia prevista el 2026-12-01, con el Boletín 18.623-07
  (postergación) sin aprobación verificada al 2026-10-08. Hay que confirmar su
  estado.

## Seguimientos

- Cifrar a nivel de columna los textos del informe (diagnóstico, evolución,
  recomendaciones) junto con las notas clínicas, según el ADR 0004 y el ADR
  0005. Hoy el PDF se guarda cifrado en el almacenamiento, pero los textos del
  informe se guardan en columnas de la base sin cifrado a nivel de columna.
- Auditar la lectura de la lista de entregas (`GET /discharges/:id/deliveries`).
- Pre-chequeo de consentimiento y estado antes de subir un PDF propio: hoy un
  rechazo posterior puede dejar un objeto huérfano en el almacenamiento.
- Validar que el documento de un tribunal sea un oficio, si se resuelve el
  punto legal anterior.
- Umbral de "deserción presunta" configurable (fuera de v1).
