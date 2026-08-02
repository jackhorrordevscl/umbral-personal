import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://192.168.1.183:3001/api/v1',
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