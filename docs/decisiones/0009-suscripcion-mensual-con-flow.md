# ADR 0009 - Suscripción mensual con Flow

- **Estado:** aceptada
- **Fecha:** 2026-11-03
- **Ramas:** PR 1 a 5 de la issue #611 (#613 a #618 y el PR 5)

## Contexto

Antes de publicitar la app hace falta controlar el acceso con una suscripción
mensual. Hasta ahora el registro exigía un código de invitación y no existía
ningún control de pago. Los pagos que ya procesa la app (el terapeuta cobrando
a sus pacientes) usan las credenciales de Flow de cada terapeuta; la suscripción
de Umbral necesita credenciales propias de la plataforma.

El servicio corre hoy en un plan gratuito que duerme tras 15 minutos de
inactividad, así que ni los webhooks ni los crons son confiables como única
fuente de verdad.

## Decisión

### 1. Cobro

- Pago manual por período con Flow (`POST /billing/checkout`). Plan único; el
  precio vigente está en `SUBSCRIPTION_PRICE_CLP` (6990 CLP por defecto) y cada
  suscripción y cada pago guardan el monto con el que se cobraron, de modo que
  un cambio de precio solo afecta a las suscripciones nuevas.
- El precio de lanzamiento se mantiene 12 meses desde que se congela
  (`priceStartedAt`). Al cumplirse, el checkout cobra el precio
  post-lanzamiento (`SUBSCRIPTION_RENEWAL_PRICE_CLP`, 12990 CLP por defecto),
  nunca menos que el precio congelado de la cuenta. Se calcula al consultar, sin
  cron, y no reescribe `Subscription.priceClp`; cada pago guarda el monto
  cobrado. `GET /billing/status` informa el precio efectivo, `priceChangesAt`
  (fin del precio congelado, o null si ya terminó o no sube) y `nextPriceClp`
  (precio que se cobrará desde esa fecha). La pantalla de suscripción muestra
  "Desde el [fecha] el precio pasa a [precio] al mes" a quien puede pagar.
- Cada pago confirmado suma 30 días: `max(ahora, vencimiento actual) + 30 días`.
  Pagar antes de vencer no hace perder días.
- Las credenciales son de la plataforma (`SUBSCRIPTION_FLOW_API_KEY` y
  `SUBSCRIPTION_FLOW_SECRET_KEY`), no las cifradas de cada terapeuta.
- El acceso se concede solo cuando `getStatus` de Flow confirma el pago por el
  monto cobrado. Nunca por la respuesta de creación ni por el webhook en sí. El
  procesamiento es idempotente por `flowOrder`.
- Las suscripciones nativas de Flow (cobro automático con tarjeta inscrita)
  quedan para una V2.

### 2. Confirmación del pago: tres vías, una sola función

El webhook (`POST /billing/confirm`) puede perderse o llegar tarde, y en
desarrollo Flow no alcanza `localhost`. La documentación de Flow indica
consultar `payment/getStatus` tanto al recibir la confirmación como al recibir
al pagador en la URL de retorno, y permite hacerlo en cualquier momento. Por eso
hay tres vías, todas pasando por `BillingService.confirmByToken`, que verifica
con `getStatus` y es idempotente:

1. **Webhook** (`POST /billing/confirm`), público, que nunca confía en el
   cuerpo: solo recibe un `token` y vuelve a consultar a Flow.
2. **Al volver de Flow** (`POST /billing/refresh`), con sesión: la pantalla
   `/suscripcion/retorno` lo llama cada 5 segundos durante un minuto. Consulta
   solo los pagos pendientes recientes de la cuenta que llama (hasta 3), con un
   intervalo mínimo de 4 segundos por cuenta. No lanza si Flow no responde. Si la
   llamada falla, la pantalla cae a la lectura normal del estado.
3. **Barrido de respaldo** cada 30 minutos sobre pagos de entre 15 minutos y 3
   días.

El hallazgo que motivó la vía 2 salió de la prueba contra el sandbox real de
Flow: sin ella, un pago hecho con el webhook perdido dejaba la cuenta en solo
lectura hasta 45 minutos.

### 3. Estado de la cuenta calculado al leer

El estado (exenta, activa, en gracia o solo lectura) se calcula al consultar, a
partir de `currentPeriodEnd` y de las concesiones; nunca depende de un cron que
lo cambie. Los avisos de vencimiento (a los 5, 1 y 0 días, una vez por período,
por notificación y correo) son una ayuda: si un cron no corrió, el siguiente
avisa solo el más urgente y marca los anteriores sin enviarlos.

Aviso previo al cambio de precio: un único aviso, desde 30 días antes de que
termine el precio de lanzamiento (`priceChange` en `SubscriptionsService`), por
notificación (`SUBSCRIPTION_PRICE_CHANGE`) y correo. Lo reciben solo las cuentas
activas o en gracia cuyo precio sube; las exentas, las de solo lectura y las que
no ven subir el precio no reciben nada. La garantía de "una sola vez" es el
`@@unique(subscriptionId, priceChangeAt)` de `SubscriptionPriceNotice`. Si el
cron no corrió, el siguiente día avisa igual mientras el cambio siga pendiente.
Como los demás avisos, no corre con `SUBSCRIPTIONS_ENFORCED` apagado.

### 4. Al vencer

- 7 días de gracia y luego solo lectura.
- El interceptor global funciona con una lista de escrituras permitidas, no de
  bloqueadas, para que una función nueva nazca bloqueada. Siempre habilitado:
  ver fichas y sesiones, exportar PDF, atender la supresión de un paciente,
  consentimientos, entrega de un informe de alta ya emitido, contraseña, MFA,
  cierre de sesión y la pantalla de pago (`POST /billing/checkout` y
  `POST /billing/refresh`).
- Una cuenta en solo lectura debe poder llamar a `refresh`: justamente es la que
  acaba de pagar.

### 5. Registro, códigos promocionales y exenciones

- Con `SUBSCRIPTIONS_ENFORCED=true` el registro es abierto, con código
  promocional opcional que otorga un mes de prueba (códigos compartidos, con
  tope de canjes y vencimiento). Sin código, la cuenta nace en solo lectura.
- Las cuentas exentas se cargan por email con un script de línea de comandos
  (`backend/scripts/grant-subscription.ts <email> [--until YYYY-MM-DD]`, sin rol
  ADMIN), de forma permanente o hasta una fecha. La concesión se busca por email
  al calcular el estado, así que también vale para un email que aún no se
  registró.

### 6. Interruptor de despliegue

Todo el control de acceso va detrás de `SUBSCRIPTIONS_ENFORCED`. Se despliega
con el interruptor apagado, se cargan las exenciones de las cuentas actuales y
recién entonces se enciende. Como cambia un contrato, el backend se despliega
primero.

## Consecuencias

- El estado de una cuenta es correcto aunque ningún cron haya corrido, y un pago
  se refleja en segundos aunque el webhook no llegue.
- El intervalo mínimo de `refresh` vive en memoria de la instancia: acota el
  gasto de llamadas a Flow con la clave de la plataforma, no es una garantía.
  La seguridad la da `confirmByToken`, que ignora cualquier dato del cliente.
- Un usuario puede forzar consultas a Flow solo sobre sus propios pagos
  pendientes; no puede confirmar un pago que Flow no reporta pagado.
- Pendientes fuera del código antes de cobrar de verdad: inicio de actividades
  y modelo de emisión de boletas en el SII, cuenta de Flow de Umbral en
  producción, términos del servicio y los correos de las cuentas exentas.
