# Manual de uso: Umbral (para terapeutas)

> Este manual describe el comportamiento real de la aplicación, derivado directamente del código (validaciones, permisos y reglas de negocio), no de una revisión visual de las pantallas. Cada sección tiene un espacio `> 📝 Observaciones UX` para que anotes diferencias entre lo que describe este documento y lo que realmente experimentas usando la app.

Umbral es una app **individual**: no hay roles, jerarquías ni panel de
administración. La cuenta que creas es tuya y solo tuya: tú ves y
administras únicamente tus propios pacientes, nadie más tiene acceso a
tu información ni tú a la de otro profesional que también use la app.

Menú lateral: **Dashboard**, **Pacientes**, **Consultas**, **Calendario**,
**Repositorio**, **Pagos**, **Perfil** y **Seguridad**.

---

## 1. Crear tu cuenta y primer acceso

No hay un administrador que te dé de alta, pero el registro público requiere
un **código de invitación**: no cualquiera con el link de la app puede
crearse una cuenta, dado que se manejan fichas clínicas. El código lo emite
quien administra la instancia (ver sección 9, "Generar invitación") y se
comparte contigo por fuera de la app (email, mensaje, etc.).

1. **Registro**: desde la pantalla de login, "Regístrate". Pide nombre
   completo, email, contraseña (mínimo 8 caracteres), confirmación de la
   contraseña y el **código de invitación** recibido. Un código inválido, ya
   usado, o expirado (vence a los 7 días de generado) rechaza el registro.
   La cuenta queda creada pero **no puedes loguear todavía**.
2. **Verificación de email**: te llega un correo con un enlace (válido 24
   horas). Haz clic ahí para activar la cuenta. Sin esto, un intento de login
   rechaza con "Debes verificar tu email antes de iniciar sesión", aunque la
   contraseña sea correcta.
3. **Activación de MFA obligatoria**: en tu primer login exitoso (con
   email ya verificado), la app te muestra un código QR para escanear con
   una app autenticadora (Google Authenticator, Authy, o similar). Esto
   **no es opcional**: toda cuenta lo necesita, no depende de ningún rol.
   Es la única puerta de entrada a fichas clínicas, así que se exige desde
   el primer momento.
4. **Guarda tus 10 códigos de recuperación**: apenas confirmas el código
   de tu app autenticadora, la pantalla te muestra 10 códigos de un solo
   uso. **Se muestran una única vez.** Guárdalos en un gestor de
   contraseñas o impresos en un lugar seguro antes de continuar (botón
   "Copiar todos los códigos" y luego "Ya guardé mis códigos"). Son tu
   único camino para recuperar el acceso si alguna vez pierdes el celular
   con la app autenticadora (ver sección 2).
5. **Logins posteriores**: con MFA ya activo, cada login te pide primero
   email + contraseña, y después el código de 6 dígitos de tu app.

En "Seguridad" puedes desactivar el MFA ingresando un código válido de tu
app ("Desactivar MFA"). Si lo haces, en el siguiente login la app te pedirá
activarlo de nuevo con un QR nuevo y una nueva tanda de 10 códigos. La misma
pantalla muestra un **Historial de seguridad** con las fechas, la dirección
IP y el dispositivo de cada activación o desactivación del MFA.

> 📝 Observaciones UX:
>
>

---

## 2. Si pierdes la contraseña o el dispositivo MFA

No hace falta pedirle a nadie que te desbloquee la cuenta a mano: hay dos
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
(paso 4 de la sección anterior). Si es válido, MFA queda desactivado, se
cierran todas tus sesiones abiertas y te llega un correo avisando de que el
MFA se desactivó con un código de recuperación. Después puedes volver a
loguear con email + contraseña; en ese login vas a tener que enrolar MFA de
nuevo (nuevo QR, nueva tanda de 10 códigos).

**Si perdiste la contraseña Y los 10 códigos de recuperación al mismo
tiempo**, no queda ningún camino self-service: necesitas pedir una
intervención manual (ver `README.md`, sección "Recuperación de cuenta",
para quien administre el servidor). Por eso conviene guardar los códigos
de recuperación apenas se generan, no "para después".

> 📝 Observaciones UX: (¿el link de "olvidaste tu contraseña" es fácil de encontrar? ¿el mensaje genérico del email confunde?)
>
>

---

## 3. Pacientes

