# Manual de uso — Umbral (para terapeutas)

> Este manual describe el comportamiento real de la aplicación, derivado directamente del código (validaciones, permisos y reglas de negocio), no de una revisión visual de las pantallas. Cada sección tiene un espacio `> 📝 Observaciones UX` para que anotes diferencias entre lo que describe este documento y lo que realmente experimentas usando la app.

Umbral es una app **individual**: no hay roles, jerarquías ni panel de
administración. La cuenta que creas es tuya y solo tuya — tú ves y
administras únicamente tus propios pacientes, nadie más tiene acceso a
tu información ni tú a la de otro profesional que también use la app.

---

## 1. Crear tu cuenta y primer acceso

No hay un administrador que te dé de alta, pero el registro público requiere
un **código de invitación**: no cualquiera con el link de la app puede
crearse una cuenta, dado que se manejan fichas clínicas. El código lo emite
quien administra la instancia (ver sección 9, "Generar invitación") y se
comparte contigo por fuera de la app (email, mensaje, etc.).

1. **Registro** — desde la pantalla de login, "Regístrate". Pide nombre,
   email, contraseña (mínimo 8 caracteres) y el **código de invitación**
   recibido. Un código inválido, ya usado, o expirado (vence a los 7 días de
   generado) rechaza el registro. La cuenta queda creada pero **no puedes
   loguear todavía**.
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

### Pacientes menores de edad y representante legal

Si la fecha de nacimiento indica que el paciente tiene menos de 18 años, la ficha lo marca con su tramo de edad (menor de 14 años, o de 14 a 17 años) y cambia la forma de registrar el consentimiento. El detalle de la decisión está en `docs/decisiones/0007-pacientes-menores-y-representante-legal.md`.

**Cargar al representante.** Al crear la ficha de un menor, esta se guarda primero; el representante se agrega después, desde la ficha, en la sección de representantes legales (hasta 2 por paciente). Cada representante tiene nombre, RUT, relación con el paciente (madre, padre, tutor legal, curador, cuidador u otro), email y teléfono, y estas marcas:
- **Consiente**: puede otorgar el consentimiento del tratamiento.
- **Pagador**: recibe el cobro. Solo uno a la vez: marcar a otro quita la marca al anterior.
- **Recibe avisos**: se le envían los correos de cobro del paciente.
- **Accede a informes**: queda registrado para la entrega de informes (hoy es solo un dato; se usará con el informe de alta).
- **Custodia** (única, compartida o desconocida) y **Conflicto entre representantes**.

Un representante que ya firmó un consentimiento no se puede eliminar; si cambió la situación, edítalo o desmarca "Consiente".

**Consentimiento de un menor.** Lo otorga el representante, no el paciente. Al registrar el consentimiento de un menor (o al subir el documento de consentimiento informado o de telemedicina) debes elegir qué representante lo otorga; el sistema rechaza el consentimiento de un menor sin representante con la marca "Consiente". Revocar un consentimiento sigue siendo posible siempre.

**Asentimiento del paciente.** El documento "Asentimiento informado" y la sección "Asentimiento del menor" dejan constancia de que el niño, niña o adolescente fue informado y oído (menores de 14 años) o de que dio su asentimiento expreso (14 a 17 años). Las acciones son: informado y oído, asentimiento otorgado, rechazado y retirado. El asentimiento **no reemplaza** el consentimiento del representante, y un rechazo muestra un aviso en la ficha pero no impide registrar ni agendar. Es un registro de bitácora: no se edita ni se borra.

**Aviso de regularización y plazo.** Si el menor no tiene un representante con "Consiente", o su consentimiento vigente lo otorgó él mismo (como se hacía antes), la ficha muestra un aviso ámbar con la fecha límite: **1 de diciembre de 2026**. Hasta esa fecha el consentimiento antiguo sigue sirviendo para crear consultas; desde entonces el sistema pedirá que el consentimiento vigente lo haya otorgado un representante y rechazará crear o corregir consultas de ese menor hasta que se regularice. Para regularizar: carga al representante y registra un nuevo consentimiento otorgado por él.

**Padres separados o en desacuerdo.** El sistema guarda el tipo de custodia y la marca "Conflicto entre representantes", y las muestra en la ficha, pero **no bloquea** ninguna acción por ello. Qué autorización pedir y cuándo avanzar es una decisión del terapeuta; en caso de duda, conviene pedir asesoría legal.

