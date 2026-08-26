// sdd/google-calendar-integration: valores fijos del módulo, centralizados
// acá para que design.md quede como única fuente de verdad de cada número
// (ver design.md "File Changes" -> calendar-integration.constants.ts).
// Consumidos recién por completo en PR 2 (CalendarSyncService); PR 1 solo usa
// STATE_TTL_MS y GOOGLE_CALENDAR_SCOPE (OAuth + custodia del token).

// design.md "Confirmed Decisions" (proposal.md): backfill acotado a 90 días
// desde la conexión -- implementado en PR 2.
export const BACKFILL_WINDOW_DAYS = 90;

// design.md "Data Flow": tope de conexiones/links procesados por corrida del
// reconciler, para no barrer la tabla completa en un solo tick -- PR 2.
export const RECONCILE_BATCH_LIMIT = 200;

// Consultation no tiene columna de duración (design.md "Minimized event
// body, fixed 50-minute duration") -- PR 2.
export const DEFAULT_SESSION_MINUTES = 50;

// design.md "The OAuth callback is unauthenticated; identity travels in a
// signed, single-use state": ventana de validez del JWT de `state` (10
// minutos), usada tanto para firmar el JWT como para el `stateExpiresAt`
// persistido en GoogleCalendarConnection.
export const STATE_TTL_MS = 10 * 60 * 1000;

// design.md "Data Flow": zona horaria de los eventos creados en Google
// Calendar -- PR 2 (GoogleCalendarClient).
export const CALENDAR_TIME_ZONE = 'America/Santiago';

// proposal.md "Business Rules": único scope solicitado, nunca uno más amplio
// (nunca 'email'/'profile'/'openid') -- ver design.md "OAuth scope |
// calendar.events only, offline access".
export const GOOGLE_CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.events';

// design.md "The OAuth callback is unauthenticated...": purpose fijo del JWT
// de `state`, para que JwtStrategy.validate (jwt.strategy.ts) pueda rechazar
// este token como Bearer de sesión igual que 'password-reset'/'mfa-setup'.
export const OAUTH_STATE_PURPOSE = 'google-calendar-oauth';