La pantalla **Pacientes** lista tus fichas con un buscador por nombre o RUT.
Cada fila muestra el nombre, el email, el RUT, el teléfono y el estado del
consentimiento ("Consentimiento ✓" o "Sin consentimiento"), junto con
etiquetas cuando corresponde: el estado del tratamiento (si está cerrado) y
los avisos de niños, niñas y adolescentes (NNA) ("NNA sin representante" o "NNA: consentimiento por
regularizar"). Cada ficha tiene cuatro acciones: **Ver detalle**, **Editar**,
**Descargar PDF** y **Eliminar**. El detalle se abre en una ventana con tres
pestañas: **Detalle**, **Editar** e **Historial**.

### Crear una ficha

Campos obligatorios: **nombre completo, RUT, fecha de nacimiento**. Todo lo demás es opcional al crear (ocupación, dirección, teléfono, email, contacto de emergencia con su teléfono, psiquiatra y médico tratante, **monto de sesión por defecto en CLP**), y se puede completar después. Si dejas vacío el monto de sesión ("Sin cobro automático") o lo dejas en 0, esa ficha no genera cobros (ver sección 5).

El RUT se normaliza automáticamente en el servidor (saca puntos, pasa a mayúsculas): no hace falta que lo escribas con un formato exacto, pero sí tiene que ser un RUT válido.

Al crear la ficha de un adulto puedes marcar los consentimientos **Presencial** y **Telemedicina** y adjuntar documentos legales; el consentimiento queda registrado con la evidencia automática "Otorgado durante la creación de la ficha". En un NNA esto no es posible hasta cargar a su representante (ver más abajo).

### Editar una ficha

Cada edición exige un **motivo de la modificación** (mínimo 10 caracteres) y queda registrada con un diff (qué campo cambió, de qué valor a qué valor). Esto alimenta la pestaña **Historial** de la ficha, donde se ve quién modificó, cuándo, con qué motivo y los valores anteriores y nuevos. Si guardas sin cambiar nada, el sistema lo detecta y no genera un registro de historial vacío.

### Consentimientos (Ley 21.719)

Hay dos finalidades de consentimiento, independientes entre sí:
- **Tratamiento**: consentir el tratamiento clínico en sí. En la pantalla esta finalidad aparece con la etiqueta **Presencial**.
- **Telemedicina**: consentir la modalidad de atención remota.

Cada una se otorga o revoca por separado, desde la pestaña **Editar** de la ficha. Al registrar cualquier consentimiento, **la evidencia es obligatoria** (mínimo 10 caracteres, por ejemplo "firma en papel escaneada, sesión del 12/03") y queda con fecha y quién lo registró. Al editar la ficha, el motivo de la modificación hace de evidencia.

Para poder registrar consultas basta con que exista **cualquiera** de los dos consentimientos vigentes: el de telemedicina habilita las consultas presenciales y viceversa. El sistema no exige el consentimiento de telemedicina para registrar una consulta de tipo "Telemedicina".

Importante: revocar un consentimiento **no borra el evento anterior**. El historial completo (otorgamientos y revocaciones) se conserva siempre en el sistema; es un registro tipo bitácora, no un simple check on/off. La ficha muestra el estado vigente de cada finalidad, y la pestaña **Historial** solo lista cambios de datos de la ficha (un cambio que solo toca consentimientos no genera una entrada ahí).

**Consentimiento retroactivo.** Si un paciente ya estaba en tratamiento antes de que el consentimiento fuera obligatorio, o llegó por la agenda pública (que no registra consentimiento), la lista muestra "Sin consentimiento" y una casilla de **Declarar consentimiento retroactivo**. Puedes marcar varias fichas, elegir la finalidad, escribir la evidencia (mínimo 10 caracteres, por ejemplo dónde está el consentimiento en papel) y pulsar **Declarar**. Esta acción no reemplaza el consentimiento en papel: deja constancia en el sistema de que ya fue obtenido, y tú quedas como responsable de esa declaración. Si el documento está digitalizado, súbelo desde la ficha del paciente en vez de declararlo ahí.

### Pacientes NNA y representante legal

Si la fecha de nacimiento indica que el paciente tiene menos de 18 años, la ficha lo marca con su tramo de edad (menos de 14 años, o de 14 a 17 años) y cambia la forma de registrar el consentimiento. El detalle de la decisión está en `docs/decisiones/0007-pacientes-menores-y-representante-legal.md`.

**Cargar al representante.** Al crear la ficha de un NNA, esta se guarda primero; el representante se agrega después, desde el detalle de la ficha, en la sección **Representantes legales** con el botón **Agregar representante** (hasta 2 por paciente). Cada representante tiene nombre, RUT, relación con el paciente (madre, padre, tutor legal, curador, cuidador u otro), cuidado personal (exclusivo, compartido o no informado), email y teléfono, y estas marcas en "Permisos y avisos":
- **Puede otorgar consentimiento** (en la lista: "Consiente"): puede otorgar el consentimiento del tratamiento.
- **Es el pagador** (en la lista: "Pagador"): recibe el cobro. Solo uno a la vez: marcar a otro quita la marca al anterior.
- **Recibe comunicaciones** (en la lista: "Recibe avisos"): se le envían los correos de cobro del paciente.
- **Puede acceder a informes** (en la lista: "Accede a informes"): es el único representante al que se puede entregar el informe de alta del NNA (ver "Cerrar el tratamiento e informe de alta").
- **Hay conflicto entre los representantes** (en la lista: "Conflicto entre representantes").

Un representante que ya firmó un consentimiento no se puede quitar; si cambió la situación, edítalo o desmarca "Puede otorgar consentimiento".

**Consentimiento de un NNA.** Lo otorga el representante, no el paciente. Al registrar el consentimiento de un NNA (o al subir el documento de consentimiento informado o de telemedicina) debes elegir qué representante lo otorga; el sistema rechaza el consentimiento de un NNA sin representante con la marca "Puede otorgar consentimiento". Revocar un consentimiento sigue siendo posible siempre.

**Asentimiento del paciente.** El documento "Asentimiento informado" y la sección "Asentimiento del NNA" dejan constancia de que el niño, niña o adolescente fue informado y oído (menos de 14 años) o de que dio su asentimiento expreso (14 a 17 años). Las acciones son: informado y oído, asentimiento otorgado, rechazado y retirado. El asentimiento **no reemplaza** el consentimiento del representante, y un rechazo muestra un aviso en la ficha pero no impide registrar ni agendar. Es un registro de bitácora: no se edita ni se borra.

**Aviso de regularización y plazo.** Si el NNA no tiene un representante con "Puede otorgar consentimiento", o su consentimiento vigente lo otorgó él mismo (como se hacía antes), la ficha muestra un aviso ámbar con la fecha límite: **1 de diciembre de 2026**. Hasta esa fecha el consentimiento antiguo sigue sirviendo para crear consultas; desde entonces el sistema pedirá que el consentimiento vigente lo haya otorgado un representante y rechazará crear o corregir consultas de ese NNA (y emitir o corregir su informe de alta) hasta que se regularice. Para regularizar: carga al representante y registra un nuevo consentimiento otorgado por él.

**Padres separados o en desacuerdo.** El sistema guarda el tipo de cuidado personal y la marca "Conflicto entre representantes", y las muestra en la ficha, pero **no bloquea** ninguna acción por ello. Qué autorización pedir y cuándo avanzar es una decisión del terapeuta; en caso de duda, conviene pedir asesoría legal.

**Cobros y correos van al representante.** Para un NNA, el link de pago y el aviso de cobro vencido se envían al representante con "Recibe comunicaciones" y email (se prefiere el marcado como pagador), con el nombre del paciente en el texto y sin datos clínicos. El correo del propio NNA no se usa. Si no hay ningún representante con email, el correo no se envía y el cobro queda como "sin email"; al reenviar el link la app avisa que el NNA no tiene representante con email. En ese caso el cobro queda creado pero sin link de pago, porque Flow necesita el email del pagador para emitirlo y el sistema no usa el tuyo en su lugar; el cobro muestra el motivo. Carga el email de un representante y usa "Reintentar cobro" para generar el link. Los recordatorios de sesión siguen llegando a ti.

**Reserva pública de un NNA.** En la agenda pública (sección 13), quien reserva marca "Reservo para un NNA" e ingresa los datos del paciente y del representante (nombre, RUT, correo y teléfono opcional). El sistema valida que el paciente tenga menos de 18 años y que el RUT del representante sea distinto al del paciente. Un NNA se identifica por **su propio RUT** (no por el email del representante, porque un mismo representante puede reservar para dos hijos); si ya existe una ficha con ese RUT, solo se reutiliza si el RUT del representante coincide con uno ya registrado. En cualquier otro caso no se crea nada y quien reservó ve la misma confirmación que una reserva nueva (ver sección 13). Al crear una ficha nueva, el representante queda con todas las marcas activas (consiente, pagador, avisos e informes) y cuidado personal no informado. La reserva no registra consentimiento: debes cargarlo tú después.

**Deber de denuncia y secreto profesional (guía, sin funcionalidad).** Esta guía requiere revisión legal y no está implementada en la app. Como orientación general, el Código Procesal Penal (art. 175) establece quiénes están obligados a denunciar ciertos delitos de los que toman conocimiento, y el secreto profesional tiene excepciones y tensiones con esa obligación y con el derecho de los padres a ser informados sobre un adolescente. La app no avisa ni decide por ti: ante sospecha de vulneración de derechos o de un delito contra un niño, niña o adolescente, consulta con asesoría legal o con tu colegio profesional antes de actuar, y deja constancia de tu decisión en la ficha.

> 📝 Observaciones UX: (¿quedó claro que el representante se agrega después de guardar la ficha? ¿el aviso de plazo se entiende?)
>
>

### Cerrar el tratamiento e informe de alta

Cuando termina el proceso con un paciente, la sección **Cierre del tratamiento** de la ficha te permite cerrarlo y dejar un informe de alta. El detalle técnico de la decisión está en `docs/decisiones/0006-informe-de-alta-firma-simple-y-hash.md`. Ninguna norma verificada te obliga a emitir este informe ni fija su formato; es un documento profesional que la app te ayuda a dejar ordenado.

**Antes de empezar.** Para el informe generado por la app necesitas tu **RUT** en el perfil (si falta, el formulario te lo avisa y te lleva a "Datos profesionales" de la pantalla Perfil); el registro profesional es opcional. También necesitas el consentimiento de tratamiento vigente del paciente, igual que para agendar consultas.

**Cómo se emite.** Pulsa **Dar de alta** y elige uno de los dos caminos:
- **Generar con el sistema.** Se crea un borrador prellenado con la fecha de ingreso, la fecha de cierre y el número de sesiones. Tú completas el motivo de consulta, el resumen de evolución, el estado al cierre y las recomendaciones (el diagnóstico es opcional), puedes **guardar el borrador** y seguirlo después, y al terminar pulsas **Emitir informe**.
- **Subir mi propio PDF.** Si ya tienes tu epicrisis en PDF, la subes y el sistema solo pide el motivo de cierre, la fecha de cierre y el archivo. Debe ser un PDF real y pesar hasta 25 MB. El sistema **no firma** ese archivo ni lo presenta como firmado por él: lo guarda tal cual y calcula su huella para detectar cambios.

**Motivo de cierre.** Puede ser **Alta**, **Derivado** o **Deserción**. Para Derivado puedes indicar el destino de forma breve. Para Deserción eliges un motivo principal de una lista cerrada (por ejemplo "Costo" o "Sin contacto o sin información") y, si eliges "Otro", una nota breve. No escribas datos sensibles, de salud tuya o de familiares, ni de terceros en esos textos. La lista es una síntesis propia a partir de la literatura, no un estándar validado.

**Qué pasa al emitir.** Antes de confirmar, la app te muestra la lista de consultas futuras que se cancelarán, y esa acción **no se puede deshacer**. Al emitir:
- el paciente pasa a **Alta**, **Derivado** o **Deserción**, y deja de recibir reservas desde la agenda pública;
- se cancelan sus consultas futuras, se liberan los horarios de la agenda pública y se anulan los cobros pendientes de esas consultas;
- se envía un correo al paciente avisando que sus consultas quedaron canceladas. **No incluye el motivo del cierre**. Si el paciente es NNA, el correo va solo a los representantes con "Recibe comunicaciones" y email, nunca al correo del NNA. Si no hay a quién avisar, el correo simplemente no se envía y el cierre sigue adelante;
- el informe queda **inmutable** y con una huella digital (SHA-256) impresa en el pie del PDF.

**Descargar, verificar y corregir.** Cada informe emitido tiene un ícono para **descargar el PDF** y otro para **verificar**: la verificación recalcula la huella y te dice si el registro del informe y el PDF guardado coinciden con la huella original. Es una comprobación de que no hubo cambios desde la emisión; no reemplaza una firma electrónica avanzada. Si necesitas cambiar algo, usa **Corregir**: se crea una versión nueva y la anterior queda como "Reemplazada", sin borrarse.

**Si el paciente vuelve.** Si agendas una consulta a un paciente con el tratamiento cerrado, la app te pide confirmar la reapertura ("Reabrir y agendar"). El informe anterior queda en la lista como "Histórico · Paciente reabierto".

**Entregar el informe.** El sistema **no envía** el informe por correo: lo descargas y lo entregas por tu cuenta, y luego lo registras en el bloque **Entregas** con **Registrar entrega**. Cada entrega guarda a quién, por qué canal (en persona, email, correo postal u otro), cuándo y para qué (la finalidad, sin datos clínicos). Las entregas solo se agregan; no se editan ni se borran.
- **Paciente adulto:** se le entrega a él.
- **Paciente con menos de 18 años:** no se le entrega directamente; se entrega a un **representante con "Accede a informes"**. Si ninguno lo tiene marcado, la app te lo indica y debes actualizar su ficha.
- **Tercero** (un colegio, otro profesional, un tribunal): necesitas una autorización ya cargada en la ficha, en Documentos legales, con el tipo **Autorización de entrega de informe**. Puede ser la autorización del paciente o de su representante, o el oficio de un tribunal. La app no revisa el contenido ni la formalidad del documento: esa verificación es tuya, y para registrar la entrega debes marcar una casilla confirmando que revisaste la autorización (queda guardada con la entrega). Según el art. 13 de la Ley 20.584, un tercero particular debe estar autorizado por el titular mediante **poder simple otorgado ante notario**; a los tribunales se les entrega la información de las causas que conocen, y a fiscales y abogados solo con autorización del juez. Si la autorización que cargaste no cumple esa formalidad, consulta con asesoría legal antes de entregar.

**Deber de denuncia y secreto profesional.** Vale la misma guía que en "Pacientes NNA y representante legal": la app no avisa ni decide por ti, y ante dudas conviene asesoría legal antes de entregar o de callar información.

**Pendiente de revisión legal.** Esta funcionalidad no pasó por una revisión legal. Siguen abiertas, entre otras, si la autorización que acepta la app cumple lo que exige el art. 13 de la Ley 20.584 para entregar a terceros, la vigencia del código de ética del Colegio de Psicólogos (solo se encontró la versión de 1996) y si una firma simple con huella digital basta para los usos que le des al informe (ver el ADR 0006).

> 📝 Observaciones UX: (¿se entiende la diferencia entre generar y subir mi propio PDF? ¿quedó claro que el informe no se envía por correo?)
>
>

### Eliminar una ficha

Es un "soft delete": la ficha desaparece de los listados pero no se borra de la base de datos (obligación legal de custodia por 15 años, Ley 20.584). No hay forma de eliminar definitivamente una ficha desde la app. La app pide confirmación antes de eliminar, y los cobros pendientes o vencidos del paciente se cancelan (ver sección 5).

> 📝 Observaciones UX: (¿el formulario deja claro cuáles campos son obligatorios antes de intentar guardar? ¿el mensaje de "motivo de cambio" es claro al editar?)
>
>

---

## 4. Consultas

La pantalla **Consultas** tiene un selector de paciente con buscador (por nombre o RUT): al elegir uno, ves su historial de sesiones.

### Crear una consulta

Con **Nueva consulta** se abre el formulario "Registrar Sesión". Campos obligatorios: **paciente, fecha de sesión, hora de sesión, motivo de consulta, intervención realizada**. Opcionales: tareas y acuerdos, próxima sesión (fecha y hora), tipo de sesión (presencial o telemedicina, por defecto presencial) y un registro de sesión propio (ver sección 6). Los tres textos clínicos admiten formato básico (negrita, cursiva, subrayado y listas).

La sesión se registra con la duración de sesión que tengas configurada en "Perfil" (por defecto 50 minutos) y la conserva aunque después cambies esa configuración. La consulta se rechaza si el paciente no tiene un consentimiento vigente (ver sección 3). Si el paciente tiene el tratamiento cerrado, la app te pide confirmar la reapertura.

También puedes agendar una sesión desde el **Calendario** (ver sección 14).

### Corregir una consulta

Esto es lo más importante de entender de este módulo: **corregir NO sobrescribe la consulta original**. Con el ícono de lápiz de la sesión se abre "Corregir Sesión": puedes cambiar fecha, hora, tipo de sesión, los textos clínicos y la próxima sesión, y al guardar el sistema crea una versión nueva y marca la anterior como "corregida". La versión vieja se sigue pudiendo consultar con "Ver historial de correcciones", con quién la corrigió y cuándo. Esto existe porque un registro clínico legalmente no puede alterarse de forma que se pierda el rastro del dato original (inalterabilidad de registros). El formulario de corrección no pide un motivo.

En la práctica: si te equivocaste en algo, corrígelo con confianza: no se "pierde" nada, solo se agrega una versión nueva encima. No se pueden corregir sesiones futuras de un paciente cuyo tratamiento ya se cerró.

> 📝 Observaciones UX: (¿es intuitivo distinguir "esta es la versión vigente" vs. "esta es una versión corregida" al mirar el historial?)
>
>

---

## 5. Cobros a pacientes (pagos online con Flow)

Umbral te permite cobrar tus sesiones a través de Flow, generando un link de
pago que tu paciente recibe por email. Cada terapeuta conecta **su propia**
cuenta Flow: Umbral no es un intermediario que reciba el dinero, el pago va
directo a tu cuenta.

### Conectar tu cuenta Flow

Desde "Pagos", un asistente de 5 pasos te guía para conectar tu cuenta:

1. **Antes de empezar**: una lista de lo que necesitas (una cuenta activa en
   Flow y tu API Key y Secret Key del panel de Flow).
2. **Ir a Flow**: ingresas al panel de Flow con tu cuenta.
3. **Ubicar tus credenciales**: dentro de Flow, en "Configuración de la
   API", copias tu API Key y tu Secret Key.
4. **Pegar tus credenciales**: pegas la API Key y la Secret Key en la app y
   pulsas "Validar credenciales". La app las valida directamente contra Flow
   antes de guardarlas; si están mal, te avisa ahí mismo y no queda nada
   guardado.
5. **Confirmación**: ves un resumen (proveedor, API Key enmascarada, huella
   de la clave y, si Flow la informa, el nombre del comercio), puedes
   ponerle un nombre opcional a la cuenta y confirmas con "Confirmar y
   conectar". Recién ahí tu cuenta queda conectada y lista para generar
   cobros.

Desde la misma pantalla puedes desconectar la cuenta cuando quieras
("Desconectar cuenta"): los cargos ya generados no se ven afectados, pero no
se crean cargos nuevos hasta que vuelvas a conectarla. Si la pantalla te avisa
que la cuenta necesita reconectarse (el modelo anterior de pagos ya no está
disponible), vuelve a ingresar tus credenciales de Flow para retomar el cobro
automático.

**Sin una cuenta Flow conectada no puedes cobrar**, pero eso no te bloquea
para nada más: puedes seguir creando pacientes y agendando consultas
exactamente igual que si el módulo de cobros no existiera.

### Cómo funciona el cobro automático

Si un paciente tiene un **monto de sesión por defecto** configurado en su
ficha, cada vez que registras una consulta con él se genera automáticamente un
cobro pendiente y se envía un link de pago a su email. La fecha límite del
cobro es la fecha de la sesión (o el momento del registro, si la sesión ya
pasó) más 24 horas; si reprogramas la sesión, la fecha límite se ajusta. El
monto del cobro es el que tenía la ficha al registrar la consulta. Si el
paciente no tiene email cargado, el cobro se genera
igual (Flow recibe tu email como pagador), pero el link no se envía solo:
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
  eliminar la ficha del paciente o al emitir su informe de alta, ver más
  abajo) y el link ya no se puede pagar. No existe un botón para cancelar un
  cobro a mano.