**Cobros y correos van al representante.** Para un menor, el link de pago y el aviso de cobro vencido se envían al representante con "Recibe avisos" y email (se prefiere el marcado como pagador), con el nombre del paciente en el texto y sin datos clínicos. El correo del propio menor no se usa. Si no hay ningún representante con email, el correo no se envía y el cobro queda como "sin email"; al reenviar el link la app avisa que el menor no tiene representante con email. En ese caso Flow necesita igual un email de pagador, y el sistema usa el tuyo como pagador técnico (queda un aviso en el registro del servidor); el link no se te envía. Los recordatorios de sesión siguen llegando a ti.

**Reserva pública de un menor.** En la agenda pública (sección 13), quien reserva marca "Reservo para un menor de edad" e ingresa los datos del paciente y del representante (nombre, RUT, correo y teléfono opcional). El sistema valida que el paciente sea menor de 18 años y que el RUT del representante sea distinto al del paciente. Un menor se identifica por **su propio RUT** (no por el email del representante, porque un mismo representante puede reservar para dos hijos); si ya existe una ficha con ese RUT, solo se reutiliza si el RUT del representante coincide con uno ya registrado. En cualquier otro caso el paciente ve el mismo mensaje genérico de "no fue posible procesar la reserva". Al crear una ficha nueva, el representante queda con todas las marcas activas (consiente, pagador, avisos e informes) y custodia desconocida. La reserva no registra consentimiento: debes cargarlo tú después.

**Deber de denuncia y secreto profesional (guía, sin funcionalidad).** Esta guía requiere revisión legal y no está implementada en la app. Como orientación general, el Código Procesal Penal (art. 175) establece quiénes están obligados a denunciar ciertos delitos de los que toman conocimiento, y el secreto profesional tiene excepciones y tensiones con esa obligación y con el derecho de los padres a ser informados sobre un adolescente. La app no avisa ni decide por ti: ante sospecha de vulneración de derechos o de un delito contra un niño, niña o adolescente, consulta con asesoría legal o con tu colegio profesional antes de actuar, y deja constancia de tu decisión en la ficha.

> 📝 Observaciones UX: (¿quedó claro que el representante se agrega después de guardar la ficha? ¿el aviso de plazo se entiende?)
>
>

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

## 5. Cobros a pacientes (pagos online con Flow)

Umbral te permite cobrar tus sesiones a través de Flow, generando un link de
pago que tu paciente recibe por email. Cada terapeuta conecta **su propia**
cuenta Flow — Umbral no es un intermediario que reciba el dinero, el pago va
directo a tu cuenta.

### Conectar tu cuenta Flow

Desde "Pagos", un asistente de 5 pasos te guía para conectar tu cuenta:

1. **Antes de empezar**: una lista de lo que necesitas (una cuenta activa en
   Flow y tu API Key y Secret Key del panel de Flow).
2. **Ir a Flow**: ingresas al panel de Flow con tu cuenta.
3. **Ubicar tus credenciales**: dentro de Flow, en "Configuración de la
   API", copias tu API Key y tu Secret Key.
4. **Pegar tus credenciales**: pegas la API Key y la Secret Key en la app. La
   app las valida directamente contra Flow antes de guardarlas; si están
   mal, te avisa ahí mismo y no queda nada guardado.
5. **Confirmación**: ves un resumen (proveedor, API Key enmascarada, huella
   de la clave y, si Flow la informa, el nombre del comercio), puedes
   ponerle un nombre opcional a la cuenta y confirmas con "Confirmar y
   conectar". Recién ahí tu cuenta queda conectada y lista para generar
   cobros.

Desde la misma pantalla puedes desconectar la cuenta cuando quieras: los
cargos ya generados no se ven afectados, pero no se crean cargos nuevos hasta
que vuelvas a conectarla.

**Sin una cuenta Flow conectada no puedes cobrar**, pero eso no te bloquea
para nada más: puedes seguir creando pacientes y agendando consultas
exactamente igual que si el módulo de cobros no existiera.

### Cómo funciona el cobro automático

Si un paciente tiene un **monto de sesión** configurado en su ficha, cada vez
que registras una consulta con él se genera automáticamente un cobro
pendiente y se envía un link de pago a su email. Si el paciente no tiene
email cargado, el cobro se genera igual, pero el link no se envía solo —
podrás reenviarlo más adelante ni bien cargues su email (ver más abajo).

Si el paciente no tiene un monto de sesión configurado, no se genera ningún
cobro al registrar la consulta.

### Estados de un cobro

En la lista de Consultas, cada sesión con cobro muestra uno de estos chips:

- **Cobro pendiente**: el link está generado y esperando que el paciente pague.
- **Link no enviado**: el cobro existe, pero el paciente no recibió el link
  automáticamente (por ejemplo, porque no tiene email cargado).
