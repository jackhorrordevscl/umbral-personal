# Manual de uso — Umbral (para terapeutas)

> Este manual describe el comportamiento real de la aplicación, derivado directamente del código (validaciones, permisos y reglas de negocio), no de una revisión visual de las pantallas. Cada sección tiene un espacio `> 📝 Observaciones UX` para que anotes diferencias entre lo que describe este documento y lo que realmente experimentás usando la app.

---

## 1. Primer acceso

Al ingresar por primera vez con una cuenta nueva, pueden pasar hasta tres pasos antes de llegar al panel principal — no todos ocurren siempre, dependen del estado de tu cuenta:

1. **Cambio de contraseña obligatorio** (solo si tu cuenta se creó con una contraseña provisoria). No vas a poder hacer nada más hasta cambiarla.
2. **Activación de MFA obligatoria** (solo para roles `ADMIN` y `SUPERVISOR`). Se te muestra un código QR para escanear con una app autenticadora (Google Authenticator, Authy, etc.). Sin esto, esas cuentas no pueden operar — es una exigencia de seguridad para roles administrativos, no opcional.
3. **Verificación MFA** (en logins posteriores, si ya tenés MFA activado): se te pide el código de 6 dígitos de tu app autenticadora antes de entrar.

Los roles `THERAPIST` y `COORDINATOR` no están obligados a activar MFA, aunque pueden hacerlo desde Configuración si quieren.

> 📝 Observaciones UX:
>
>

---

## 2. Roles: qué puede ver y hacer cada uno

La app tiene cuatro roles. Esto determina qué pacientes ves, no es solo un tema de menú:

| Rol | Pacientes que ve | Notas |
|---|---|---|
| `THERAPIST` | Solo los propios (de los que es terapeuta a cargo) | Intentar acceder a la ficha de un paciente ajeno da error de acceso denegado (403), no un error genérico |
| `COORDINATOR` | Solo los propios, igual que `THERAPIST` | A pesar del nombre del rol, **no tiene visión ampliada** de pacientes — es una restricción deliberada del sistema |
| `SUPERVISOR` | Los propios siempre; el resto de la institución **solo si el paciente otorgó consentimiento de Red de Salud (`HEALTH_NETWORK`)** | Sin ese consentimiento, la ficha no aparece en su listado. Puede acceder de todos modos con **acceso excepcional auditado** (ver más abajo), dejando motivo obligatorio registrado |
| `ADMIN` | **Ninguno** — no tiene acceso a fichas clínicas bajo ningún escenario | Es un rol operativo/técnico sin base clínica para ver datos de pacientes; administra usuarios, no fichas |

La gestión de usuarios (crear, editar, desactivar) está reservada a `ADMIN`, `SUPERVISOR` y `COORDINATOR` — un `THERAPIST` no ve esa sección.

### Acceso excepcional de SUPERVISOR (T6.5)

Cuando un `SUPERVISOR` necesita ver una ficha sin relación de tratamiento directa y sin que el paciente haya otorgado consentimiento `HEALTH_NETWORK` (por ejemplo, ante una supervisión clínica, un incidente o una auditoría interna), tiene una vía separada de acceso excepcional. A diferencia del acceso normal:

- Exige un **motivo obligatorio**, que queda en la bitácora de auditoría (`overrideReason`) junto con la acción.
- Solo está disponible cuando el acceso normal realmente estaría bloqueado — si el `SUPERVISOR` ya tendría acceso por otra vía (dueño de la ficha, o consentimiento ya otorgado), el sistema rechaza el uso de esta vía para no restarle valor probatorio al registro de auditoría.
- No es un bypass silencioso: si la escritura de auditoría falla, el acceso se corta en vez de otorgarse igual.

> 📝 Observaciones UX: (¿el menú realmente oculta las opciones que no te corresponden, o solo bloquea al hacer clic?)
>
>

---

## 3. Pacientes

### Crear una ficha

Campos obligatorios: **nombre completo, RUT, fecha de nacimiento**. Todo lo demás es opcional al crear (ocupación, dirección, teléfono, email, contacto de emergencia, psiquiatra/médico tratante) — se puede completar después.

El RUT se normaliza automáticamente en el servidor (saca puntos, pasa a mayúsculas) — no hace falta que lo tipees con un formato exacto, pero sí tiene que ser un RUT válido.

### Editar una ficha

Cada edición queda registrada con **motivo del cambio** y un diff (qué campo cambió, de qué valor a qué valor) — esto alimenta el historial de la ficha, visible aparte. Si guardás sin cambiar nada, el sistema lo detecta y no genera un registro de historial vacío.

### Consentimientos (Ley 21.719)

Hay tres finalidades de consentimiento, independientes entre sí:
- **Tratamiento**: consentir el tratamiento clínico en sí.
- **Telemedicina**: consentir la modalidad de atención remota.
- **Red de salud** (finalidad de interconexión y comunicación): autoriza compartir, derivar o comunicar la ficha del paciente con terceros del ecosistema sanitario — otros profesionales de la institución, laboratorios, centros de derivación, aseguradoras. Bajo la Ley 21.719 esto es una transferencia de datos que no se puede asumir por defecto: sin este consentimiento explícito, la ficha **no debería** compartirse fuera del círculo terapeuta-paciente directo, aunque sea a otro profesional de la misma institución.