### Copiar, reenviar y renovar el link de pago

En un cobro pendiente o atrasado que ya tiene link, la sesión muestra tres
botones:

- **Copiar link de pago**: lo copia al portapapeles, útil para compartirlo
  por otro canal (WhatsApp, SMS, etc.).
- **Reenviar link de pago**: vuelve a enviarlo por email al paciente (o al
  representante, si es NNA). Requiere que haya un email cargado.
- **Generar nuevo link**: pide confirmación y anula el link actual para emitir
  uno nuevo, que se envía por email. Sirve, por ejemplo, cuando un pago fue
  rechazado y el link anterior quedó inservible.

### Cobro no generado y reintento

Si al registrar la consulta no se pudo crear el cobro (por ejemplo, porque el
monto está bajo el mínimo para cobrar con Flow, hoy 350 CLP según la
configuración de Umbral, o porque Flow rechazó la creación), el cobro queda pendiente **sin link de pago**. En la
lista de Consultas, esa sesión muestra el chip "Cobro no generado" con el
motivo y un botón **"Reintentar cobro"**. Al pulsarlo, la app vuelve a
intentar crear el cobro con el monto que ese cobro ya tiene y, si lo logra, el
link queda disponible para copiar o reenviar. Sirve, por ejemplo, cuando Flow
rechazó la creación de forma transitoria, cuando reconectaste tu cuenta Flow o,
en un NNA, cuando cargaste el email de un representante. Solo sirve para
cobros pendientes o vencidos que aún no tienen link. El monto del cobro se
fija al crearlo: cambiar después el monto de sesión del paciente no modifica
los cobros ya creados, así que un cobro bajo el mínimo vuelve a ser rechazado
al reintentar.