- **Pagado**: el paciente completó el pago.
- **Cobro atrasado**: pasó la fecha límite y el paciente no pagó.
- **Cobro cancelado**: el cobro fue anulado automáticamente (por ejemplo, al
  eliminar la ficha del paciente, ver más abajo) y el link ya no se puede
  pagar. No existe un botón para cancelar un cobro a mano.

### Reenviar el link de pago

Si el paciente perdió el email, no lo recibió, o simplemente quiere que se lo
reenvíes, hay un botón para **reenviar el link de pago** manualmente desde el
cobro correspondiente.

### Cobro no generado y reintento

Si al registrar la consulta Flow rechazó la creación del cobro (por ejemplo,
porque el monto está bajo el mínimo que acepta Flow, hoy 350 CLP según la
configuración de Umbral), el cobro queda pendiente **sin link de pago**. En la
lista de Consultas, esa sesión muestra el chip "Cobro no generado" con el
motivo y un botón **"Reintentar cobro"**. Corrige el monto del paciente o de
la sesión si hace falta y pulsa el botón: la app vuelve a intentar crear el
cobro y, si lo logra, el link queda disponible para copiar o reenviar. Solo
sirve para cobros pendientes o vencidos que aún no tienen link.

### Si eliminas una ficha con cobros pendientes

Al eliminar (soft delete) una ficha de paciente, todos sus cobros pendientes
o vencidos se cancelan automáticamente — así ningún link de pago viejo queda
activo para una ficha que ya borraste.

> 📝 Observaciones UX:
>
>

---

## 6. Documentos de pacientes

Desde la ficha del paciente, en la sección "Documentos legales", subes archivos ligados a esa persona en dos pasos:

1. Elige el tipo de documento en el desplegable: **Consentimiento informado**, **Asentimiento informado**, **Acuerdo telemedicina** u **Otro**.
2. Haz clic en "Subir" y selecciona el archivo desde tu computadora.

Reglas:
- Se aceptan **PDF, Word, Excel, ZIP e imágenes**: cualquier otro tipo de archivo se rechaza antes de subir.
- **25 MB máximo** por archivo.
- Solo puedes subir documentos a pacientes propios (mismos que ves en tu listado).

Cada documento subido queda en la lista con su nombre y tipo, y se puede volver a descargar en cualquier momento con el ícono de descarga.

### Anular un documento

Si subiste un documento por error, usa el botón "Anular" junto a él. La app te pide un **motivo obligatorio** (entre 5 y 500 caracteres). El documento **no se elimina**: por la obligación de custodia de la ficha clínica queda marcado como "Anulado", con el motivo visible, y sigue pudiendo descargarse. Si ese documento sustentaba el consentimiento vigente del paciente y no queda otro documento vigente del mismo tipo, el consentimiento registrado también se revoca (queda en el historial de consentimientos).

Además, al corregir una consulta puedes adjuntar un **registro de sesión propio** (opcional); queda en la ficha como documento de tipo "Registro de sesión".

Esto es distinto de "Archivos personales" (ver sección 7): los documentos de paciente quedan ligados a una ficha específica (el consentimiento firmado de esa persona, por ejemplo), mientras que "Archivos personales" es tu biblioteca general, sin paciente asociado.

> 📝 Observaciones UX:
>
>

---

## 7. Archivos personales (Repositorio)

Es tu biblioteca privada, no ligada a un paciente en particular — pensada para libros, plantillas, protocolos, formularios, material general de tu propia práctica. Categorías: Libros, Plantillas, Imágenes, Formularios, Protocolos, General.

Es **privada por cuenta**: nada de lo que subes ahí se comparte con otros profesionales que también usen Umbral, aunque el nombre "Repositorio" pueda sonar a algo institucional.

> 📝 Observaciones UX: (¿quedó claro para ti la diferencia entre esto y "Documentos" dentro de una ficha de paciente?)
>
>

---

## 8. Reportes en PDF

Desde la ficha de un paciente se puede exportar un PDF con la ficha clínica completa, incluyendo el historial de consultas (con sus correcciones) — no es solo un snapshot del estado actual. El PDF incluye una referencia a la Ley 20.584 y la obligación de custodia de 15 años.

> 📝 Observaciones UX:
>
>

---

## 9. Sesión y seguridad

