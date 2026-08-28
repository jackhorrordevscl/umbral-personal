# Manual de uso — Umbral (para terapeutas)

> Este manual describe el comportamiento real de la aplicación, derivado directamente del código (validaciones, permisos y reglas de negocio), no de una revisión visual de las pantallas. Cada sección tiene un espacio `> 📝 Observaciones UX` para que anotes diferencias entre lo que describe este documento y lo que realmente experimentas usando la app.

Umbral es una app **individual**: no hay roles, jerarquías ni panel de
administración. La cuenta que creas es tuya y solo tuya — tú ves y
administras únicamente tus propios pacientes, nadie más tiene acceso a
tu información ni tú a la de otro profesional que también use la app.

---

## 1. Crear tu cuenta y primer acceso

No hay un administrador que te dé de alta: te registras tú mismo/a.

1. **Registro** — desde la pantalla de login, "Regístrate". Pide nombre,
   email y contraseña (mínimo 8 caracteres). La cuenta queda creada pero
   **no puedes loguear todavía**.
2. **Verificación de email** — te llega un correo con un enlace. Haz clic
   ahí para activar la cuenta. Sin esto, un intento de login rechaza con
   "Debes verificar tu email antes de iniciar sesión", aunque la
   contraseña sea correcta.
3. **Activación de MFA obligatoria** — en tu primer login exitoso (con
   email ya verificado), la app te muestra un código QR para escanear con
   una app autenticadora (Google Authenticator, Authy, o similar). Esto
   **no es opcional**: toda cuenta lo necesita, no depende de ningún rol —
   es la única puerta de entrada a fichas clínicas, así que se exige desde
   el primer momento.
4. **Guarda tus 10 códigos de recuperación** — apenas confirmas el código
   de tu app autenticadora, la pantalla te muestra 10 códigos de un solo
   uso. **Se muestran una única vez.** Guárdalos en un gestor de
   contraseñas o impresos en un lugar seguro antes de continuar — son tu
   único camino para recuperar el acceso si alguna vez pierdes el celular
   con la app autenticadora (ver sección 2).
5. **Logins posteriores** — con MFA ya activo, cada login te pide primero
   email + contraseña, y después el código de 6 dígitos de tu app.

> 📝 Observaciones UX:
>
>

---

## 2. Si pierdes la contraseña o el dispositivo MFA

No hace falta pedirle a nadie que te desbloquee la cuenta a mano — hay dos
caminos self-service, según qué perdiste:

### Olvidaste la contraseña

Desde el login, "¿Olvidaste tu contraseña?" → ingresas tu email → te llega
un enlace (válido 30 minutos) para elegir una contraseña nueva. Por
seguridad, la respuesta es la misma exista o no una cuenta con ese email
("si el email está registrado, vas a recibir un enlace..."), así que no te
alarmes si no distingue el caso. Este camino **no** te salta el MFA: si tu
cuenta lo tiene activo, lo va a seguir pidiendo en el próximo login.

### Perdiste el dispositivo con tu app autenticadora

Desde el login, en la pantalla donde te pide el código de 6 dígitos, hay un
link "¿Perdiste el dispositivo MFA?". Ahí ingresas tu email, tu contraseña
**y uno de los 10 códigos de recuperación** que guardaste al activar MFA
(paso 4 de la sección anterior). Si es válido, MFA queda desactivado y
puedes volver a loguear con email + contraseña; en ese login vas a tener
que enrolar MFA de nuevo (nuevo QR, nueva tanda de 10 códigos).

**Si perdiste la contraseña Y los 10 códigos de recuperación al mismo
tiempo**, no queda ningún camino self-service — necesitas pedir una
intervención manual (ver `README.md`, sección "Recuperación de cuenta",
para quien administre el servidor). Por eso conviene guardar los códigos
de recuperación apenas se generan, no "para después".

> 📝 Observaciones UX: (¿el link de "olvidaste tu contraseña" es fácil de encontrar? ¿el mensaje genérico del email confunde?)
>
>