### Qué ve el paciente al pagar

Tras pagar en Flow, el paciente vuelve a una página pública de Umbral que le
confirma "Pago recibido", o le indica "Pago no completado" y le pide solicitar
un nuevo link a su terapeuta. Si la pasarela informa algo que Umbral no puede
representar, recibes un aviso de anomalía (ver sección 11).

### Si eliminas una ficha con cobros pendientes

Al eliminar (soft delete) una ficha de paciente, todos sus cobros pendientes
o vencidos se cancelan automáticamente, así ningún link de pago viejo queda
activo para una ficha que ya borraste. Lo mismo ocurre con los cobros de las
consultas futuras que se cancelan al emitir un informe de alta.

> 📝 Observaciones UX:
>
>

---

## 6. Documentos de pacientes

Desde la ficha del paciente, en la sección "Documentos legales", subes archivos ligados a esa persona en dos pasos:

1. Elige el tipo de documento en el desplegable: **Consentimiento informado**, **Asentimiento informado**, **Acuerdo telemedicina**, **Autorización de entrega de informe** u **Otro**. El informe de alta no se sube aquí: se emite desde "Cierre del tratamiento".
2. Haz clic en "Subir" y selecciona el archivo desde tu computadora.

Reglas:
- Se aceptan **PDF, Word, Excel, ZIP e imágenes**: cualquier otro tipo de archivo se rechaza antes de subir.
- **25 MB máximo** por archivo.
- Solo puedes subir documentos a pacientes propios (mismos que ves en tu listado).