- **Cierre de sesión por inactividad**: después de 8 minutos sin actividad (mover el mouse, tipear, hacer clic, scrollear), aparece un aviso con una cuenta regresiva de 2 minutos. Si no haces nada en ese lapso, la sesión se cierra sola. "Continuar sesión" en ese aviso reinicia el contador.
- **Cierre de sesión real**: al cerrar sesión (botón de salir, cierre por inactividad), la sesión también se invalida en el servidor: el token de ese dispositivo deja de funcionar aunque alguien lo hubiera copiado.
- **Límite de intentos de login**: después de varios intentos fallidos seguidos, el sistema bloquea temporalmente nuevos intentos (rate limiting) — es intencional, no un error, y se libera solo pasado un tiempo. Aplica también a los intentos de código MFA, de restablecimiento de contraseña y de recuperación con código MFA.
- **Bitácora de auditoría**: toda acción relevante (login, creación/edición de fichas, descarga de documentos, etc.) queda registrada de forma inmutable en el servidor — no hay una pantalla para verla dentro de la app (no hay panel administrativo), pero existe y no se puede alterar ni borrar.
- **Generar invitación**: si tu cuenta es la autorizada a invitar (configurada por quien administra la instancia), en la pantalla "Seguridad" aparece una sección "Generar invitación" para crear un código de un solo uso, válido 7 días, que le compartes a la persona que quieres invitar a registrarse. Si tu cuenta no está autorizada, esta sección directamente no aparece.

> 📝 Observaciones UX: (¿el aviso de sesión por expirar se nota a tiempo, o es fácil perderlo de vista y que la sesión se cierre sin querer?)
>
>

---

## 10. Tu cuenta: Perfil y Seguridad

En el menú lateral, "Perfil" reúne tus datos personales y tu agenda pública, y
"Seguridad" reúne el MFA, el historial de seguridad, la conexión con Google
Calendar y, si corresponde, las invitaciones (ver sección 9). Desde "Perfil"
puedes editar tus propios datos:

- **Nombre**: se actualiza al instante, sin pedir contraseña.
- **Perfil público**: especialidad (ej. "Psicología clínica"), una bio
  corta (hasta 500 caracteres) y un **Sitio web** (dirección que empiece con
  `http://` o `https://`, hasta 200 caracteres) que se muestran sin que el
  paciente necesite loguearse, en la página de tu auto-agenda pública (ver
  sección 13), junto a tu foto de perfil. El sitio web aparece como un link
  en el encabezado de tu agenda. Los tres campos son opcionales y públicos:
  no pongas ahí nada que no quieras que cualquiera pueda ver. Si los dejas
  vacíos, simplemente no aparecen (para quitar el sitio web, borra el texto
  y guarda).
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
- **Foto de perfil**: puedes subir o cambiar tu foto (JPG, PNG, WEBP o GIF,
  hasta 5MB) desde la misma sección, y también eliminarla si quieres volver a
  no tener foto.

> 📝 Observaciones UX:
>
>

---

## 11. Notificaciones y recordatorios de sesión

El ícono de campana en la barra superior muestra tus notificaciones, con un
contador de las que no has leído. Al abrirlas puedes marcarlas una por una
como leídas, o todas de una vez.

Estos tipos de notificación llegan hoy:

- **Recordatorio de sesión**: se genera automáticamente 24 horas y 2 horas
  antes de cada consulta agendada, y llega por dos canales independientes —
  una notificación en la app y, si tienes email configurado, un correo. Si
  uno de los dos canales falla, el otro igual te llega. En la lista de
  Consultas, cada sesión muestra un chip con el estado del último
  recordatorio por email enviado: "Recordatorio enviado", "Entregado",
  "Abierto" o "Recordatorio no enviado" si falló — así sabes si tu paciente
  llegó a verlo, sin tener que preguntarle.
- **Aviso de Google Calendar desconectado**: si tu conexión con Google
  Calendar (ver punto 12) deja de funcionar, te avisa una sola vez.
- **Paciente autoagendado sin monto de cobro**: si un paciente se agenda
  solo por primera vez y todavía no tiene un monto de cobro configurado en
  su ficha, te llega un aviso para que completes ese monto a mano — de lo
  contrario esa primera sesión queda sin generar cargo.
- **Cobro vencido**: cuando un cobro pasa su fecha límite sin pago, te llega un
  aviso con el nombre del paciente (y se le envía un correo al paciente si
  tiene email).
- **Anomalía en un cobro**: si la pasarela informa algo que Umbral no puede
  representar (por ejemplo, un pago recibido en un cobro que estaba anulado, o
  un pago con un monto distinto al del cobro), te llega un aviso para que
  revises tu cuenta de la pasarela. El cobro no se marca como pagado
  automáticamente en esos casos.
