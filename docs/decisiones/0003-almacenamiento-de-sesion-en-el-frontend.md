# ADR 0003 - Almacenamiento de la sesión en el frontend

- **Estado:** aceptada
- **Fecha:** 2026-10-07
- **Issue:** #384
- **Nota de estado (2026-10-13):** la Content-Security-Policy del punto 2 de la decisión ya está en `frontend/vercel.json` (issue #386, PR #389 y #390), por lo que la afirmación "hoy no hay Content-Security-Policy" de la sección Contexto describe el estado del 2026-10-07. La migración a cookie `HttpOnly` sigue abierta en el issue #387.
- **Nota de estado (2026-10-14):** la migración a cookie `HttpOnly` del issue #387 está implementada; ver la sección "Implementación de #387" al final. Las secciones anteriores describen el estado y el razonamiento a la fecha de la decisión.
- **Nota de estado (2026-10-27):** el `Bearer` sigue siendo aceptado junto a la cookie (`JwtStrategy`); no se ha retirado. El CSRF ya no depende solo de `SameSite=Strict`: ver la nota en "Implementación de #387".

## Contexto

El frontend guarda el JWT de sesión y los datos del usuario en `localStorage`
(claves `token` y `user`; ver `frontend/src/context/AuthContext.tsx` y
`frontend/src/api/client.ts`). El cliente adjunta el token como
`Authorization: Bearer` en cada petición, y el backend lo extrae con
`ExtractJwt.fromAuthHeaderAsBearerToken()` (`jwt.strategy.ts`, hoy en
`backend/src/modules/auth/strategies/`).

El riesgo es que cualquier script que se ejecute en el origen del frontend
(XSS, dependencia comprometida) puede leer el token y usarlo desde fuera. La
aplicación maneja datos clínicos, así que el impacto de un robo de sesión es
alto.

Mitigaciones vigentes:

- Sanitización con DOMPurify antes de inyectar HTML
  (`ConsultationsPage.tsx`, `RichTextEditor.tsx`) y `sanitize-html` en el
  backend.
- Cierre por inactividad (`IdleManager`) y sincronización de logout entre
  pestañas.
- Sesiones revocables en el servidor (el JWT lleva `jti`, y `validate` consulta
  la base en cada petición).
- MFA obligatorio para terapeutas.
- `helmet()` en el backend. El frontend no define cabeceras propias
  (`vercel.json` solo tiene el rewrite a `index.html`), por lo que hoy no hay
  Content-Security-Policy.

## Alternativas evaluadas

| Alternativa | Qué resuelve | Costo |
| --- | --- | --- |
| **A. Mantener `localStorage` + CSP** | Reduce la superficie de XSS sin tocar el flujo de auth | Bajo: solo cabeceras en Vercel |
| **B. Cookie `HttpOnly` (token de sesión)** | El script no puede leer el token | Alto: ver abajo |
| **C. Access token en memoria + refresh en cookie `HttpOnly`** | Lo mismo que B, con ventana de exposición menor | Más alto: agrega refresh token, rotación y reintentos en el cliente |

Costo de B y C:

- **Backend:** emitir y limpiar la cookie en login, MFA y logout; leerla en
  `JwtStrategy`; conservar el `Bearer` mientras dure la migración.
- **CORS:** ya tiene `credentials: true`, pero el cliente tendría que enviar
  `credentials: 'include'` en todas las peticiones.
- **CSRF:** una cookie se envía sola, así que hace falta protección (token
  anti-CSRF o `SameSite` estricto). Hoy el `Bearer` no tiene este riesgo.
- **Dominios:** el frontend se sirve en `umbralrce.groundzerodevs.com` (Vercel) y
  la API en `umbralapi.groundzerodevs.com`, dominio propio vinculado a Render
  (detrás de Cloudflare; el subdominio `onrender.com` está desactivado). Ambos
  comparten el dominio registrable `groundzerodevs.com`, es decir, son
  *same-site*. Una cookie `SameSite=Lax` o `Strict` se envía igual desde el
  frontend a la API, así que no hace falta `SameSite=None` y el riesgo de CSRF
  entre sitios queda cubierto por el propio atributo. Esto abarata B y C
  respecto de un escenario cross-site.
- **Logout entre pestañas y cierre por inactividad:** hoy dependen de leer
  `localStorage`; habría que rediseñarlos.
- **Pruebas:** hay specs y e2e que fijan `token`/`user` en `localStorage`.

## Decisión

Para v1, **mantener `localStorage`** y endurecer con una CSP (alternativa A).
Migrar a cookie `HttpOnly` es viable (frontend y API son *same-site*) y queda
como mejora planificada posterior al freeze.

Concretamente:

1. No se cambia el mecanismo de sesión en v1.
2. Se abrió el issue #386 para añadir Content-Security-Policy en `vercel.json`
   (`script-src 'self'`, sin `unsafe-inline` si el build lo permite;
   `connect-src` limitado al API y a Sentry). Se probó primero en modo
   `Content-Security-Policy-Report-Only` (PR #389) y, tras recorrer las
   pantallas públicas y autenticadas sin violaciones, pasó a modo bloqueante.
   zod se configura con `jitless` para no requerir `unsafe-eval`.
3. Se mantiene como regla de revisión: todo HTML de usuario se sanitiza antes de
   inyectarse; no se agrega `dangerouslySetInnerHTML` sin DOMPurify.
4. Se reabre esta decisión (migración a B o C) si ocurre alguno de estos
   disparadores:
   - se incorpora contenido de terceros ejecutable en el frontend (widgets,
     analítica con scripts externos);
   - una auditoría o un cliente exige `HttpOnly`.

## Por qué

- Con `Bearer` no existe CSRF; pasar a cookie lo introduce. Al ser *same-site*,
  `SameSite=Strict` lo mitiga, pero sigue siendo superficie nueva que diseñar y
  probar (por ejemplo, subdominios de `groundzerodevs.com` que no controlemos).
- La CSP ataca la causa raíz del riesgo (que un script ajeno corra en el
  origen) por una fracción del costo, y también protege la alternativa B si se
  adopta después.
- Una cookie `HttpOnly` no impide que un XSS *use* la sesión mientras la
  pestaña está abierta (puede hacer peticiones en nombre del usuario); solo
  impide *exfiltrar* el token. La ganancia real es menor que la que sugiere la
  etiqueta.
- La sesión es revocable en el servidor y el MFA limita el valor de un token
  robado fuera de la ventana de vida del JWT.
- Reescribir el flujo de autenticación cerca del freeze de v1 suma riesgo de
  regresión en la parte más sensible del sistema.

## Consecuencias

- Queda un riesgo residual aceptado: un XSS exitoso puede exfiltrar el token
  hasta que expire o se revoque.
- Hay trabajo derivado: #386 (CSP) y, después de v1, #387 (migrar a cookie
  `HttpOnly` con `SameSite=Strict`).
- Esta decisión se reevalúa con los disparadores de arriba, no por calendario.

## Implementación de #387

Se adoptó la alternativa B (cookie `HttpOnly`) con `SameSite=Strict`, sin token
anti-CSRF.

- **Cookie:** `umbral_session`, `HttpOnly`, `SameSite=Strict`, `Path=/`,
  `Secure` solo en producción, `Max-Age` igual a la vida del JWT. La emite el
  backend al terminar el enrolamiento MFA, la verificación MFA, la recuperación
  de MFA y el cambio de contraseña forzado, y la limpia en `logout` y
  `logout-all` (`backend/src/modules/auth/session-cookie.ts`).
- **Lectura:** `JwtStrategy` busca primero la cookie y después el `Bearer`. El
  `Bearer` sigue siendo válido durante la transición y `accessToken` sigue en el
  cuerpo de la respuesta; ambos se pueden retirar más adelante.
- **Frontend:** el cliente envía credenciales (`withCredentials`) y ya no guarda
  el token. En `localStorage` queda solo `user`, que actúa como marcador de
  sesión; si la cookie expiró, el primer `401` cierra la sesión. El logout entre
  pestañas y el cierre por inactividad dependen de ese marcador. El `token` de
  versiones anteriores se descarta al arrancar.
- **CSRF:** solo `SameSite=Strict`. No se agregó token anti-CSRF.
  - *Nota (2026-10-27):* desde el issue #487 (PR #590) se sumó defensa en
    profundidad sin token anti-CSRF: `SessionOriginGuard`
    (`backend/src/common/guards/session-origin.guard.ts`, registrado en
    `app.module.ts`) rechaza con `403` las peticiones `POST`, `PUT`, `PATCH` y
    `DELETE` que llegan con la cookie de sesión y cuyo `Origin` (o, si falta,
    `Sec-Fetch-Site` `same-site`/`cross-site`) no corresponde al frontend. Sin
    cookie de sesión, o sin ninguna de esas cabeceras, la petición pasa.
- **Cookie sin `Domain`:** queda atada al host exacto de la API (*host-only*), de
  modo que cambiar de dominio no exige reconfigurar nada en el código.

### Estado de despliegue (2026-10-15)

Hasta el 2026-10-14 el frontend se servía en `umbral-ind.vercel.app` y solo la
API estaba bajo `groundzerodevs.com`. Eran sitios distintos (*cross-site*), por
lo que una cookie `SameSite=Strict` no se guardaba ni se enviaba, y la parte del
frontend de #387 no podía desplegarse. La parte del backend era compatible con
ese frontend: el `Bearer` y el `accessToken` del cuerpo seguían funcionando.

Desde el 2026-10-15 el frontend se sirve en `umbralrce.groundzerodevs.com` y la
API sigue en `umbralapi.groundzerodevs.com`. Comparten el dominio registrable
`groundzerodevs.com` (*same-site*), así que la cookie `SameSite=Strict` viaja
del frontend a la API. `umbral-ind.vercel.app` redirige al dominio nuevo
(`frontend/vercel.json`), para no romper los links de reserva pública ya
compartidos. La política de privacidad sigue publicada en la landing
(`umbral.groundzerodevs.com/privacidad-general`).

### Condición al cambiar de dominio

El dominio `groundzerodevs.com` es temporal. Al pasar al dominio definitivo,
el frontend y la API deben seguir siendo *same-site* (mismo dominio
registrable, por ejemplo `app.midominio.cl` y `api.midominio.cl`). Si quedaran
en dominios registrables distintos, `SameSite=Strict` dejaría de enviar la
cookie y habría que pasar a `SameSite=None; Secure` más un token anti-CSRF.
Con el cambio de dominio también deja de aplicar el riesgo de subdominios de
`groundzerodevs.com` fuera de nuestro control que motivó la duda sobre el CSRF.
Revisar además `FRONTEND_URL` (CORS) y la CSP del frontend (`connect-src`).