Cada documento subido queda en la lista con su nombre y tipo, y se puede volver a descargar en cualquier momento con el ícono de descarga. Cada descarga queda registrada en la bitácora de auditoría (ver sección 9).

### Anular un documento

Si subiste un documento por error, usa el botón "Anular" junto a él. La app te pide un **motivo obligatorio** (entre 5 y 500 caracteres). El documento **no se elimina**: por la obligación de custodia de la ficha clínica queda marcado como "Anulado", con el motivo visible, y sigue pudiendo descargarse. Si ese documento sustentaba el consentimiento vigente del paciente y no queda otro documento vigente del mismo tipo, el consentimiento registrado también se revoca (queda en el historial de consentimientos).

Además, al crear o corregir una consulta puedes adjuntar un **registro de sesión propio** (opcional, PDF o Word); queda en la ficha como documento de tipo "Registro de sesión".

Esto es distinto de "Repositorio" (ver sección 7): los documentos de paciente quedan ligados a una ficha específica (el consentimiento firmado de esa persona, por ejemplo), mientras que el Repositorio es tu biblioteca general, sin paciente asociado.

> 📝 Observaciones UX:
>
>

---

## 7. Archivos personales (Repositorio)

Es tu biblioteca privada, no ligada a un paciente en particular, pensada para libros, plantillas, protocolos, formularios, material general de tu propia práctica. Categorías: Libros, Plantillas, Imágenes, Formularios, Protocolos, General (más el filtro "Todos").