---

## 3. Pacientes

### Crear una ficha

Campos obligatorios: **nombre completo, RUT, fecha de nacimiento**. Todo lo demás es opcional al crear (ocupación, dirección, teléfono, email, contacto de emergencia, psiquiatra/médico tratante) — se puede completar después.

El RUT se normaliza automáticamente en el servidor (saca puntos, pasa a mayúsculas) — no hace falta que lo escribas con un formato exacto, pero sí tiene que ser un RUT válido.

### Editar una ficha

Cada edición queda registrada con **motivo del cambio** y un diff (qué campo cambió, de qué valor a qué valor) — esto alimenta el historial de la ficha, visible aparte. Si guardas sin cambiar nada, el sistema lo detecta y no genera un registro de historial vacío.

### Consentimientos (Ley 21.719)

Hay dos finalidades de consentimiento, independientes entre sí:
- **Tratamiento**: consentir el tratamiento clínico en sí.
- **Telemedicina**: consentir la modalidad de atención remota.

Cada una se otorga o revoca por separado. Al registrar cualquier consentimiento, **la evidencia es obligatoria** (mínimo 10 caracteres — ej. "firma en papel escaneada, sesión del 12/03") y queda con fecha y quién lo registró.

Importante: revocar un consentimiento **no borra el evento anterior**. El historial completo (otorgamientos y revocaciones) queda visible siempre — es un registro tipo bitácora, no un simple check on/off.

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

En la práctica: si te equivocaste en algo, corrígelo con confianza — no se "pierde" nada, solo se agrega una versión nueva encima.

> 📝 Observaciones UX: (¿es intuitivo distinguir "esta es la versión vigente" vs. "esta es una versión corregida" al mirar el historial?)
>
>

---

## 5. Documentos de pacientes

Desde la ficha del paciente, en la sección "Documentos legales", subes archivos ligados a esa persona en dos pasos:

1. Elige el tipo de documento en el desplegable: **Consentimiento informado**, **Acuerdo de telemedicina** u **Otro**.
2. Haz clic en "Subir" y selecciona el archivo desde tu computadora.

Reglas:
- Solo se aceptan **PDF e imágenes** — cualquier otro tipo de archivo se rechaza antes de subir.
- **10 MB máximo** por archivo.
- Solo puedes subir documentos a pacientes propios (mismos que ves en tu listado).

Cada documento subido queda en la lista con su nombre y tipo, y se puede volver a descargar en cualquier momento con el ícono de descarga.

Esto es distinto de "Archivos personales" (ver sección 6): los documentos de paciente quedan ligados a una ficha específica (el consentimiento firmado de esa persona, por ejemplo), mientras que "Archivos personales" es tu biblioteca general, sin paciente asociado.

> 📝 Observaciones UX:
>
>

---

## 6. Archivos personales (Repositorio)

Es tu biblioteca privada, no ligada a un paciente en particular — pensada para libros, plantillas, protocolos, formularios, material general de tu propia práctica. Categorías: Libros, Plantillas, Imágenes, Formularios, Protocolos, General.

Es **privada por cuenta**: nada de lo que subes ahí se comparte con otros profesionales que también usen Umbral, aunque el nombre "Repositorio" pueda sonar a algo institucional.

> 📝 Observaciones UX: (¿quedó claro para ti la diferencia entre esto y "Documentos" dentro de una ficha de paciente?)
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

- **Cierre de sesión por inactividad**: después de 8 minutos sin actividad (mover el mouse, tipear, hacer clic, scrollear), aparece un aviso con una cuenta regresiva de 2 minutos. Si no haces nada en ese lapso, la sesión se cierra sola. "Continuar sesión" en ese aviso reinicia el contador.
- **Límite de intentos de login**: después de varios intentos fallidos seguidos, el sistema bloquea temporalmente nuevos intentos (rate limiting) — es intencional, no un error, y se libera solo pasado un tiempo. Aplica también a los intentos de código MFA, de restablecimiento de contraseña y de recuperación con código MFA.
- **Bitácora de auditoría**: toda acción relevante (login, creación/edición de fichas, descarga de documentos, etc.) queda registrada de forma inmutable en el servidor — no hay una pantalla para verla dentro de la app (no hay panel administrativo), pero existe y no se puede alterar ni borrar.

