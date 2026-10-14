# ADR 0005 - Versionado y rotación de claves de cifrado

- **Estado:** implementada (nota del 2026-10-13: el llavero, el formato `0x02`/`enc:v3` con AAD y el script `backend/scripts/reencrypt-keys.ts` están en el código; el procedimiento operativo está en `docs/rotacion-y-respaldo-de-claves.md`. El issue #382 sigue abierto en GitHub y #398, retirar la clave id 0, está pendiente)
- **Fecha:** 2026-10-07
- **Issue:** #382

## Contexto

La aplicación cifra cuatro tipos de dato con AES-256-GCM, cada uno con su
propia clave (ver `backend/src/common/crypto/aes-gcm.ts`):

| Dato | Variable de entorno | Almacenamiento |
| --- | --- | --- |
| Documentos de pacientes | `DOCUMENT_ENCRYPTION_KEY` | Objeto cifrado en el bucket B2 (`B2_PATIENT_DOCUMENTS_*`); la base guarda solo su nombre (`storagePath`) |
| Tokens de Google | `GOOGLE_TOKEN_ENCRYPTION_KEY` | `refreshTokenEncrypted` (bytes) |
| Credenciales de pago | `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | `credentialEncrypted` (bytes) |
| Secreto MFA | `MFA_SECRET_ENCRYPTION_KEY` | `User.mfaSecret` (texto `enc:v1:<base64>`) |

Problemas actuales:

- El payload es `[IV12][tag16][ciphertext]`, sin versión ni identificador de
  clave. Solo el secreto MFA lleva un prefijo (`enc:v1:`), y versiona el
  formato, no la clave.
- Nada autentica a qué dato pertenece un payload: un valor cifrado de un
  dataset, copiado a otro que use la misma clave, se descifra sin error.
- `credentialVersion` en pagos versiona la forma de la credencial, no la clave.
- Cambiar cualquiera de las cuatro variables deja ilegible todo lo cifrado con
  la anterior. En la práctica no hay rotación.
- No existe un procedimiento documentado de respaldo de las claves. Perder
  `DOCUMENT_ENCRYPTION_KEY` deja los documentos irrecuperables.
- El ADR 0004 condiciona el cifrado de las notas clínicas a resolver esto.

## Decisión

### 1. Formato versionado

Los datos nuevos se escriben con una cabecera que identifica el formato y la
clave:

```
[0x55 0x4B][formato = 0x02][keyId: 1 byte][IV12][tag16][ciphertext]
```

El secreto MFA, que es texto, usa `enc:v3:<keyId>:<base64(IV|tag|ct)>`.

Formatos que el código sabe leer:

| Dato | Formato | AAD | Se escribe |
| --- | --- | --- | --- |
| Binario | legacy `[IV12][tag16][ct]` (clave id 0) | no | no |
| Binario | `0x01` (T3a, #395) | no | no |
| Binario | `0x02` | sí | **sí** |
| MFA | `enc:v1:<b64>` (clave id 0) | no | no |
| MFA | `enc:v2:<keyId>:<b64>` | no | no |
| MFA | `enc:v3:<keyId>:<b64>` | sí | **sí** |

El formato `0x01` y `enc:v2` quedan **solo de lectura**: T3a nunca los escribió
en producción; se conservan solo para leerlos si aparecen, y el script de
re-cifrado los trata como "a migrar" a `0x02`/`enc:v3`.

### 1.1 Datos adicionales autenticados (AAD)

Desde el formato `0x02` / `enc:v3` el cifrado AES-GCM autentica, además del
contenido, datos que no viajan cifrados:

- Binario: `[0x55 0x4B][0x02][keyId]` seguido de la etiqueta UTF-8 del dataset.
- MFA: la cadena UTF-8 `enc:v3:<keyId>:` seguida de la etiqueta del dataset.

Las etiquetas son fijas y viven en un mapa explícito en `keyring.ts` (no se
derivan del nombre de la variable, para que renombrarla no invalide datos):

| Variable | Etiqueta |
| --- | --- |
| `DOCUMENT_ENCRYPTION_KEY` | `documents` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `google` |
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | `payment` |
| `MFA_SECRET_ENCRYPTION_KEY` | `mfa` |

Efecto: una cabecera alterada (por ejemplo cambiar el `keyId`) o un payload
movido a otro dataset falla la autenticación de GCM aunque ambos usen la misma
clave. No se liga el id de la fila: complicaría los re-cifrados y el riesgo que
cubre (intercambiar filas del mismo dataset) exige acceso de escritura a la base,
que ya permite cosas peores. El tag de GCM se fija en 16 bytes al descifrar
(`authTagLength`), para que Node no acepte un tag truncado.

### 2. Lectura de datos existentes

Los datos sin cabecera se tratan como clave **id 0**, que es la variable de
entorno actual sin cambios. Como el IV legacy es aleatorio, la cabecera por sí
sola no prueba que el dato sea nuevo. La lectura sigue este orden:

1. Si empieza con la cabecera (`0x01` o `0x02`) y el `keyId` existe en el
   llavero, intenta descifrar con esa clave (con AAD si es `0x02`).
2. Si la autenticación de GCM falla, o no hay cabecera, reintenta como legacy
   con la clave id 0.
3. Si ambos fallan, el comportamiento es el actual de cada servicio (por
   ejemplo, `MfaService.revealSecret` devuelve `null`).

GCM autentica el payload, así que un intento equivocado falla y nunca devuelve
datos erróneos. Los valores `enc:v1:` de MFA se leen como id 0. Un `0x02` alterado o de otro
dataset falla también el reintento legacy, así que no se degrada con éxito.

### 3. Llavero

- `<NOMBRE>` sigue siendo la clave id 0. Desplegar este cambio no exige
  cargar ninguna variable nueva.
- `<NOMBRE>_KEYRING` agrega claves con el formato `id:base64,id:base64`. Los
  ids son enteros de 1 a 255.
- `<NOMBRE>_ACTIVE_KEY_ID` indica con qué clave se cifra. Si no está definida,
  se usa la id 0.
- Todas las claves se validan al arrancar con las mismas reglas actuales
  (32 bytes en base64, no ser un valor de ejemplo del README).

### 4. Procedimiento de rotación

1. Generar una clave nueva (`openssl rand -base64 32`) y respaldarla (punto 5)
   **antes** de cargarla.
2. Agregarla a `<NOMBRE>_KEYRING` con un id nuevo y desplegar. Los datos
   existentes siguen legibles.
3. Cambiar `<NOMBRE>_ACTIVE_KEY_ID` al id nuevo y desplegar. Los datos nuevos ya
   se cifran con ella.
4. Ejecutar el script de re-cifrado. Primero en modo de verificación, que
   cuenta los registros por `keyId` sin modificar nada.
5. Cuando el conteo de la clave vieja sea cero, retirarla del llavero. El
   script se niega a confirmar el retiro si quedan registros con esa clave.

La clave vieja nunca se retira antes del paso 5. Retirarla antes es la única
forma de perder datos en este procedimiento.

### 5. Respaldo de las claves

- Cada clave se guarda fuera de Render, en un gestor de contraseñas del
  responsable técnico, con su id y la fecha de creación.
- Debe existir al menos una copia adicional offline, separada del gestor.
- El respaldo de la base (`backup.yml`) no incluye las claves y no debe
  incluirlas. Una copia de seguridad sin su clave no se puede restaurar.
- El runbook de rotación y respaldo se publica junto con el script.

## Alternativas descartadas

- **KMS o gestor de secretos externo:** resuelve rotación y respaldo, pero
  agrega un servicio y un costo que no se justifican para v1.
- **Guardar el `keyId` en una columna aparte:** obliga a migrar el esquema por
  cada dato cifrado y no cubre los archivos de documentos. La cabecera en el
  propio payload funciona igual para bytes, texto y archivos.
- **Cambiar la clave de golpe con un script único:** requiere una ventana en la
  que nada es legible y no tiene vuelta atrás si falla a la mitad.

## Consecuencias

- Desplegar el formato versionado es compatible hacia atrás, pero no hacia
  adelante: una versión anterior del backend no puede leer datos escritos con
  cabecera. Por eso la escritura versionada se activa en un PR posterior a la
  lectura, y se despliega en dos pasos.
- **Piso de rollback.** El build que lee `0x02`/`enc:v3` (U1 de T3b) es el piso:
  una vez desplegado no se vuelve a un build anterior. Lo mismo vale para el
  build que escribe (U2): no se baja de U1, que sí lo lee. Antes de U1 no se
  baja de #395 (lectura por llavero, T3a); un build anterior a #395 no lee
  ninguna cabecera. Volver a un build sin lectura de `0x02` tras haber
  escrito datos deja esos datos ilegibles.
- Los documentos viven en el bucket B2, no en la base: el respaldo de la base
  no los cubre. Antes de re-cifrarlos el bucket debe conservar todas las
  versiones de cada objeto ("keep all versions"), para poder volver al
  original si algo sale mal.
- Se agrega código y pruebas al módulo de cifrado compartido, y cada servicio
  pasa a depender del llavero en lugar de una sola clave.
- El cifrado de las notas clínicas (ADR 0004, paso 2) usará este formato y una
  clave nueva desde el primer día.
- Los datos que ya estén ilegibles por una clave perdida o cambiada antes de
  este ADR no se recuperan con este mecanismo.
- Limitación conocida: la clave id 0 (la variable `<NOMBRE>` original) es
  obligatoria al arrancar, así que hoy no se puede retirar del entorno aunque
  ya no cifre nada. Las claves con id 1 o superior sí. Si se quiere retirar la
  id 0 hay que hacer opcional esa variable cuando el llavero tenga otra clave
  activa, en un cambio aparte.

## Plan de implementación

1. Este ADR.
2. Llavero y formato versionado en `aes-gcm.ts`, con lectura de datos legacy.
3. Migración de los cuatro servicios y de la validación de entorno.
4. Script de re-cifrado y runbook de rotación y respaldo.
5. T3b-U1: formato `0x02`/`enc:v3` con AAD, solo lectura; el script distingue
   versión de formato.
6. T3b-U2: los cuatro servicios escriben `0x02`/`enc:v3`; validación de
   `<NOMBRE>_KEYRING` y `<NOMBRE>_ACTIVE_KEY_ID` en `env.validation.ts`.