Al subir un archivo eliges su categoría y puedes agregar una descripción. Se aceptan PDF, Word (DOC, DOCX), Excel (XLS, XLSX), PowerPoint (PPT, PPTX), imágenes (JPG, PNG, GIF, WEBP), TXT y ZIP, hasta **50 MB** por archivo. Cada archivo se puede **editar** (nombre, categoría y descripción), **descargar** y **eliminar**. La eliminación es lógica: el archivo deja de aparecer en tu lista. Las descargas quedan registradas en la bitácora de auditoría.

Es **privada por cuenta**: nada de lo que subes ahí se comparte con otros profesionales que también usen Umbral, aunque el nombre "Repositorio" pueda sonar a algo institucional.

> 📝 Observaciones UX: (¿quedó claro para ti la diferencia entre esto y "Documentos" dentro de una ficha de paciente?)
>
>

---

## 8. Reportes en PDF

Desde la ficha de un paciente (ícono "Descargar PDF" de la lista, o el botón "Descargar PDF" del detalle) se puede exportar un PDF con la ficha clínica completa, incluyendo el historial de consultas (con sus correcciones): no es solo un snapshot del estado actual. El PDF incluye una referencia a la Ley 20.584 y la obligación de custodia de 15 años. Cada exportación queda registrada en la bitácora de auditoría.

> 📝 Observaciones UX:
>
>

---

## 9. Sesión y seguridad

- **Cierre de sesión por inactividad**: después de 8 minutos sin actividad (mover el mouse, tipear, hacer clic, tocar la pantalla, scrollear), aparece el aviso "Sesión por expirar" con una cuenta regresiva de 2 minutos. Si no haces nada en ese lapso, la sesión se cierra sola. "Continuar sesión" en ese aviso reinicia el contador, y "Cerrar sesión" la cierra de inmediato. La inactividad se mide en conjunto entre todas tus pestañas abiertas: la actividad en una evita el cierre en las demás.
- **En el celular o con la pestaña en segundo plano**: los navegadores móviles congelan los temporizadores cuando bloqueas la pantalla o cambias de app, así que al volver la app compara la hora real con tu última actividad. Si pasaron menos de 8 minutos, no ocurre nada. Si pasaron entre 8 y 10 minutos, aparece el aviso con su cuenta regresiva de 2 minutos. Si pasaron más de 10 minutos, la sesión se cierra directamente, sin aviso.
- **Duración máxima de la sesión**: además de la inactividad, la sesión caduca en el servidor pasado un máximo (8 horas por defecto, configurable por quien administra la instancia). Si caduca mientras trabajas, la app te lleva al login y, al volver a iniciar sesión, te devuelve a la pantalla en la que estabas. Esto no ocurre cuando cierras sesión tú mismo ni cuando la sesión se cierra por inactividad: en esos casos entras al Dashboard.
- **Cierre de sesión real**: al cerrar sesión (botón de salir, cierre por inactividad), la sesión también se invalida en el servidor: el token de ese dispositivo deja de funcionar aunque alguien lo hubiera copiado.
- **Límite de intentos de login**: después de varios intentos fallidos seguidos, el sistema bloquea temporalmente nuevos intentos (rate limiting). Es intencional, no un error, y se libera solo pasado un tiempo. Aplica también a los intentos de código MFA, de restablecimiento de contraseña y de recuperación con código MFA.
- **Bitácora de auditoría**: toda acción relevante (login, creación, lectura y edición de fichas, descarga de documentos y de informes, exportación de PDF, cierre de tratamientos, entre otras) queda registrada de forma inmutable en el servidor, y los accesos denegados a datos clínicos también. No hay una pantalla para verla dentro de la app (no hay panel administrativo), pero existe y no se puede alterar ni borrar.
- **Generar invitación**: si tu cuenta es la autorizada a invitar (configurada por quien administra la instancia), en la pantalla "Seguridad" aparece una sección "Generar invitación" para crear un código de un solo uso, válido 7 días, que le compartes a la persona que quieres invitar a registrarse. Si tu cuenta no está autorizada, esta sección directamente no aparece.

> 📝 Observaciones UX: (¿el aviso de sesión por expirar se nota a tiempo, o es fácil perderlo de vista y que la sesión se cierre sin querer?)
>
>

---

## 10. Tu cuenta: Perfil y Seguridad

En el menú lateral, "Perfil" reúne tus datos personales, tus datos
profesionales y tu agenda pública, y "Seguridad" reúne el MFA, el historial de
seguridad, la conexión con Google Calendar y, si corresponde, las
invitaciones (ver sección 9). Desde "Perfil" puedes editar tus propios datos:

- **Nombre**: se actualiza al instante, sin pedir contraseña. Cambiar el
  nombre cambia también el link de tu agenda pública (ver sección 13).
