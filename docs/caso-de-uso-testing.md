# Caso de uso: un día con Umbral

> Guía para quienes se ofrecieron como voluntarios a probar la app antes de que la usen pacientes de verdad. Gracias por el sacrificio — de verdad. Testear software no es glamoroso, pero cada bug que encuentres acá es un bug que nunca le va a pasar a un terapeuta con un paciente real esperando al otro lado de la pantalla.

## Por qué esto importa (y no es solo "hacer clic por hacer clic")

Esta no es una app de e-commerce donde lo peor que puede pasar es un carrito de compras roto. Acá adentro va a vivir información clínica real, de personas reales, protegida por ley. Si algo falla — un botón que no guarda, un dato que se pierde al recargar, un mensaje de error que no se entiende — en producción eso significa una sesión clínica mal registrada o un terapeuta bloqueado a mitad de una atención.

Tu trabajo hoy no es "usar la app": es **tratar de romperla a propósito**, de la forma en que la rompería un día real y desordenado — con interrupciones, errores de tipeo, decisiones a medio camino. Cuanto más "caótico" seas probando, más útil es tu reporte.

---

## La historia: un día de la Dra. Constanza

Vas a encarnar a una terapeuta ficticia. Segui la historia paso a paso, en el orden que aparece — no saltes partes, porque algunos pasos dependen de los anteriores.

### 9:00 — Llegás a trabajar

Iniciás sesión en Umbral. *(Si tu cuenta es `ADMIN`/`SUPERVISOR`, te va a pedir activar MFA la primera vez — segui el proceso con tu app autenticadora.)*

> 📝 Anotá: ¿el login se sintió confuso en algún paso? ¿el mensaje de error, si te equivocaste de contraseña a propósito, te dijo algo útil?

### 9:15 — Tu primera paciente nueva: Antonia

Cargá a **Antonia Belén Espinoza Morales** (perfil #3 de la lista de pacientes ficticios que ya tenés). Es menor de edad — a propósito, para ver cómo se comporta el formulario con ese caso.

Dejá el teléfono y el email en blanco, tal como indica el perfil.

> 📝 Anotá: ¿el formulario te dejó guardar sin esos campos sin quejarse? ¿hubo alguna validación rara relacionada con la edad?

### 9:20 — El consentimiento incómodo

Antes de la primera sesión, tenés que registrar los consentimientos de Antonia. Su madre autoriza **Tratamiento**, pero **duda** sobre "Red de salud" — no quiere que la ficha se comparta con otros profesionales de la institución todavía.

- Otorgá el consentimiento de **Tratamiento** (evidencia: "Autorización firmada por la madre en admisión").
- **No** otorgues el de "Red de salud" — dejalo sin marcar.

> 📝 Anotá: ¿quedó claro en la pantalla que "Red de salud" es opcional y distinto de "Tratamiento"? ¿Si no marcás nada, la app te lo permite seguir sin bloquear el resto del flujo?

### 9:30 — La primera sesión

Registrá una consulta para Antonia:
- Motivo de consulta: "Primera sesión de evaluación"
- Intervención: "Entrevista clínica inicial con la madre presente"
- Tipo de sesión: Presencial

### 9:45 — Te interrumpen (a propósito)

Justo cuando ibas a subir un documento a la ficha de Antonia, dejás la pestaña abierta y no tocás nada por **10 minutos reales** (poné un timer). Volvé después de ese tiempo.

> 📝 Anotá: ¿te avisó antes de cerrar la sesión? ¿el aviso te dio tiempo suficiente para reaccionar, o se sintió apurado? ¿perdiste algo de lo que estabas escribiendo?

### 10:00 — Volvés a entrar y te das cuenta de un error

Al revisar la consulta que registraste, te das cuenta de que pusiste "Presencial" pero la sesión fue en realidad por telemedicina. **Corregila** (no la borres ni crees una nueva) — el motivo del cambio: "Corrección: la sesión fue telemática, no presencial".

> 📝 Anotá: al mirar el historial de esa consulta después, ¿quedó visible la versión original con el error, o parece que "desapareció"? ¿te quedó claro cuál versión es la vigente?

### 10:15 — Un segundo paciente, con historia clínica más cargada

Cargá a **Jorge Luis Ramírez Peña** (perfil #4 — el adulto mayor con el email con tilde). Otorgale los tres consentimientos, con evidencia distinta para cada uno. Subile un documento (un PDF cualquiera, o una foto tuya guardada como .jpg).

Intentá también subir un archivo que **no** sea PDF ni imagen (un .docx, por ejemplo) — a propósito, para que falle.

> 📝 Anotá: ¿el mensaje de error del archivo rechazado fue claro, o quedaste sin saber por qué no subió?

### 10:30 — Exportás la ficha

Generá el PDF de la ficha de Jorge. Revisá que tenga la consulta con su historial (si le hiciste una corrección, que se note), los datos que cargaste, y el pie de página legal.

> 📝 Anotá: ¿el PDF se ve profesional? ¿falta algo que vos esperarías ver en una ficha clínica real?

### 10:45 — El cierre del día

Cerrá sesión manualmente (no esperes a que expire sola). Volvé a entrar. Confirmá que todo lo que hiciste sigue ahí — los dos pacientes, sus consultas, sus consentimientos, el documento subido.

---

## Si tenés una cuenta de rol distinto a THERAPIST

Si además te dieron una segunda cuenta (`COORDINATOR`, `SUPERVISOR` o `ADMIN`), repetí esta parte:

- Entrá con esa segunda cuenta e intentá ver la ficha de Antonia o Jorge, que creaste con la cuenta de `THERAPIST`.
- Fijate qué pasa: ¿te deja ver todo, te bloquea, o depende del consentimiento "Red de Salud" que le diste (o no) a ese paciente? Con `SUPERVISOR`, probá también qué pasa si el paciente NO tiene ese consentimiento otorgado — deberías ver una opción de "acceso excepcional" que te pide escribir un motivo.
- `ADMIN` no debería poder ver la ficha bajo ningún caso — si te deja entrar, es un bug, avisalo.

> 📝 Anotá exactamente qué rol vio qué — esto es lo más sensible de toda la app (quién puede ver los datos de quién), así que cualquier cosa que te resulte "raro" acá, avisala aunque no estés seguro de si es un bug.

---

## Dónde anotar lo que encontraste

No hace falta que escribas un informe formal. Elegí lo que te resulte más cómodo:

1. **Directo en `docs/manual-terapeutas.md`**, en los espacios `📝 Observaciones UX` de cada sección — así queda todo junto y ordenado por tema.
2. **Una lista simple** con capturas de pantalla de lo que te pareció raro, y me la pasás.
3. **Contándomelo en la conversación**, como venís haciendo — yo lo reviso contra el código para confirmar si es comportamiento esperado o un bug real.

Lo único que te pido: **no te autocensures pensando "esto seguro es normal"**. Si algo te generó duda, anotalo. Prefiero descartar 10 falsas alarmas que dejar pasar 1 bug real con datos clínicos de por medio.

Gracias de nuevo por el martirio. En serio.
