# Rotación y respaldo de las claves de cifrado

Procedimiento operativo del [ADR 0005](decisiones/0005-versionado-y-rotacion-de-claves-de-cifrado.md)
(issue #382). Cubre el respaldo de las claves, la rotación sin pérdida de datos
y qué hacer si una clave se pierde.

## 1. Qué se cifra y qué pasa si falta la clave

| Dato | Variable | Dónde vive | Si se pierde la clave |
| --- | --- | --- | --- |
| Documentos de pacientes | `DOCUMENT_ENCRYPTION_KEY` | Objetos cifrados en el bucket B2 | **Irrecuperables.** Hay que volver a subirlos |
| Secreto MFA | `MFA_SECRET_ENCRYPTION_KEY` | `User.mfaSecret` | Nadie valida el MFA. `recoverMfa` borra el secreto para volver a enrolar |
| Tokens de Google | `GOOGLE_TOKEN_ENCRYPTION_KEY` | `GoogleCalendarConnection.refreshTokenEncrypted` | Hay que reconectar Google (no probado en producción) |
| Credenciales de pago | `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | `PaymentAccount.credentialEncrypted` | Hay que volver a cargar las credenciales de Flow (no probado en producción) |

Un documento solo se puede leer con **dos cosas juntas**: la clave de cifrado y
las credenciales del bucket (`B2_PATIENT_DOCUMENTS_ENDPOINT`, `_REGION`,
`_BUCKET`, `_KEY_ID`, `_APPLICATION_KEY`). Ambas van en el respaldo.

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

## 3. Rotación de una clave

### Antes de empezar

- [ ] El release que **escribe** en formato versionado está desplegado y se
      observó sin problemas. Sin él, el script reescribe pero el código sigue
      generando datos con la clave vieja.
- [ ] Todas las claves y las credenciales de B2 están respaldadas (sección 2).
- [ ] Hay un respaldo reciente de la base.
- [ ] Se eligió una ventana de poco uso.

La rotación se hace **de a una clave por vez**. Los pasos son los mismos para
las cuatro; cambian el nombre de la variable y el valor de `--only`:

| Variable | Valor de `--only` |
| --- | --- |
| `DOCUMENT_ENCRYPTION_KEY` | `documents` |
| `MFA_SECRET_ENCRYPTION_KEY` | `mfa` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `google` |
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | `payment` |

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
   todas las filas: no acepta `--limit`, porque un escaneo parcial podría dar
   una falsa señal de retiro seguro.

8. **Retirar la clave vieja** (solo ids 1 o superiores, ver la limitación de
   abajo): quitarla de `<NOMBRE>_KEYRING` y desplegar. Probar antes de dar por
   cerrado: abrir un documento, un login con MFA, una sincronización de
   calendario o un pago de sandbox, según la clave rotada.

9. **Cerrar.** Actualizar el respaldo (la clave nueva ya estaba; marcar la vieja
   como retirada con fecha, sin borrarla del respaldo hasta pasado un tiempo
   prudente) y borrar las variables de la sesión de terminal.

### Si algo sale mal

- Antes del paso 8 no se perdió nada: la clave vieja sigue en el llavero y todo
  sigue legible. Detener la corrida, corregir y repetir.
- No retirar nunca una clave con filas pendientes ni con filas que fallaron.
- No volver a un build anterior al release de lectura por llavero: no puede
  leer datos con cabecera de versión.

### Limitación conocida: la clave id 0

La clave id 0 (la variable `<NOMBRE>` original) es obligatoria al arrancar. Hoy
no se puede quitar del entorno aunque ya no cifre nada. Después de rotar sigue
presente, solo para lectura. Retirarla exige un cambio de código aparte (ver el
ADR 0005, Consecuencias). El comando `--check-retire <NOMBRE>=0` sirve igual
para comprobar que ya no se usa.

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
| `npm run crypto:reencrypt -- --only mfa,google,payment,documents` | Limita los datasets |
| `npm run crypto:reencrypt -- --limit N` | Máximo de filas por dataset |
| `npm run crypto:reencrypt -- --apply` | Re-cifra con la clave activa |
| `npm run crypto:reencrypt -- --check-retire NOMBRE=id` | Verifica que una clave ya no se usa (no se combina con `--apply` ni `--limit`) |

Códigos de salida: `0` sin fallas, `1` si alguna fila falló o hubo un error
inesperado, `2` si los argumentos son inválidos.