- **Perfil público**: especialidad (ej. "Psicología clínica"), una bio
  corta (hasta 500 caracteres) y un **Sitio web** (dirección que empiece con
  `http://` o `https://`, hasta 200 caracteres) que se muestran sin que el
  paciente necesite loguearse, en la página de tu auto-agenda pública (ver
  sección 13), junto a tu foto de perfil. El sitio web aparece como un link
  en la tarjeta de tu perfil en la agenda. Los tres campos son opcionales y
  públicos: no pongas ahí nada que no quieras que cualquiera pueda ver. Si los
  dejas vacíos, simplemente no aparecen (para quitar el sitio web, borra el
  texto y guarda).
- **Datos profesionales**: tu **RUT** (obligatorio para emitir informes de
  alta generados por la app) y tu registro profesional (opcional). Se usan
  para firmar tus informes de alta y no se muestran en tu perfil público.
- **Email**: pide tu contraseña actual. El cambio **no se aplica de
  inmediato**: queda pendiente hasta que confirmes desde un enlace enviado
  a la casilla nueva (válido 24 horas). Tu email actual sigue funcionando
  para loguear mientras tanto, y además te llega un aviso a esa casilla
  antigua avisando que se solicitó el cambio (por si no fuiste tú).
- **Contraseña**: pide tu contraseña actual y la nueva (mínimo 8
  caracteres, con confirmación). Al guardar, **se cierra tu sesión de
  inmediato**, y no solo en este dispositivo: cualquier otra sesión abierta
  en otro navegador o celular también queda invalidada. Vuelve a loguear con
  la contraseña nueva.
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
  antes de cada consulta agendada, y llega por dos canales independientes:
  una notificación en la app y, si tienes email configurado, un correo. Si
  uno de los dos canales falla, el otro igual te llega. En la lista de
  Consultas, cada sesión muestra un chip con el estado del último
  recordatorio por email enviado: "Recordatorio enviado", "Entregado",
  "Abierto" o "Recordatorio no enviado" si falló. Ese correo te llega a ti,
  no al paciente, así que el chip te dice si el recordatorio llegó a tu
  bandeja y no si tu paciente lo vio. Las consultas
  canceladas por un informe de alta ya no generan recordatorios.
- **Aviso de Google Calendar desconectado**: si tu conexión con Google
  Calendar (ver sección 12) deja de funcionar, te avisa una sola vez.
- **Paciente autoagendado sin monto de cobro**: si un paciente se agenda
  solo por primera vez y todavía no tiene un monto de cobro configurado en
  su ficha, te llega un aviso para que completes ese monto a mano; de lo
  contrario esa primera sesión queda sin generar cargo.
- **Cobro vencido**: cuando un cobro pasa su fecha límite sin pago, te llega un
  aviso con el nombre del paciente (y se le envía un correo al paciente, o a su
  representante si es NNA, cuando hay email y el cobro tenía un enlace de
  pago). Si el cobro nunca llegó a tener enlace, por ejemplo porque el monto
  está bajo el mínimo de la pasarela, el aviso te llega igual a ti, pero no se
  le escribe al paciente: nunca se le pidió pagar.
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

Además de las notificaciones, la app envía correos de seguridad y de cuenta:
verificación de email, restablecimiento de contraseña, cambio de email (a la
casilla nueva y un aviso a la antigua) y aviso de desactivación del MFA con
código de recuperación.

> 📝 Observaciones UX: (¿el contador de no leídas se nota fácil? ¿los recordatorios llegan con tiempo suficiente para prepararte?)
>
>

---

## 12. Conectar tu Google Calendar (opcional)

Desde "Seguridad" puedes conectar tu cuenta de Google para que tus consultas
aparezcan automáticamente en tu Google Calendar personal, con el botón
"Conectar con Google Calendar". Una vez conectada, la misma tarjeta muestra
"Conectado" y el botón "Desconectar". El Calendario de Umbral (ver sección
14) muestra el estado de la conexión y enlaza a esta pantalla.

- Es **por cuenta**, no por sesión: conectas una vez y queda activo hasta
  que lo desconectes.
- El evento que se crea en Google **no muestra el nombre completo del
  paciente**: solo sus iniciales, un código corto que no revela más datos,
  y un enlace de vuelta a Umbral. Tampoco incluye el motivo de consulta ni
  si la sesión es presencial o telemedicina. Dura lo mismo que la sesión.
- Los eventos son de **una sola dirección**: lo que edites en Google no
  modifica ni crea consultas en Umbral. Si corriges o eliminas una consulta
  en Umbral, el evento en Google se actualiza o se borra solo; lo contrario
  no ocurre. Lo mismo pasa con las consultas que se cancelan al emitir un
  informe de alta. La única lectura desde Google es opcional, la activa quien
  administra Umbral con `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` y está
  desactivada por defecto: si está activa, Umbral lee cada 30 minutos qué
  horarios tienes ocupados en tu Google Calendar, durante los próximos 60
  días, y los oculta en tu agenda pública, sin copiar sus títulos ni su
  contenido.
- Puedes desconectar en cualquier momento desde el mismo lugar. Los eventos
  ya creados en tu Google Calendar no se borran al desconectar.
- Si conectas **otra** cuenta de Google, Umbral no puede saber que cambió
  de cuenta: los eventos que ya estaban en la cuenta anterior quedan ahí y
  no se borran. Si quieres cambiar de cuenta, elimina esos eventos a mano.
- Si Google revoca el acceso por su cuenta (por ejemplo, cambiaste la
  contraseña de tu cuenta de Google), la conexión se marca como
  desconectada sola y te llega un aviso (ver sección 11). No vas a ver un
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
  semanal (qué días trabajas y en qué rango horario; puede ser distinto
  cada día, por ejemplo lunes a viernes de 9 a 17 y sábado de 10 a 14) y la
  duración de tus sesiones (entre 5 y 240 minutos; por defecto 50). Ahí mismo
  puedes cargar bloqueos puntuales de disponibilidad (un día completo, un
  horario parcial, o un rango de fechas, por ejemplo tus vacaciones) para que
  esos horarios no aparezcan disponibles.
