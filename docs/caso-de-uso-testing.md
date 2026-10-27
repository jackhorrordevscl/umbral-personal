# Caso de uso: un día con Umbral

> Guía para quienes se ofrecieron como voluntarios a probar la app antes de que la usen pacientes de verdad. Gracias por el sacrificio, de verdad. Testear software no es glamoroso, pero cada bug que encuentres aquí es un bug que nunca le va a pasar a un terapeuta con un paciente real esperando al otro lado de la pantalla.

## Por qué esto importa (y no es solo "hacer clic por hacer clic")

Esta no es una app de e-commerce donde lo peor que puede pasar es un carrito de compras roto. Aquí adentro va a vivir información clínica real, de personas reales, protegida por ley. Si algo falla (un botón que no guarda, un dato que se pierde al recargar, un mensaje de error que no se entiende), en producción eso significa una sesión clínica mal registrada o un terapeuta bloqueado a mitad de una atención.

Tu trabajo hoy no es "usar la app": es **tratar de romperla a propósito**, de la forma en que la rompería un día real y desordenado, con interrupciones, errores de tipeo, decisiones a medio camino. Cuanto más "caótico" seas probando, más útil es tu reporte.

Un detalle importante: Umbral es una app **individual**, tu cuenta es tuya y solo tuya, sin roles ni jerarquías. No vas a tener una segunda cuenta "de otro tipo" para probar; todo lo que hagas hoy es con la única cuenta que crees.

Menú lateral que vas a usar: **Dashboard**, **Pacientes**, **Consultas**, **Calendario**, **Repositorio**, **Pagos**, **Perfil** y **Seguridad**.

---

## La historia: un día de la Dra. Constanza

Vas a encarnar a una terapeuta ficticia. Sigue la historia paso a paso, en el orden que aparece: no saltes partes, porque algunos pasos dependen de los anteriores.

### 8:45 · Antes de empezar: crea tu cuenta

