# ADR 0008 - Reserva pública: respuesta uniforme ante colisión de identidad

- **Estado:** aceptada
- **Fecha:** 2026-10-17
- **Ramas:** `worktree-fix-jd-oraculo-reserva-publica` (PR #503, issue #502)

## Contexto

`POST /public/therapists/:ref/availability/book` es anónimo: no hay cuenta, OTP
ni sesión. Hasta este cambio respondía `409` cuando el email o el RUT enviado ya
pertenecía a un paciente del terapeuta y `201` cuando no. Esa diferencia le
decía a cualquiera si una persona se atiende con un profesional de salud mental,
que es dato de salud (Ley 21.719). Cada sondeo negativo, además, dejaba un
paciente y un slot basura en la agenda del terapeuta.

La pasada transversal del judgment-day lo marcó como el hallazgo severo de la
revisión, con coincidencia de los dos jueces.

## Decisión

### 1. Responder igual que una reserva nueva

Toda colisión de identidad con una ficha existente (email con RUT distinto,
NNA sin representante coincidente, tratamiento cerrado, email ambiguo, RUT ya
registrado, email de NNA ya registrado, carrera al crear, y DV inválido del
paciente) responde `201` con la misma forma que una reserva nueva: `id` y
`groupId` inventados, `sessionDate` del slot pedido y, si el checkout inline
está activo, `checkout: NOT_APPLICABLE` como un paciente autocreado. No se crea
consulta, slot, paciente, representante ni notificación, y no corre ningún
efecto posterior a la reserva.

Los rechazos que se deciden solo con el request, antes de leer cualquier dato
guardado (DV inválido del RUT del representante, horario ya no disponible,
tope diario), siguen siendo `409`/`429` porque no dependen de si la persona
existe.

### 2. Aviso por correo al titular

Cuando la ficha encontrada tiene email, se le envía un aviso de que una
solicitud de reserva con sus datos no pudo completarse. El texto no nombra al
terapeuta ni dice qué dato falló. Es la señal para el titular y, a la vez, la
vía de corrección si quien reservó era el propio paciente con un dato mal
escrito. No se envía si la ficha no tiene email.

### 3. El DV inválido también es un rechazo uniforme

El verificador independiente del PR encontró que dejar el DV inválido del
paciente como `409` común reabría el oráculo: un email registrado con un RUT de
DV inválido recibía `201` falso y uno desconocido recibía `409`. El frontend ya
valida el DV, así que solo un cliente que no es la UI llega a ese camino. Las
fichas existentes con DV inválido guardado siguen pudiendo autoagendarse con ese
mismo RUT (issue #289).

## Consecuencias

- Un paciente real que escribe mal su RUT ve la reserva como confirmada sin tener
  agenda. Solo el correo le avisa, y solo si su ficha tiene email. Se aceptó
  como costo de la respuesta uniforme frente a la alternativa de verificar el
  email antes de reservar, que agrega un paso a toda reserva pública.
- El aviso puede dispararse contra el email de un paciente registrado. Lo acota
  el throttler existente (10 POST por hora por IP y terapeuta); el contenido es
  inocuo.
- Queda un canal de tiempo: la reserva real escribe más que el rechazo. No se
  mitiga aquí; el throttler por IP lo acota.
- Cualquier validación nueva en la reserva pública debe ejecutarse antes de leer
  datos guardados, o rechazarse con la misma respuesta uniforme. El orden de las
  validaciones es parte del contrato de privacidad.
