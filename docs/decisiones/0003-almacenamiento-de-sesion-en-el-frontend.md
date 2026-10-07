# ADR 0003 — Almacenamiento de la sesión en el frontend

- **Estado:** aceptada
- **Fecha:** 2026-10-07
- **Issue:** #384

## Contexto

El frontend guarda el JWT de sesión y los datos del usuario en `localStorage`
(claves `token` y `user`; ver `frontend/src/context/AuthContext.tsx` y
`frontend/src/api/client.ts`). El cliente adjunta el token como
`Authorization: Bearer` en cada petición, y el backend lo extrae con
`ExtractJwt.fromAuthHeaderAsBearerToken()` (`jwt.strategy.ts`).

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
- **Dominios:** el frontend se sirve en `umbral.groundzerodevs.com` (Vercel) y
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
   `connect-src` limitado al API) y se prueba primero en modo
   `Content-Security-Policy-Report-Only`.
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
