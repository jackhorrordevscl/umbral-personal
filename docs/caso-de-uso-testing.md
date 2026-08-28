# Caso de uso: un día con Umbral

> Guía para quienes se ofrecieron como voluntarios a probar la app antes de que la usen pacientes de verdad. Gracias por el sacrificio — de verdad. Testear software no es glamoroso, pero cada bug que encuentres acá es un bug que nunca le va a pasar a un terapeuta con un paciente real esperando al otro lado de la pantalla.

## Por qué esto importa (y no es solo "hacer clic por hacer clic")

Esta no es una app de e-commerce donde lo peor que puede pasar es un carrito de compras roto. Acá adentro va a vivir información clínica real, de personas reales, protegida por ley. Si algo falla — un botón que no guarda, un dato que se pierde al recargar, un mensaje de error que no se entiende — en producción eso significa una sesión clínica mal registrada o un terapeuta bloqueado a mitad de una atención.

Tu trabajo hoy no es "usar la app": es **tratar de romperla a propósito**, de la forma en que la rompería un día real y desordenado — con interrupciones, errores de tipeo, decisiones a medio camino. Cuanto más "caótico" seas probando, más útil es tu reporte.

Un detalle importante: Umbral es una app **individual** — tu cuenta es tuya y solo tuya, sin roles ni jerarquías. No vas a tener una segunda cuenta "de otro tipo" para probar; todo lo que hagas hoy es con la única cuenta que crees.

---

## La historia: un día de la Dra. Constanza

Vas a encarnar a una terapeuta ficticia. Sigue la historia paso a paso, en el orden que aparece — no saltes partes, porque algunos pasos dependen de los anteriores.

### 8:45 — Antes de empezar: crea tu cuenta

Si todavía no tienes una cuenta, créala ahora: en el login, haz clic en "Regístrate", completa nombre, email y contraseña, y confirma el enlace que te llega por correo (revisa spam si no aparece en unos minutos) — sin este paso no vas a poder loguear.

> 📝 Anota: ¿el mensaje de "revisa tu email" te dejó claro qué esperar? ¿el enlace de verificación funcionó al primer clic?

### 9:00 — Llegas a trabajar

Inicia sesión en Umbral. En tu primer login exitoso, la app te va a pedir activar MFA — es obligatorio para toda cuenta, no hay forma de saltarlo. Escanea el código QR con tu app autenticadora (Google Authenticator, Authy, o similar) y confirma el código de 6 dígitos.

**Antes de seguir, guarda los 10 códigos de recuperación** que la pantalla te muestra justo después — se muestran una única vez. Anótalos en un gestor de contraseñas o imprímelos; los vas a necesitar más adelante si alguna vez pierdes el celular con tu app autenticadora.

> 📝 Anota: ¿el login se sintió confuso en algún paso? ¿quedó claro que esos 10 códigos no se vuelven a mostrar? ¿el mensaje de error, si te equivocaste de contraseña a propósito, te dijo algo útil?

### 9:15 — Tu primera paciente nueva: Antonia