> 📝 Observaciones UX: (¿el aviso de sesión por expirar se nota a tiempo, o es fácil perderlo de vista y que la sesión se cierre sin querer?)
>
>

---

## 9. Ajustes de tu cuenta

Desde "Ajustes" (además de la sección de MFA descrita en el punto 1) puedes
editar tus propios datos:

- **Nombre**: se actualiza al instante, sin pedir contraseña.
- **Email**: pide tu contraseña actual. El cambio **no se aplica de
  inmediato** — queda pendiente hasta que confirmes desde un enlace enviado
  a la casilla nueva (válido 24 horas). Tu email actual sigue funcionando
  para loguear mientras tanto, y además te llega un aviso a esa casilla
  antigua avisando que se solicitó el cambio (por si no fuiste tú).
- **Contraseña**: pide tu contraseña actual y la nueva (mínimo 8
  caracteres). Al guardar, **se cierra tu sesión de inmediato** — y no solo
  en este dispositivo: cualquier otra sesión abierta en otro navegador o
  celular también queda invalidada. Vuelve a loguear con la contraseña
  nueva.

> 📝 Observaciones UX:
>
>

---

## 10. Notificaciones y recordatorios de sesión

El ícono de campana en la barra superior muestra tus notificaciones, con un
contador de las que no has leído. Al abrirlas puedes marcarlas una por una
como leídas, o todas de una vez.

Dos tipos de notificación llegan hoy:

- **Recordatorio de sesión**: se genera automáticamente 24 horas y 2 horas
  antes de cada consulta agendada, y llega por dos canales independientes —
  una notificación en la app y, si tienes email configurado, un correo. Si
  uno de los dos canales falla, el otro igual te llega.
- **Aviso de Google Calendar desconectado**: si tu conexión con Google
  Calendar (ver punto 11) deja de funcionar, te avisa una sola vez.

> 📝 Observaciones UX: (¿el contador de no leídas se nota fácil? ¿los recordatorios llegan con tiempo suficiente para prepararte?)
>
>

---

## 11. Conectar tu Google Calendar (opcional)

Desde "Ajustes" puedes conectar tu cuenta de Google para que tus consultas
aparezcan automáticamente en tu Google Calendar personal.

- Es **por cuenta**, no por sesión: conectas una vez y queda activo hasta
  que lo desconectes.
- El evento que se crea en Google **no muestra el nombre completo del
  paciente** — solo sus iniciales, un código corto que no revela más datos,
  y un enlace de vuelta a Umbral. Tampoco incluye el motivo de consulta ni
  si la sesión es presencial o telemedicina.
- Es de **una sola dirección**: lo que edites en Google no se refleja en
  Umbral. Si corriges o eliminas una consulta en Umbral, el evento en
  Google se actualiza o se borra solo; lo contrario no ocurre.
- Puedes desconectar en cualquier momento desde el mismo lugar. Los eventos
  ya creados en tu Google Calendar no se borran al desconectar.
- Si Google revoca el acceso por su cuenta (por ejemplo, cambiaste la
  contraseña de tu cuenta de Google), la conexión se marca como
  desconectada sola y te llega un aviso (ver punto 10) — no vas a ver un
  error a mitad de tu trabajo clínico: el registro de la consulta en Umbral
  nunca depende de que Google Calendar esté disponible.

> 📝 Observaciones UX: (¿el botón de conectar/desconectar es fácil de encontrar? ¿el mensaje de "conectado" o "error" al volver de Google se entiende?)
>
>

---

## Notas generales de UX (espacio libre)

>
>
>
