# Rotación y respaldo de las claves de cifrado

Procedimiento operativo del [ADR 0005](decisiones/0005-versionado-y-rotacion-de-claves-de-cifrado.md)
(issue #382). Cubre el respaldo de las claves, la rotación sin pérdida de datos
y qué hacer si una clave se pierde.

Estado (2026-10-27): el llavero versionado y el formato con AAD están
implementados y desplegados (T3a, T3b-U1 y T3b-U2). El código vive en
`backend/src/common/crypto/` (`keyring.ts`, `aes-gcm.ts`, `reencrypt.ts`,
`clinical-text.port.ts`) y el script en `backend/scripts/reencrypt-keys.ts`
(`npm run crypto:reencrypt`, definido en `backend/package.json`). La
migración de la sección 2.1 ya se aplicó en producción, según informó el
responsable del proyecto; este documento no guarda un registro de esa corrida.
El issue #382 está cerrado. El 2026-10-14 las cuatro claves de producción de
entonces se reemplazaron por completo al reiniciar la base de datos, así que el
procedimiento de rotación con datos existentes (sección 3) no se ha ejercitado
en producción. El #398 (retirar la clave id 0 del entorno) está
implementado en el código; ver "Retirar la clave id 0" más abajo. La quinta
clave (`CLINICAL_TEXT_ENCRYPTION_KEY`, dataset `clinical`) se agregó después
(ADR 0004). Su recifrado inicial con `--apply` se hizo el 2026-10-17 (ver
`docs/evaluacion-v1.md`, A3); los textos de `Notification` se cifran desde el
2026-10-22. Hoy se escribe `0x02` (binario), `enc:v3` (texto de MFA) y `enc:v4`
(textos clínicos, issue #486: el AAD incluye el paciente o usuario dueño y el
campo). Los textos clínicos anteriores siguen en `enc:v3` hasta correr
`npm run crypto:reencrypt -- --only clinical --apply`. Desplegar el backend con
`enc:v4` y escribir con él fija el piso de rollback: una versión anterior no lee
`enc:v4`.

## 1. Qué se cifra y qué pasa si falta la clave

| Dato | Variable | Dónde vive | Si se pierde la clave |
| --- | --- | --- | --- |
| Documentos de pacientes | `DOCUMENT_ENCRYPTION_KEY` | Objetos cifrados en el bucket B2 | **Irrecuperables.** Hay que volver a subirlos |
| Secreto MFA | `MFA_SECRET_ENCRYPTION_KEY` | `User.mfaSecret` | Nadie valida el MFA. `recoverMfa` borra el secreto para volver a enrolar |
| Tokens de Google | `GOOGLE_TOKEN_ENCRYPTION_KEY` | `GoogleCalendarConnection.refreshTokenEncrypted` | Hay que reconectar Google (no probado en producción) |
| Credenciales de pago | `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | `PaymentAccount.credentialEncrypted` | Hay que volver a cargar las credenciales de Flow (no probado en producción) |
| Textos clínicos | `CLINICAL_TEXT_ENCRYPTION_KEY` | `Consultation` (motivo, intervención, acuerdos), `TreatmentDischarge` (siete textos libres), los textos de `ConsultationHistory.snapshot` y `Notification` (título y cuerpo) | **Irrecuperables.** Las notas y los textos del informe quedan ilegibles, también en los respaldos. Solo sirve recuperar la clave desde el gestor de contraseñas |

Un documento solo se puede leer con **dos cosas juntas**: la clave de cifrado y
las credenciales del bucket (`B2_PATIENT_DOCUMENTS_ENDPOINT`, `_REGION`,
`_BUCKET`, `_KEY_ID`, `_APPLICATION_KEY`). Ambas van en el respaldo.

Alcance de cada dato, según el código:

- El dataset `documents` cubre todas las filas de `PatientDocument`, incluidos
  los informes de alta en PDF (`DISCHARGE_REPORT`) y las autorizaciones de
  entrega (`DELIVERY_AUTHORIZATION`), y también los documentos anulados.
- El dataset `clinical` cubre las columnas de texto libre de `Consultation` y
  `TreatmentDischarge`, los textos dentro de `ConsultationHistory.snapshot` y el
  título y cuerpo de `Notification`, incluidas las filas borradas o canceladas
  (ADR 0004, opción B).
- No se cifran con estas claves: los avatares y los archivos personales
  (`SharedFile`) guardados en B2, ni los datos de identificación y contacto de
  la base (nombre, RUT, teléfono; ADR 0004, alternativa C descartada).
- El respaldo de la base (`backup.yml`) se cifra aparte con
  `openssl enc -aes-256-cbc -pbkdf2` y el secreto `BACKUP_PASSPHRASE`, que no
  forma parte de este llavero.

## 2. Respaldo de las claves

1. Copiar los valores desde el panel de Render (Environment del servicio
   `umbral-backend`) a un gestor de contraseñas. Anotar para cada clave su
   nombre, su id (`0` para las actuales) y la fecha.
2. Guardar una segunda copia cifrada y sin conexión, separada del gestor.
3. Si se exporta el `.env` completo, guardarlo solo cifrado (adjunto del gestor
   o contenedor cifrado) y borrar la copia en claro apenas esté guardada.
4. Verificar cada clave: debe decodificar a 32 bytes.

   ```
   echo -n '<valor>' | base64 -d | wc -c
   ```

   El resultado tiene que ser `32`.
5. Repetir el respaldo cada vez que cambie alguna de estas variables, y siempre
   **antes** de cargar una clave nueva en Render.

Reglas:

- Nunca pegar los valores en un chat, un issue, un PR ni un commit.
- Los respaldos de la base (`backup.yml`) no incluyen las claves y no deben
  incluirlas. Una copia de la base sin su clave no se puede restaurar.
- Un `.env` con secretos de producción no debe quedar dentro del repositorio ni
  en una carpeta de descargas.

## 2.1 Migrar los datos existentes al formato con AAD (T3b)

Desde el release de T3b-U2 el backend **escribe** el formato `0x02` (binario) y
`enc:v3` (texto: secreto MFA y textos clínicos), que autentican la cabecera y la etiqueta del dataset (ADR 0005,
sección 1.1). Lo que ya existe sigue legible en su formato anterior (legacy,
`0x01`, `enc:v1`, `enc:v2`, o texto plano en el caso de `mfa` y `clinical`)
hasta que se re-cifre. Esta migración se hace **una
sola vez** y es independiente de rotar claves: se re-cifra con la clave activa
actual (id 0 si no se configuró otra).

Orden:

1. **Respaldo manual de la base.** Ejecutar `backup.yml` (workflow_dispatch)
   justo antes de desplegar. El respaldo de la base **no cubre los documentos**:
   viven en el bucket B2 de documentos, y el bucket debe tener activado "keep
   all versions" para poder recuperar el objeto original tras re-cifrarlo.
2. **Desplegar** el release de T3b-U2 en Render (a mano). Desde ese momento los
   datos nuevos se escriben con AAD. No hay variables nuevas obligatorias.
3. **Dry-run** (no escribe) desde `backend/`, con las variables de producción
   cargadas solo en esa sesión de terminal:

   ```
   npm run crypto:reencrypt
   ```

   El informe cuenta, por dataset y clave, qué está al día y qué hay que migrar.
   El script necesita `DATABASE_URL`, la variable de clave de cada dataset
   elegido (con su `_KEYRING` y `_ACTIVE_KEY_ID` si existen) y, para
   `documents`, las variables `B2_PATIENT_DOCUMENTS_*`. Carga además el `.env`
   de `backend/` si existe (`dotenv`, que no pisa las variables ya definidas en
   la sesión), por lo que conviene no dejar un `.env` de producción en esa
   carpeta.
4. **`--apply` por dataset, en este orden**, revisando el informe y que el
   código de salida sea `0` antes de seguir con el siguiente:

   ```
   npm run crypto:reencrypt -- --only google --apply
   npm run crypto:reencrypt -- --only payment --apply
   npm run crypto:reencrypt -- --only mfa --apply
   npm run crypto:reencrypt -- --only documents --apply
   npm run crypto:reencrypt -- --only clinical --apply
   ```

   `documents` va al final porque reescribe objetos en B2 (el más lento y el
   único sin respaldo en la base). Probar primero con `--limit 10` si se quiere
   (ver limitaciones).
5. **Repetir el dry-run.** Todo debe quedar "al día" y con 0 fallas.

Piso de rollback: una vez desplegado el release que **lee** `0x02`/`enc:v3`
(T3b-U1) no se vuelve a un build anterior; tras T3b-U2 tampoco se baja de
T3b-U1. Antes de T3b-U1 el piso es #395 (lectura por llavero). Un build sin
lectura de `0x02` no puede leer lo que escribió T3b-U2.

### Limitaciones conocidas del script

- **`--limit` no avanza.** Cuenta las filas leídas (migradas o ya al día), no las
  migradas, y siempre empieza por el principio: repetir el mismo `--limit`
  revisa normalmente las mismas primeras N filas. Sirve solo para la prueba acotada; la
  migración real se hace sin `--limit`.
- **Fila MFA en texto plano.** Un `User.mfaSecret` sin prefijo `enc:` (previo al
  cifrado en reposo) se cuenta en el grupo `plaintext` del informe y `--apply`
  lo cifra. Revisar que ese conteo sea el esperado antes de aplicar.
- **Texto clínico heredado.** En `clinical` cada columna de texto (y cada texto
  dentro de un snapshot) cuenta como una fila (`<tabla>/<id>/<campo>`), y un
  texto sin prefijo `enc:` se cuenta como `plaintext` y se cifra con `--apply`.
  Un texto en claro que empiece con `enc:v1:`, `enc:v2:`, `enc:v3:` o `enc:v4:`
  se interpreta como cifrado, no descifra y se informa como `decrypt-failed`
  (ADR 0004, issue #486: se decidió no tratarlo). Cada texto se recifra en
  `enc:v4` con el contexto de su fila (paciente o usuario y campo); una fila sin
  dueño se informa como falla. Las filas borradas o canceladas también se
  recorren.
- **Documentos con objeto faltante.** Si una fila de `PatientDocument` apunta a
  un objeto que ya no existe en B2, se informa como falla `missing-object`, no
  detiene la corrida y deja el código de salida en `1`. Mientras haya filas así,
  `--check-retire` tampoco da luz verde: hay que resolverlas (restaurar el
  objeto desde una versión anterior del bucket o dar de baja el documento) y
  repetir.

## 3. Rotación de una clave

### Antes de empezar

- [ ] El release que **escribe** en formato versionado (T3b-U2) está desplegado,
      la migración de la sección 2.1 terminó y se observó sin problemas. Sin el
      release, el código sigue generando datos con la clave vieja.
- [ ] Todas las claves y las credenciales de B2 están respaldadas (sección 2).
- [ ] Hay un respaldo reciente de la base.
- [ ] Se eligió una ventana de poco uso.

La rotación se hace **de a una clave por vez**. Los pasos son los mismos para
las cinco; cambian el nombre de la variable y el valor de `--only`:

| Variable | Valor de `--only` |
| --- | --- |
| `DOCUMENT_ENCRYPTION_KEY` | `documents` |
| `MFA_SECRET_ENCRYPTION_KEY` | `mfa` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `google` |
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | `payment` |
| `CLINICAL_TEXT_ENCRYPTION_KEY` | `clinical` |

Los ejemplos de abajo usan documentos.

### Paso a paso

1. **Generar y respaldar la clave nueva.**

   ```
   openssl rand -base64 32
   ```

   Guardarla en el gestor con su id (por ejemplo `1`) **antes** de cargarla en
   ningún otro lugar.

2. **Cargarla en el llavero.** En Render agregar
   `<NOMBRE>_KEYRING` con el formato `id:base64` (por ejemplo `1:<clave nueva>`)
   y desplegar el backend. Los datos existentes siguen legibles. La clave que
   cifra todavía es la id 0.

3. **Activarla.** En Render definir `<NOMBRE>_ACTIVE_KEY_ID=1` y desplegar. Los
   datos nuevos ya se cifran con la clave nueva.

4. **Medir.** Desde `backend/`, con las variables del entorno de producción
   cargadas **solo en esa sesión de terminal** (nunca en un archivo del
   repositorio):

   ```
   npm run crypto:reencrypt -- --only documents
   ```

   Sin `--apply` solo cuenta. El informe muestra, por dataset y por `keyId`,
   cuántas filas están al día, cuántas hay que re-cifrar y cuántas fallaron
   ("legacy(0)" es el formato anterior, aparte del id 0 versionado). Las
   variables `<NOMBRE>_KEYRING` y `<NOMBRE>_ACTIVE_KEY_ID` del script deben ser
   **iguales** a las de Render.

5. **Prueba acotada.**

   ```
   npm run crypto:reencrypt -- --only documents --limit 10 --apply
   ```

   Abrir en la aplicación uno de los documentos procesados y confirmar que se
   ve bien.

6. **Re-cifrar todo.**

   ```
   npm run crypto:reencrypt -- --only documents --apply
   ```

   Es reanudable: si se corta, se vuelve a correr y se omite lo que ya está al
   día. Una fila que falle se informa y no detiene la corrida; el código de
   salida es distinto de cero si alguna falló. Revisar y resolver las fallas
   antes de seguir.

7. **Verificar el retiro.**

   ```
   npm run crypto:reencrypt -- --check-retire DOCUMENT_ENCRYPTION_KEY=0
   ```

   Sale con error si queda algo cifrado con esa clave, **o** si alguna fila no
   se pudo leer. Solo con resultado limpio se puede retirar. Revisa siempre
   todas las filas: no acepta `--limit` ni `--apply`, porque un escaneo parcial
   podría dar una falsa señal de retiro seguro. Revisa solo el dataset de la
   variable indicada (si se pasa `--only` debe incluirlo).

8. **Retirar la clave vieja** (ids 1 o superiores: quitarla de
   `<NOMBRE>_KEYRING`; la id 0 se retira distinto, ver "Retirar la clave id 0"
   abajo) y desplegar. Probar antes de dar por
   cerrado: abrir un documento, un login con MFA, una sincronización de
   calendario o un pago de sandbox, según la clave rotada.

9. **Cerrar.** Actualizar el respaldo (la clave nueva ya estaba; marcar la vieja
   como retirada con fecha, sin borrarla del respaldo hasta pasado un tiempo
   prudente) y borrar las variables de la sesión de terminal.

### Si algo sale mal

- Antes del paso 8 no se perdió nada: la clave vieja sigue en el llavero y todo
  sigue legible. Detener la corrida, corregir y repetir.
- No retirar nunca una clave con filas pendientes ni con filas que fallaron.
- No volver a un build anterior al release que lee `0x02`/`enc:v3` (T3b-U1):
  no puede leer datos con esa cabecera. Tras escribir con T3b-U2 el piso es
  T3b-U1; antes de T3b-U1 el piso es #395 (lectura por llavero).

### Retirar la clave id 0

La clave id 0 (la variable `<NOMBRE>` original) es obligatoria al arrancar
mientras no se retire. Después de rotar sigue presente, solo para lectura. Se
puede quitar del entorno cuando se cumplen las tres condiciones a la vez:

1. `<NOMBRE>_KEYRING` define al menos una clave (ids 1 a 255).
2. `<NOMBRE>_ACTIVE_KEY_ID` apunta a una de ellas (no puede ser 0 ni quedar
   vacía).
3. `npm run crypto:reencrypt -- --check-retire <NOMBRE>=0` salió limpio **antes**
   de borrar la variable (paso 7). Después de retirarla ya no se puede
   comprobar, porque el script no podría leer lo que siga cifrado con la id 0.

Para retirarla, vaciar o borrar `<NOMBRE>` en Render y desplegar. Si falta
alguna condición, el arranque falla con un mensaje que nombra la variable
(`<NOMBRE> inválida` en producción, o `<NOMBRE>_ACTIVE_KEY_ID inválida`). Un
dato que siga cifrado con la id 0 deja de poder leerse: por eso la verificación
del paso 7 va primero. Probar igual que en el paso 8 (documento, login con MFA,
calendario o pago de sandbox) y conservar la clave en el respaldo.

## 4. Si una clave se pierde

1. No desplegar nada que cambie la variable. Revisar primero el respaldo (el
   gestor y la copia sin conexión).
2. Si la clave aparece, volver a cargarla tal cual en Render.
3. Si no aparece, aplicar la columna "Si se pierde la clave" de la sección 1,
   dato por dato. Generar una clave nueva **sin** reutilizar la id 0 perdida y
   respaldarla antes de cargarla.
4. Registrar el incidente en `docs/incident-log.md`.

## 5. Referencia rápida de comandos

Todos desde `backend/`:

| Comando | Qué hace |
| --- | --- |
| `npm run crypto:reencrypt` | Cuenta por dataset y por clave. No escribe |
| `npm run crypto:reencrypt -- --only mfa,google,payment,documents,clinical` | Limita los datasets |
| `npm run crypto:reencrypt -- --limit N` | Máximo de filas por dataset |
| `npm run crypto:reencrypt -- --apply` | Re-cifra con la clave activa (y migra al formato con AAD) |
| `npm run crypto:reencrypt -- --check-retire NOMBRE=id` | Verifica que una clave ya no se usa (no se combina con `--apply` ni `--limit`) |

Códigos de salida: `0` sin fallas, `1` si alguna fila falló, si con
`--check-retire` todavía hay filas que usan la clave o si hubo un error
inesperado, `2` si los argumentos son inválidos.