Cada una se otorga o revoca por separado. Al registrar cualquier consentimiento, **la evidencia es obligatoria** (mínimo 10 caracteres — ej. "firma en papel escaneada, sesión del 12/03") y queda con fecha y quién lo registró.

Importante: revocar un consentimiento **no borra el evento anterior**. El historial completo (otorgamientos y revocaciones) queda visible siempre — es un registro tipo bitácora, no un simple check on/off.

El consentimiento `HEALTH_NETWORK` **condiciona el acceso efectivo, no es solo informativo** (T6.4/T6.5, issues #51/#52): el terapeuta tratante (`therapistId`) siempre conserva acceso a su propia ficha por la relación de tratamiento directa (Ley 20.584), pero un `SUPERVISOR` sin esa relación pierde el acceso normal a la ficha en cuanto el consentimiento de Red de Salud se revoca — la única vía que le queda es el acceso excepcional auditado descrito más arriba, que deja motivo obligatorio en la bitácora. `ADMIN` no tiene acceso a fichas clínicas bajo ningún escenario, con o sin consentimiento.

### Eliminar una ficha

Es un "soft delete": la ficha desaparece de los listados pero no se borra de la base de datos (obligación legal de custodia por 15 años, Ley 20.584). No hay forma de eliminar definitivamente una ficha desde la app.

> 📝 Observaciones UX: (¿el formulario deja claro cuáles campos son obligatorios antes de intentar guardar? ¿el mensaje de "motivo de cambio" es claro al editar?)
>
>

---

## 4. Consultas

### Crear una consulta

Campos obligatorios: **paciente, fecha de sesión, motivo de consulta, intervención**. Opcionales: acuerdos, próxima sesión, tipo de sesión (presencial/telemedicina).

### Corregir una consulta

Esto es lo más importante de entender de este módulo: **corregir NO sobrescribe la consulta original**. El sistema crea una versión nueva y marca la anterior como "corregida" — la versión vieja se sigue pudiendo consultar en el historial, con quién la corrigió y cuándo. Esto existe porque un registro clínico legalmente no puede alterarse de forma que se pierda el rastro del dato original (inalterabilidad de registros).

En la práctica: si te equivocaste en algo, corregilo con confianza — no se "pierde" nada, solo se agrega una versión nueva encima.

> 📝 Observaciones UX: (¿es intuitivo distinguir "esta es la versión vigente" vs. "esta es una versión corregida" al mirar el historial?)
>
>

---

## 5. Documentos de pacientes

Cada ficha de paciente permite subir documentos asociados (ej. informes, exámenes). Reglas:
- Solo se aceptan **PDF e imágenes** — cualquier otro tipo de archivo se rechaza.
- **10 MB máximo** por archivo.
- Solo podés subir documentos a pacientes a los que tenés acceso (misma regla de ownership que el resto de la ficha).

Esto es distinto de "Archivos compartidos" (ver sección 6) — los documentos de paciente están ligados a una ficha específica, no son de uso general.

> 📝 Observaciones UX:
>
>

---

## 6. Archivos compartidos

Es una biblioteca institucional, no ligada a un paciente en particular — pensada para libros, plantillas, protocolos, formularios, material general. Categorías: Libros, Plantillas, Imágenes, Formularios, Protocolos, General.

> 📝 Observaciones UX: (¿quedó claro para vos la diferencia entre esto y "Documentos" dentro de una ficha de paciente?)
>
>

---

## 7. Reportes en PDF

Desde la ficha de un paciente se puede exportar un PDF con la ficha clínica completa, incluyendo el historial de consultas (con sus correcciones) — no es solo un snapshot del estado actual. El PDF incluye una referencia a la Ley 20.584 y la obligación de custodia de 15 años.

> 📝 Observaciones UX:
>
>

---

## 8. Sesión y seguridad

- **Cierre de sesión por inactividad**: después de 8 minutos sin actividad (mover el mouse, tipear, hacer clic, scrollear), aparece un aviso con una cuenta regresiva de 2 minutos. Si no hacés nada en ese lapso, la sesión se cierra sola. "Continuar sesión" en ese aviso reinicia el contador.
- **Límite de intentos de login**: después de varios intentos fallidos seguidos, el sistema bloquea temporalmente nuevos intentos (rate limiting) — es intencional, no un error, y se libera solo pasado un tiempo.
- **Bitácora de auditoría**: toda acción relevante (login, creación/edición de fichas, descarga de documentos, etc.) queda registrada de forma inmutable — no visible para roles no-administrativos, pero existe y no se puede alterar ni borrar.

> 📝 Observaciones UX: (¿el aviso de sesión por expirar se nota a tiempo, o es fácil perderlo de vista y que la sesión se cierre sin querer?)
>
>

---

## Notas generales de UX (espacio libre)

>
>
>