Si todavía no tienes una cuenta, créala ahora: en el login, haz clic en "Regístrate", completa nombre completo, email, contraseña (mínimo 8 caracteres), confirmación de la contraseña y el código de invitación que te compartieron (sin él el registro se rechaza, issue #124), y confirma el enlace que te llega por correo (revisa spam si no aparece en unos minutos). Sin este paso no vas a poder loguear.

> 📝 Anota: ¿el mensaje de "revisa tu email" te dejó claro qué esperar? ¿el enlace de verificación funcionó al primer clic?

### 9:00 · Llegas a trabajar

Inicia sesión en Umbral. En tu primer login exitoso, la app te va a pedir activar MFA: es obligatorio para toda cuenta, no hay forma de saltarlo. Escanea el código QR con tu app autenticadora (Google Authenticator, Authy, o similar) y confirma el código de 6 dígitos.

**Antes de seguir, guarda los 10 códigos de recuperación** que la pantalla te muestra justo después: se muestran una única vez. Anótalos en un gestor de contraseñas o imprímelos (hay un botón "Copiar todos los códigos"; al terminar, "Ya guardé mis códigos"); los vas a necesitar más adelante si alguna vez pierdes el celular con tu app autenticadora.

Al terminar entras al **Dashboard**.

> 📝 Anota: ¿el login se sintió confuso en algún paso? ¿quedó claro que esos 10 códigos no se vuelven a mostrar? ¿el mensaje de error, si te equivocaste de contraseña a propósito, te dijo algo útil?

### 9:15 · Tu primera paciente nueva: Antonia

En **Pacientes**, pulsa "Nuevo paciente" y carga a **Antonia Belén Espinoza Morales** (perfil #3 de la lista de pacientes ficticios que ya tienes). Es NNA (niños, niñas y adolescentes), a propósito, para ver cómo se comporta el formulario con ese caso.

Deja el teléfono y el email en blanco, tal como indica el perfil. Al ingresar la fecha de nacimiento, el formulario debería avisarte que el representante legal se agrega desde la ficha, después de guardarla.

Después de guardar, la fila de Antonia debería mostrar "Sin consentimiento" y la etiqueta "NNA sin representante".

> 📝 Anota: ¿el formulario te dejó guardar sin esos campos sin quejarse? ¿hubo alguna validación rara relacionada con la edad? ¿se entendió el aviso sobre el representante?

### 9:20 · El consentimiento incómodo

Antes de la primera sesión, tienes que registrar los consentimientos de Antonia. Su madre autoriza el consentimiento de **tratamiento** (en pantalla aparece como **Presencial**) sin dudar, pero pide tiempo para pensar la modalidad de **Telemedicina**: prefiere que, por ahora, las sesiones sean presenciales. Como Antonia es NNA, el consentimiento lo otorga su representante, no ella.

- Abre el detalle de Antonia ("Ver detalle"). En la sección **Representantes legales**, pulsa "Agregar representante": nombre y RUT de la madre, relación "Madre", **sin email** a propósito (lo agregarás más adelante), y deja marcadas "Puede otorgar consentimiento", "Es el pagador", "Recibe comunicaciones" y "Puede acceder a informes".
- Ve a la pestaña **Editar**, marca **Presencial**, elige a la madre en "Representante que otorga el consentimiento" y escribe el motivo de la modificación (mínimo 10 caracteres), por ejemplo "Autorización firmada por la madre en admisión". Ese texto queda como evidencia.
- **No** otorgues **Telemedicina**: déjalo sin marcar.
- Vuelve a la pestaña **Detalle**: el aviso ámbar de NNA sin representante debería haber desaparecido y el consentimiento **Presencial** debería figurar con ✓ (**Telemedicina** sigue "Pendiente").

> 📝 Anota: ¿quedó claro en la pantalla que "Presencial" y "Telemedicina" son dos consentimientos independientes? ¿se entendió que el consentimiento de una paciente NNA lo da su representante? (Más adelante, comprueba que la app deja registrar una consulta por telemedicina aunque solo exista el consentimiento Presencial: basta cualquiera de los dos.)

### 9:30 · La primera sesión

En **Consultas**, pulsa "Nueva consulta" y registra una sesión para Antonia (puedes buscar a la paciente por nombre o RUT):
- Fecha y hora de la sesión: hoy, a la hora actual o una cercana
- Motivo de consulta: "Primera sesión de evaluación"
- Intervención realizada: "Entrevista clínica inicial con la madre presente"
- Tipo de sesión: Presencial

Pulsa "Guardar sesión". La sesión debería aparecer en el historial de Antonia.

### 9:45 · Te interrumpen (a propósito)

Justo cuando ibas a subir un documento a la ficha de Antonia, dejas la pestaña abierta y no tocas nada (ni el mouse ni el teclado) por **8 minutos reales** (pon un timer). Pasado ese tiempo debería aparecer el aviso "Sesión por expirar" con una cuenta regresiva de 2 minutos.

- Primero, pulsa "Continuar sesión": el aviso debería desaparecer y la sesión seguir activa.
- Luego repite los 8 minutos de inactividad y esta vez deja que la cuenta regresiva llegue a 0: la sesión debería cerrarse sola y llevarte al login. Vuelve a entrar (al volver a iniciar sesión tras un cierre por inactividad caes en el Dashboard).
- Opcional, en el celular: abre la app, bloquea la pantalla o cambia a otra app durante más de 10 minutos y vuelve. La sesión debería haberse cerrado directamente, sin mostrar el aviso. Si vuelves entre los 8 y los 10 minutos, debería aparecer el aviso con su cuenta regresiva.

> 📝 Anota: ¿te avisó antes de cerrar la sesión? ¿el aviso te dio tiempo suficiente para reaccionar, o se sintió apurado? ¿perdiste algo de lo que estabas escribiendo?

### 10:00 · Vuelves a entrar y te das cuenta de un error

Al revisar la consulta que registraste, te das cuenta de que pusiste "Presencial" pero la sesión fue en realidad por telemedicina. **Corrígela** (no la borres ni crees una nueva): usa el ícono de lápiz de la sesión, cambia el "Tipo de sesión" a Telemedicina y pulsa "Guardar corrección". El formulario de corrección no pide motivo del cambio.

La sesión debería mostrar ahora el chip "Telemedicina" y una marca "1 corrección", y "Ver historial de correcciones (1)" debería mostrar la versión original, "Presencial", con quién la corrigió y cuándo.

> 📝 Anota: al mirar el historial de esa consulta después, ¿quedó visible la versión original con el error, o parece que "desapareció"? ¿te quedó claro cuál versión es la vigente?

### 10:15 · Un segundo paciente, con historia clínica más cargada

Carga a **Jorge Luis Ramírez Peña** (perfil #4, el adulto mayor con el email con tilde). Al crearlo, marca el consentimiento **Presencial**. Después abre su ficha, ve a **Editar**, marca también **Telemedicina** y escribe un motivo distinto, así cada consentimiento queda con su propia evidencia. Súbele un documento en "Documentos legales" (elige el tipo, pulsa "Subir"; un PDF cualquiera, o una foto tuya guardada como .jpg).

Intenta también subir un archivo de un tipo no permitido (un .txt, por ejemplo; solo se aceptan PDF, Word, Excel, ZIP e imágenes), a propósito, para que falle. Si te sobra un archivo de más de 25 MB, prueba también el límite de tamaño.

Por último, anula el documento que subiste con el botón "Anular": la app debería pedirte un motivo obligatorio (entre 5 y 500 caracteres). El documento debería quedar marcado como "Anulado", con el motivo visible, y seguir pudiendo descargarse. Como era el único documento de ese tipo, si sustentaba un consentimiento, ese consentimiento debería quedar revocado en el historial.

> 📝 Anota: ¿el mensaje de error del archivo rechazado fue claro, o quedaste sin saber por qué no subió? ¿se entendió que anular no borra el documento?

### 10:30 · Exportas la ficha

Genera el PDF de la ficha de Jorge (ícono "Descargar PDF" de la lista, o el botón del detalle). Revisa que tenga la consulta con su historial (si le hiciste una corrección, que se note), los datos que cargaste, y el pie de página legal.

> 📝 Anota: ¿el PDF se ve profesional? ¿falta algo que tú esperarías ver en una ficha clínica real?

### 10:35 · Conectas tu cuenta Flow y cobras tu primera sesión

Antes de poder cobrarle a un paciente necesitas conectar tu cuenta Flow. Entra
a "Pagos" en el menú lateral y sigue el asistente de conexión de Flow:

- **Primero, a propósito, pon una llave o un secreto inválidos** (cualquier
  texto que no sea una credencial real de Flow) y pulsa "Validar credenciales".
  Debería rechazarte antes de guardar nada.

  > 📝 Anota: ¿el mensaje de error te dijo que las credenciales son
  > inválidas, o algo genérico? ¿quedó algo guardado a pesar del error?

- Ahora repite el asistente con las credenciales de **sandbox** de Flow que
  te pasé aparte, hasta completar los 5 pasos (antes de empezar, ir a Flow,
  ubicar tus credenciales, pegarlas y validarlas, y confirmar con "Confirmar y
  conectar") y quedar con la cuenta conectada.

  > 📝 Anota: ¿los 5 pasos se sintieron claros? ¿en algún momento no supiste
  > si tenías que esperar o si algo había fallado?

Con la cuenta ya conectada, ve a la ficha de **Jorge Luis Ramírez Peña**
(perfil #4), pestaña **Editar**, y cárgale un "Monto de sesión por defecto
(CLP)" (por ejemplo 20000; recuerda escribir el motivo de la modificación).
Después registra una nueva consulta para él.

> 📝 Anota: ¿se generó un cobro pendiente automáticamente al guardar la
> consulta? ¿te llegó (o le llegó a la casilla de prueba de Jorge) un email
> con el link de pago?

La sesión debería mostrar el chip "Cobro pendiente" y los botones "Copiar
link de pago", "Reenviar link de pago" y "Generar nuevo link". Prueba cada
uno: el último pide confirmación y, si continúas, anula el link actual y
envía uno nuevo.

Abre el link de pago que se generó y complétalo con los datos de tarjeta de
prueba de Flow que te pasé aparte, como si fueras el paciente pagando.

> 📝 Anota: ¿la pantalla de pago de Flow se veía confiable? ¿después de
> pagar, volviste a Umbral (a la página "Pago recibido") o quedaste en una
> pantalla sin salida? ¿el cobro pasó a "Pagado" en Umbral?

Ahora usa a **Antonia Belén Espinoza Morales** (perfil #3, cuya madre dejaste
sin email en el paso de las 9:20). Cárgale también un monto de sesión por
defecto y registra una consulta para ella. Como es NNA y no hay ningún
representante con email, el cobro debería quedar creado **sin link de pago**:
la sesión muestra un chip "Cobro no generado" con el motivo, y el botón
"Reintentar cobro". Luego edita a la madre en "Representantes legales",
agrégale un email y pulsa "Reintentar cobro": ahora debería generarse el link y
enviarse a ese email.

> 📝 Anota: ¿quedó claro en algún lado por qué el cobro no se generó (NNA
> sin representante con email)? ¿el botón de reintentar fue fácil de
> encontrar y funcionó?

Por último, para ver el monto mínimo de Flow (350 CLP), crea un paciente
adulto de prueba con un monto de sesión menor a 350 y registra una consulta:
el cobro debería quedar como "Cobro no generado" con un motivo que menciona el
mínimo. Ten en cuenta que "Reintentar cobro" usa el monto con el que el cobro
fue creado, así que no cambia el resultado si solo corriges el monto del
paciente después.

> 📝 Anota: ¿el mensaje de "Cobro no generado" explicó el motivo? ¿esperabas
> poder corregir el monto desde algún lado? (La cancelación de un cobro no
> tiene botón: ocurre sola al borrar una ficha o al emitir un informe de alta,
> y se prueba en las secciones finales.)

### 10:40 · Pruebas tu link de auto-agenda, haciéndote pasar por un paciente

Antes de que un paciente real use esto, pruébalo tú misma jugando los dos
roles. Primero, como Dra. Constanza: entra a "Perfil" y configura tu
horario semanal (elige un par de días y un rango horario cualquiera, por
ejemplo lunes a viernes de 9 a 18) y la duración de tus sesiones. Copia tu
link público de agenda con el botón de copiar de la tarjeta "Link de
auto-agenda".

Ahora, para probar de verdad como lo vería un paciente (sin tu sesión de
terapeuta interfiriendo), abre una **ventana de incógnito** y pega el link
ahí.

- Deberías ver los horarios libres respetando el horario que acabas de
  configurar, sin necesidad de loguearte con nada. Solo se ofrecen horarios
  con al menos 24 horas de anticipación y hasta 60 días hacia adelante.
- Elige un día y un horario y completa el formulario con datos de un paciente
  **nuevo** que no tengas cargado todavía (nombre, RUT, fecha de nacimiento
  y un email cualquiera que no hayas usado antes).
- Pulsa "Confirmar reserva".

Vuelve a tu pestaña normal (la logueada como Dra. Constanza) y revisa tu
lista de consultas: la sesión reservada debería aparecer ahí (con el motivo
"Reserva pública en línea" y la intervención "Pendiente de definir por el
terapeuta"), y ese paciente nuevo debería figurar ahora en tu lista de
pacientes con solo los datos mínimos del formulario público (sin monto de
sesión configurado, sin consentimientos cargados: eso te toca completarlo a
ti, por ejemplo con "Declarar consentimiento retroactivo" en la lista de
pacientes). Deberías tener además una notificación de "paciente autoagendado
sin monto de cobro".

Pruebas extra, también en la ventana de incógnito:
- Reserva usando el email de Jorge pero un RUT distinto: debería aparecer el
  mensaje genérico de "no fue posible procesar la reserva".
- Reserva marcando "Reservo para un NNA" e ingresando los datos del
  paciente y de su representante: debería crearse la ficha del NNA con ese
  representante.
- Intenta reservar el mismo horario desde dos ventanas: solo la primera debería
  concretarse.

> 📝 Anota: ¿el paso de elegir horario y completar el formulario se sintió
> tan simple como esperarías que le resultara a un paciente real, sin
> ningún tipo de ayuda tuya? ¿te llegó algún email avisándote de la reserva
> nueva (no debería), o tuviste que entrar a la app para enterarte?

### 10:42 · Revisas el Dashboard y el Calendario

Entra al **Dashboard**: deberías ver los contadores "Pacientes activos",
"Consultas registradas", "Consentimientos firmados" y "Próximas sesiones",
además de "Pacientes recientes" y "Origen de pacientes" (el paciente que
reservó por tu link, sin parámetros de campaña ni sitio de origen, debería
aparecer ahí como "directo"; los pacientes que cargaste a mano aparecen como
"Registro manual"). Haz clic en un
contador para comprobar que te lleva a la sección correspondiente.

Luego entra a **Calendario**: navega al mes anterior y al siguiente, abre un
día con sesiones y comprueba que muestra paciente, hora y tipo de sesión;
usa "Agendar sesión" desde un día para crear otra consulta. Arriba a la
derecha, la etiqueta de Google Calendar debería enlazar a "Seguridad".

> 📝 Anota: ¿los contadores coinciden con lo que cargaste? ¿el calendario
> mostró todas las sesiones de cada día?

### 10:45 · Revisas tu Perfil y tu Seguridad

Antes de cerrar el día, entra a "Perfil" y a "Seguridad" (menú lateral) y prueba estas cosas:

- En "Perfil", cambia tu nombre (no pide contraseña) y confirma que se actualiza; fíjate que el link de auto-agenda cambia con tu nombre.
- En "Perfil", completa tu perfil público (especialidad, bio y un sitio web que empiece con https://) y abre tu link de auto-agenda en una ventana de incógnito para ver cómo se muestra.
- En "Perfil", completa "Datos profesionales" con tu RUT (lo vas a necesitar para el informe de alta).
- Mira la campana de notificaciones: deberías tener al menos una notificación si programaste una consulta cerca de las 24h o 2h de anticipación. Márcala como leída.
- En "Seguridad", revisa el "Historial de seguridad" (debería mostrar la activación del MFA, con fecha y dispositivo).
- En "Seguridad", si tienes una cuenta de Google a mano, prueba "Conectar con Google Calendar" y revisa que la consulta de Antonia o Jorge aparezca ahí; fíjate que **no** muestre el nombre completo del paciente, solo iniciales y un código. Si no tienes cuenta de Google disponible, al menos revisa que el botón te lleve a la pantalla de permisos de Google (puedes cancelar ahí sin problema).

> 📝 Anota: ¿el cambio de nombre te dio alguna confirmación clara? ¿el evento en Google Calendar (si lo probaste) te pareció que exponía menos información de la que esperabas, o más?

### 11:00 · Cambias tu contraseña a propósito

Cambia tu contraseña desde "Perfil" (pide la contraseña actual, la nueva y su confirmación). Deberías quedar deslogueado de inmediato y tener que volver a entrar con la contraseña nueva. Si tienes la app abierta en otro navegador o en el celular, esa sesión también debería quedar invalidada.

> 📝 Anota: ¿el mensaje al desloguearte explicó por qué pasó, o se sintió como un error?

### 11:15 · El cierre del día

Cierra sesión manualmente (no esperes a que expire sola). Vuelve a entrar. Confirma que todo lo que hiciste sigue ahí: los pacientes, sus consultas, sus consentimientos, el documento subido (anulado).

---

## Si te queda tiempo: prueba la recuperación de cuenta

Esta es la parte más sensible de toda la app, es la única puerta de salida si pierdes la clave o el dispositivo MFA, así que vale la pena estresarla a propósito:

- **Olvidaste la contraseña**: cierra sesión, y desde el login haz clic en "¿Olvidaste tu contraseña?". Pide el enlace con tu email, revisa tu correo (el enlace vale 30 minutos), y restablece la contraseña. Después inicia sesión con la contraseña nueva: la vieja ya no debería funcionar.
- **Perdiste el dispositivo MFA**: desde la pantalla donde te pide el código de 6 dígitos, haz clic en "¿Perdiste el dispositivo MFA?" y usa uno de los 10 códigos de recuperación que guardaste en el paso de las 9:00. Confirma que MFA queda desactivado, que te llega un correo avisando de ello, que las demás sesiones abiertas se cierran, y que el próximo login te vuelve a pedir enrolarlo desde cero (nuevo QR, nueva tanda de códigos).
- **Código de segundo factor incorrecto varias veces**: en el login, ingresa un código de 6 dígitos equivocado a propósito. Tras 5 intentos fallidos la cuenta debería bloquearse un tiempo (1 minuto y luego esperas más largas) con el mensaje "Demasiados intentos fallidos. Intenta de nuevo en unos minutos."; con el código correcto, una vez pasada la espera, el login debería funcionar con normalidad.
- **Desactivar MFA desde Seguridad**: con MFA activo, ingresa un código válido de tu app y pulsa "Desactivar MFA". El próximo login debería pedirte activarlo de nuevo.

> 📝 Anota: ¿alguno de los flujos te dejó en un estado confuso (por ejemplo, sin saber si quedaste logueado o no)? ¿los mensajes de error, si probaste con datos incorrectos a propósito, fueron claros?

---

## Si te queda tiempo: cierra un tratamiento y emite un informe de alta

Antes de empezar, verifica que tu RUT esté cargado en "Perfil", en "Datos profesionales" (si falta, el formulario del informe te lo avisa con un enlace a tu perfil).

Usa a **Jorge Luis Ramírez Peña**, que ya tiene consentimiento. Para que la prueba de cancelación tenga algo que cancelar, registra antes una consulta futura para él.

- En el detalle de la ficha, sección **Cierre del tratamiento**, pulsa "Dar de alta" y elige "Generar con el sistema". Debería crearse un borrador prellenado con la fecha de ingreso, la fecha de cierre y el número de sesiones. Completa el motivo de consulta, el resumen de evolución, el estado al cierre y las recomendaciones, y prueba "Guardar borrador" y retomarlo.
- Elige el motivo de cierre (Alta, Derivado o Deserción; con Deserción debe pedirte un motivo de una lista) y pulsa "Emitir informe". Antes de confirmar, la app debería mostrarte la lista de consultas futuras que se cancelarán y advertir que no se puede deshacer.
- Tras emitir: el paciente debería mostrar la etiqueta del estado (por ejemplo "Alta"), la consulta futura debería haber desaparecido del Calendario y de la lista de consultas, los horarios deberían volver a estar libres en la agenda pública, y una reserva pública de Jorge debería rechazarse con el mensaje genérico. Si Jorge tiene email, debería recibir un correo avisando que sus consultas se cancelaron, sin el motivo del cierre.
- En el informe emitido, descarga el PDF (debería llevar la huella SHA-256 en el pie) y pulsa el ícono de verificar: debería indicar que el informe coincide con la huella original.
- Prueba "Corregir": debería crearse una versión nueva y la anterior quedar como "Reemplazada".
- Pulsa "Registrar entrega" en el bloque **Entregas** y registra la entrega al paciente (canal y finalidad, sin datos clínicos). Intenta luego una entrega a un **Tercero** sin haber subido antes un documento de tipo "Autorización de entrega de informe": no debería dejarte avanzar. Sube el documento y repite: ahora debe pedirte marcar la casilla de que revisaste la autorización.
- Por último, registra una nueva consulta para Jorge: la app debería pedirte confirmar con "Reabrir y agendar", y el informe anterior debería quedar como "Histórico · Paciente reabierto".

> 📝 Anota: ¿se entiende la diferencia entre generar el informe y subir tu propio PDF? ¿quedó claro que el sistema no envía el informe por correo? ¿la advertencia de las consultas que se cancelan fue clara?

---

## Si te queda tiempo: prueba borrar una ficha con un cobro pendiente

Antes de este paso, asegúrate de tener al menos un paciente con un cobro
**pendiente** sin pagar (por ejemplo, crea un paciente nuevo con monto de
sesión configurado, registra una consulta y no pagues el link). Usa un
paciente al que no hayas dado de alta, porque el alta también cancela los
cobros pendientes.

Elimina la ficha de ese paciente (soft delete, con confirmación). Después,
intenta abrir el link de pago pendiente que habías generado para él.

> 📝 Anota: ¿el link te dejó pagar igual después de borrar la ficha, o te
> avisó que ya no era válido? ¿el cobro aparecía como cancelado en algún
> lado antes de intentar pagarlo?

---

## Dónde anotar lo que encontraste

No hace falta que escribas un informe formal. Elige lo que te resulte más cómodo:

1. **Directo en el manual de uso (PDF o `docs/manual-terapeutas.md`)**, en los espacios "📝 Observaciones UX" de cada sección, así queda todo junto y ordenado por tema.
2. **Una lista simple** con capturas de pantalla de lo que te pareció raro, enviada a quien coordina las pruebas.
3. **Contándolo en la conversación**, como vienes haciendo: se revisa contra el código para confirmar si es comportamiento esperado o un bug real.

Lo único que se pide: **no te autocensures pensando "esto seguro es normal"**. Si algo te generó duda, anótalo. Es preferible descartar 10 falsas alarmas que dejar pasar 1 bug real con datos clínicos de por medio.

Gracias de nuevo por tu colaboración.
