import axios from 'axios';

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;

    if (typeof message === 'string' && message.trim()) {
      return message;
    }

    if (!error.response) {
      return 'No se pudo conectar con el servidor. Intenta nuevamente.';
    }
  }

  return fallback;
}