- **Copia tu link.** En la misma pantalla de Perfil hay una tarjeta "Link de
  auto-agenda" con tu link público y un botón para copiarlo. Ya viene armado
  con tu nombre (por ejemplo, `.../book/juan-jose-martinez`) y listo para
  compartir por el canal que uses con tus pacientes (WhatsApp, email, etc.).
  Si cambias tu nombre en "Perfil", el link cambia con él: vuelve a copiarlo
  y compártelo de nuevo, porque el anterior deja de funcionar.
- **Qué ve el paciente.** Antes del calendario, ve tu foto de perfil (o tus
  iniciales si no subiste una), tu especialidad, tu bio y un link a tu sitio
  web, si los cargaste desde "Perfil" (ver sección 10). Después, entra sin
  necesidad de crear ninguna cuenta ni loguearse: ve los horarios libres
  respetando tu horario, tus bloqueos, los feriados y las consultas que ya
  tienes agendadas, elige un día y un horario y completa un formulario corto
  (nombre, RUT, fecha de nacimiento y email) para pulsar "Confirmar reserva".
  Si el email coincide con un paciente adulto que ya tienes registrado **y el
  RUT también coincide con el de su ficha**, la reserva se liga
  automáticamente a esa ficha; si es alguien nuevo, se crea una ficha nueva
  con esos datos mínimos. Si el email existe pero el RUT no coincide, o la
  ficha es de un NNA o tiene el tratamiento cerrado, no se crea nada y quien
  reservó ve la misma pantalla de confirmación que una reserva nueva, para que
  nadie pueda averiguar quién es tu paciente. Si esa ficha tiene email, ese
  email recibe un aviso genérico de que la solicitud no pudo completarse (no
  nombra a quién se pidió la hora ni qué dato falló). Por eso, si un paciente
  tuyo dice que reservó y no ve la hora en tu agenda, revisa que haya escrito
  bien su RUT y su email.
- **Qué queda en tu lista de consultas.** La sesión reservada aparece con el
  motivo "Reserva pública en línea" y la intervención "Pendiente de definir
  por el terapeuta", como sesión presencial. Corrígela después con lo que
  corresponda (ver sección 4).
- **Reserva para un NNA.** El formulario tiene la opción "Reservo
  para un NNA", que pide además los datos del representante legal.
  El detalle de cómo se identifica al NNA y qué queda registrado está en la
  sección 3 ("Pacientes NNA y representante legal").
- **Pago al reservar.** Si el paciente que reserva ya tiene un monto de
  sesión en su ficha y tu cuenta Flow está conectada, al confirmar la reserva
  puede ver el botón "Pagar ahora" para ir a pagar de inmediato; si el link
  aún no está listo, la página indica que se le enviará por email. Las fichas
  nuevas creadas por la agenda pública no tienen monto de sesión (ver sección
  11).
- **De dónde vino el paciente.** Si alguien llega a tu link con parámetros de
  campaña (`utm_source`) o desde un link compartido en otra página, Umbral
  guarda ese origen junto con la ficha nueva. En el Dashboard tienes una
  sección "Origen de pacientes" con el desglose por origen: el valor de
  `utm_source` si lo hay, si no el sitio desde donde llegó, y "directo" si no
  hay ninguno de los dos. Los pacientes que registras tú a mano (y los
  creados antes de esta función) aparecen aparte, como "Registro manual".
- **Ventana de reserva.** Solo se puede reservar con al menos 24 horas de
  anticipación (para que siempre tengas tiempo de verla) y hasta 60 días
  hacia adelante: no vas a ver reservas de último minuto ni agendadas a
  meses vista.
- **Si dos personas eligen el mismo horario a la vez**, solo la primera
  reserva se concreta; a la segunda persona la app le avisa que ese horario
  ya no está disponible y le muestra los horarios libres actualizados.
- **Limitación actual: no se envía ningún email de confirmación de la
  reserva**, ni al paciente que reservó ni a ti como aviso de que tienes una
  sesión nueva. La sesión sí queda agendada y aparece en tu lista de
  consultas (y en tu Google Calendar si lo tienes conectado, ver sección 12),
  pero por ahora tienes que entrar a la app para enterarte de una reserva
  nueva.

> 📝 Observaciones UX: (¿te resultó claro cómo configurar tu horario? ¿el
> link se encuentra fácil en Perfil? ¿probaste el flujo completo como si
> fueras un paciente?)
>
>

---

## 14. Dashboard y Calendario

### Dashboard

Es la pantalla a la que entras después de iniciar sesión. Muestra cuatro
contadores que llevan a la sección correspondiente al hacer clic: **Pacientes
activos**, **Consultas registradas**, **Consentimientos firmados** (pacientes
con al menos uno de los dos consentimientos vigentes) y **Próximas sesiones**.
Debajo, **Pacientes recientes** (los últimos cinco, con el enlace "Ver todos")
y **Origen de pacientes** (ver sección 13). Si una estadística no se puede
cargar, la app lo avisa en vez de mostrar un cero.

### Calendario

Muestra la agenda mensual de tus sesiones, con botones para ir al mes
anterior o siguiente. Al hacer clic en un día se abre el detalle con las
sesiones de ese día (paciente, hora y tipo de sesión) y el botón **Agendar
sesión**, que abre el mismo formulario de consulta de la sección 4 con la
fecha elegida. Arriba a la derecha, una etiqueta indica el estado de Google
Calendar ("conectado", "desconectado" o "sin configurar") y enlaza a
"Seguridad".

> 📝 Observaciones UX:
>
>

---

## Notas generales de UX (espacio libre)

>
>
>
