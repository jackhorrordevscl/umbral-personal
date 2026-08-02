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

// Si el token de sesión expiró (401 en una llamada normal), redirige al login.
// Excepción: los 401 del propio flujo de auth (login, mfa/verify, cambio de
// contraseña, etc.) son errores esperados que cada pantalla maneja con su
// propio mensaje. Redirigir en esos casos recargaría la página, borraría el
// error de la UI (y del Network tab) y dejaría al usuario sin saber qué pasó.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url ?? '';
    const isAuthRequest = requestUrl.includes('/auth/');
    if (error.response?.status === 401 && !isAuthRequest) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;