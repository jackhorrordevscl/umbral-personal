import axios from 'axios';

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;

    if (typeof message === 'string' && message.trim()) {
      return message;
    }

    // Issue #297: el ValidationPipe de Nest devuelve message: string[]. Se
    // une con ' ' solo si todos los ítems son strings no vacíos; si alguno no
    // lo es, se descarta el arreglo y se usa el fallback.
    if (
      Array.isArray(message) &&
      message.length > 0 &&
      message.every((m) => typeof m === 'string' && m.trim())
    ) {
      return message.join(' ');
    }

    if (!error.response) {
      return 'No se pudo conectar con el servidor. Intenta nuevamente.';
    }
  }

  return fallback;
}