Carga a **Antonia Belén Espinoza Morales** (perfil #3 de la lista de pacientes ficticios que ya tienes). Es menor de edad — a propósito, para ver cómo se comporta el formulario con ese caso.

Deja el teléfono y el email en blanco, tal como indica el perfil.

> 📝 Anota: ¿el formulario te dejó guardar sin esos campos sin quejarse? ¿hubo alguna validación rara relacionada con la edad?

### 9:20 — El consentimiento incómodo

Antes de la primera sesión, tienes que registrar los consentimientos de Antonia. Su madre autoriza **Tratamiento** sin dudar, pero pide tiempo para pensar la modalidad de **Telemedicina** — prefiere que, por ahora, las sesiones sean presenciales.

- Otorga el consentimiento de **Tratamiento** (evidencia: "Autorización firmada por la madre en admisión").
- **No** otorgues el de **Telemedicina** — déjalo sin marcar.

> 📝 Anota: ¿quedó claro en la pantalla que "Tratamiento" y "Telemedicina" son dos consentimientos independientes? ¿la app te avisa de algún modo si más adelante intentas registrar una consulta por telemedicina sin ese consentimiento otorgado, o simplemente lo permite sin decir nada?

### 9:30 — La primera sesión

Registra una consulta para Antonia:
- Motivo de consulta: "Primera sesión de evaluación"
- Intervención: "Entrevista clínica inicial con la madre presente"
- Tipo de sesión: Presencial

### 9:45 — Te interrumpen (a propósito)

Justo cuando ibas a subir un documento a la ficha de Antonia, dejas la pestaña abierta y no tocas nada por **10 minutos reales** (pon un timer). Vuelve después de ese tiempo.

> 📝 Anota: ¿te avisó antes de cerrar la sesión? ¿el aviso te dio tiempo suficiente para reaccionar, o se sintió apurado? ¿perdiste algo de lo que estabas escribiendo?

### 10:00 — Vuelves a entrar y te das cuenta de un error

Al revisar la consulta que registraste, te das cuenta de que pusiste "Presencial" pero la sesión fue en realidad por telemedicina. **Corrígela** (no la borres ni crees una nueva) — el motivo del cambio: "Corrección: la sesión fue telemática, no presencial".

> 📝 Anota: al mirar el historial de esa consulta después, ¿quedó visible la versión original con el error, o parece que "desapareció"? ¿te quedó claro cuál versión es la vigente?

### 10:15 — Un segundo paciente, con historia clínica más cargada

Carga a **Jorge Luis Ramírez Peña** (perfil #4 — el adulto mayor con el email con tilde). Otórgale los dos consentimientos (Tratamiento y Telemedicina), con evidencia distinta para cada uno. Súbele un documento (un PDF cualquiera, o una foto tuya guardada como .jpg).

Intenta también subir un archivo que **no** sea PDF ni imagen (un .docx, por ejemplo) — a propósito, para que falle.

> 📝 Anota: ¿el mensaje de error del archivo rechazado fue claro, o quedaste sin saber por qué no subió?

### 10:30 — Exportas la ficha

Genera el PDF de la ficha de Jorge. Revisa que tenga la consulta con su historial (si le hiciste una corrección, que se note), los datos que cargaste, y el pie de página legal.

> 📝 Anota: ¿el PDF se ve profesional? ¿falta algo que tú esperarías ver en una ficha clínica real?

### 10:45 — Revisas tus Ajustes de cuenta

Antes de cerrar el día, entra a "Ajustes" y prueba tres cosas:

- Cambia tu nombre (no pide contraseña) y confirma que se actualiza.
- Mira la campana de notificaciones: deberías tener al menos una notificación si programaste una consulta cerca de las 24h o 2h de anticipación. Márcala como leída.
- Si tienes una cuenta de Google a mano, prueba conectar Google Calendar y revisa que la consulta de Antonia o Jorge aparezca ahí — fíjate que **no** muestre el nombre completo del paciente, solo iniciales y un código. Si no tienes cuenta de Google disponible, al menos revisa que el botón "Conectar" te lleve a la pantalla de permisos de Google (puedes cancelar ahí sin problema).

> 📝 Anota: ¿el cambio de nombre te dio alguna confirmación clara? ¿el evento en Google Calendar (si lo probaste) te pareció que exponía menos información de la que esperabas, o más?

### 11:00 — Cambias tu contraseña a propósito

Cambia tu contraseña desde "Ajustes". Deberías quedar deslogueado de inmediato y tener que volver a entrar con la contraseña nueva.

> 📝 Anota: ¿el mensaje al desloguearte explicó por qué pasó, o se sintió como un error?

### 11:15 — El cierre del día

Cierra sesión manualmente (no esperes a que expire sola). Vuelve a entrar. Confirma que todo lo que hiciste sigue ahí — los dos pacientes, sus consultas, sus consentimientos, el documento subido.

---

## Si te queda tiempo: prueba la recuperación de cuenta

Esta es la parte más sensible de toda la app — es la única puerta de salida si pierdes la clave o el dispositivo MFA, así que vale la pena estresarla a propósito:

- **Olvidaste la contraseña**: cierra sesión, y desde el login haz clic en "¿Olvidaste tu contraseña?". Pide el enlace con tu email, revisa tu correo, y restablece la contraseña. Después inicia sesión con la contraseña nueva — la vieja ya no debería funcionar.
- **Perdiste el dispositivo MFA**: desde la pantalla donde te pide el código de 6 dígitos, haz clic en "¿Perdiste el dispositivo MFA?" y usa uno de los 10 códigos de recuperación que guardaste en el paso de las 9:00. Confirma que MFA queda desactivado y que el próximo login te vuelve a pedir enrolarlo desde cero (nuevo QR, nueva tanda de códigos).

> 📝 Anota: ¿alguno de los dos flujos te dejó en un estado confuso (por ejemplo, sin saber si quedaste logueado o no)? ¿los mensajes de error, si probaste con datos incorrectos a propósito, fueron claros?

---

## Dónde anotar lo que encontraste

No hace falta que escribas un informe formal. Elige lo que te resulte más cómodo:

1. **Directo en el manual de uso (PDF o `docs/manual-terapeutas.md`)**, en los espacios "📝 Observaciones UX" de cada sección — así queda todo junto y ordenado por tema.
2. **Una lista simple** con capturas de pantalla de lo que te pareció raro, y me la pasas.
3. **Contándomelo en la conversación**, como vienes haciendo — yo lo reviso contra el código para confirmar si es comportamiento esperado o un bug real.

Lo único que te pido: **no te autocensures pensando "esto seguro es normal"**. Si algo te generó duda, anótalo. Prefiero descartar 10 falsas alarmas que dejar pasar 1 bug real con datos clínicos de por medio.

Gracias de nuevo por el martirio. En serio.