- **Aviso único sobre documentos legales**: un anuncio puntual, enviado a todas
  las cuentas, pidiendo volver a subir documentos legales perdidos por un
  problema de almacenamiento antes del 23/09. No se repite.

Las notificaciones leídas se eliminan automáticamente pasados 30 días; las
no leídas se conservan hasta que las leas.

> 📝 Observaciones UX: (¿el contador de no leídas se nota fácil? ¿los recordatorios llegan con tiempo suficiente para prepararte?)
>
>

---

## 12. Conectar tu Google Calendar (opcional)

Desde "Seguridad" puedes conectar tu cuenta de Google para que tus consultas
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
  desconectada sola y te llega un aviso (ver punto 11) — no vas a ver un
  error a mitad de tu trabajo clínico: el registro de la consulta en Umbral
  nunca depende de que Google Calendar esté disponible.

> 📝 Observaciones UX: (¿el botón de conectar/desconectar es fácil de encontrar? ¿el mensaje de "conectado" o "error" al volver de Google se entiende?)
>
>

---

## 13. Auto-agenda pública para tus pacientes (opcional)

Umbral te da un link público para que tus pacientes reserven su propia
sesión directamente, sin que tengas que agendarlos tú a mano.

- **Configura tu horario primero.** Desde "Perfil", define tu horario
  semanal (qué días trabajas y en qué rango horario — puede ser distinto
  cada día, por ejemplo lunes a viernes de 9 a 17 y sábado de 10 a 14) y la
  duración de tus sesiones. Ahí mismo puedes cargar bloqueos puntuales
  (un día completo, un rango de horas, o un rango de fechas — por ejemplo
  tus vacaciones) para que esos horarios no aparezcan disponibles.
- **Copia tu link.** En la misma pantalla de Perfil hay una tarjeta con tu
  link público de agenda y un botón para copiarlo — ya viene armado con tu
  nombre (por ejemplo, `.../book/juan-jose-martinez`) y listo para
  compartir por el canal que uses con tus pacientes (WhatsApp, email, etc.).
  Si cambias tu nombre en "Perfil", el link cambia con él: vuelve a copiarlo
  y compártelo de nuevo, porque el anterior deja de funcionar.
- **Qué ve el paciente.** Antes del calendario, ve tu foto de perfil (o tus
  iniciales si no subiste una), tu especialidad, tu bio y un link a tu sitio web, si los cargaste
  desde "Perfil" (ver sección 10). Después, entra sin necesidad de crear
  ninguna cuenta ni loguearse: ve los horarios libres respetando tu horario,
  tus bloqueos y los feriados, elige uno y completa un formulario corto
  (nombre, RUT, fecha de nacimiento y email). Si el email coincide con un
  paciente que ya tienes registrado, la reserva se liga automáticamente a su
  ficha existente; si es alguien nuevo, se crea una ficha nueva con esos
  datos mínimos.
- **Reserva para un menor de edad.** El formulario tiene la opción "Reservo
  para un menor de edad", que pide además los datos del representante legal.
  El detalle de cómo se identifica al menor y qué queda registrado está en la
  sección 3 ("Pacientes menores de edad y representante legal").
- **De dónde vino el paciente.** Si alguien llega a tu link con parámetros de
  campaña (`utm_source`) o desde un link compartido en otra página, Umbral
  guarda ese origen junto con la ficha nueva. En el Dashboard tienes una
  sección "Origen de pacientes" con el desglose por canal (directo,
  campaña, sitio de referencia) para saber de dónde te están llegando.
- **Ventana de reserva.** Solo se puede reservar con al menos 24 horas de
  anticipación (para que siempre tengas tiempo de verla) y hasta 60 días
  hacia adelante — no vas a ver reservas de último minuto ni agendadas a
  meses vista.
- **Si dos personas eligen el mismo horario a la vez**, solo la primera
  reserva se concreta; a la segunda persona la app le avisa que ese horario
  ya no está disponible y le muestra los horarios libres actualizados.
- **Limitación actual: no se envía ningún email de confirmación**, ni al
  paciente que reservó ni a ti como aviso de que tienes una sesión nueva.
  La sesión sí queda agendada y aparece en tu lista de consultas (y en tu
  Google Calendar si lo tienes conectado, ver punto 12) — pero por ahora
  tienes que entrar a la app para enterarte de una reserva nueva.

> 📝 Observaciones UX: (¿te resultó claro cómo configurar tu horario? ¿el
> link se encuentra fácil en Perfil? ¿probaste el flujo completo como si
> fueras un paciente?)
>
>

---

## Notas generales de UX (espacio libre)

>
>
>
