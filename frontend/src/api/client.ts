import axios from 'axios';

// Sin VITE_API_URL: en dev cae a localhost (mismo puerto que main.ts usa por
// defecto); en un build de producción es un error de configuración real, así
// que se avisa fuerte en vez de apuntar en silencio a una IP hardcodeada
// (antes 192.168.1.183, una LAN privada que no existe fuera de esa red -- issue #19).
const fallbackApiUrl = 'http://localhost:3001/api/v1';
const apiUrl = import.meta.env.VITE_API_URL;
if (!apiUrl) {
  const message = 'VITE_API_URL no está configurada.';
  if (import.meta.env.DEV) {
    console.warn(`${message} Usando fallback de desarrollo: ${fallbackApiUrl}`);
  } else {
    console.error(`${message} La app no podrá comunicarse con el backend.`);
  }
}

const api = axios.create({
  baseURL: apiUrl || fallbackApiUrl,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Agrega el token JWT automáticamente a cada request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let onUnauthorized: (() => void) | null = null;

/** Registra (o quita, con null) el handler de sesión expirada. Devuelve el cleanup. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
  return () => {
    if (onUnauthorized === handler) onUnauthorized = null;
  };
}

// Endpoints de auth que se llaman SIN sesión (o con un token propio del flujo,
// no el de sesión): un 401 ahí es un error esperado (credenciales, código o
// token inválido) que cada pantalla muestra con su propio mensaje. Lista
// explícita y no un `includes('/auth/')`: mfa/generate, mfa/enable,
// mfa/disable, logout-all e invitations también cuelgan de /auth/ pero exigen
// sesión, y un 401 en ellos sí significa que la sesión expiró (issue #293).
// Fuente de verdad: AuthController del backend
// (backend/src/modules/auth/auth.controller.ts, @Controller('auth')). Al añadir
// ahí un endpoint, clasificarlo en esta lista (sin sesión) o en
// SESSION_AUTH_PATHS (con sesión); en desarrollo, un 401 de un endpoint /auth/
// que no esté en ninguna avisa por consola (issue #351).
export const PUBLIC_AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/mfa/verify',
  '/auth/signup',
  '/auth/verify-email',
  '/auth/verify-email/resend',
  '/auth/mfa/setup/begin',
  '/auth/mfa/setup/confirm',
  '/auth/password/change',
  '/auth/password/forgot',
  '/auth/password/reset',
  '/auth/mfa/recover',
  '/auth/logout',
]);

// Endpoints de /auth/ que exigen sesión: un 401 ahí SÍ cierra la sesión.
export const SESSION_AUTH_PATHS = new Set([
  '/auth/mfa/generate',
  '/auth/mfa/enable',
  '/auth/mfa/disable',
  '/auth/logout-all',
  '/auth/invitations',
]);

// Ruta relativa a la baseURL, sin query, hash ni "/" final. Una URL absoluta
// (que axios no combina con baseURL) se reduce a su pathname, quitando el
// prefijo de la baseURL (p. ej. /api/v1) para compararla con las listas.
function normalizeRequestPath(requestUrl: string): string {
  let path = requestUrl;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(requestUrl)) {
    try {
      path = new URL(requestUrl).pathname;
      const basePath = new URL(api.defaults.baseURL ?? '').pathname.replace(
        /\/+$/,
        '',
      );
      if (basePath && path.startsWith(`${basePath}/`)) {
        path = path.slice(basePath.length);
      }
    } catch {
      // URL malformada: se compara tal cual.
    }
  }
  path = path.split(/[?#]/)[0].replace(/\/+$/, '');
  return path.startsWith('/') ? path : `/${path}`;
}

function isPublicAuthRequest(requestUrl: string): boolean {
  return PUBLIC_AUTH_PATHS.has(normalizeRequestPath(requestUrl));
}

function warnIfUnclassifiedAuthPath(requestUrl: string) {
  if (!import.meta.env.DEV) return;
  const path = normalizeRequestPath(requestUrl);
  if (
    path.startsWith('/auth/') &&
    !PUBLIC_AUTH_PATHS.has(path) &&
    !SESSION_AUTH_PATHS.has(path)
  ) {
    console.warn(
      `401 de ${path}: endpoint /auth/ no clasificado en PUBLIC_AUTH_PATHS ni en SESSION_AUTH_PATHS (api/client.ts). Se tratará como sesión expirada.`,
    );
  }
}

// Si el token de sesión expiró (401 en una llamada normal), redirige al login.
// Excepción: los 401 del flujo público de auth (ver PUBLIC_AUTH_PATHS).
// Redirigir en esos casos recargaría la página, borraría el error de la UI (y
// del Network tab) y dejaría al usuario sin saber qué pasó.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url ?? '';
    const isPublicAuth = isPublicAuthRequest(requestUrl);
    if (error.response?.status === 401 && !isPublicAuth) {
      warnIfUnclassifiedAuthPath(requestUrl);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (onUnauthorized) {
        // Issue #203: la app registra un handler que actualiza AuthContext y
        // navega dentro de la SPA, sin recargar la página completa.
        onUnauthorized();
      } else {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default api;