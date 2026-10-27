// Issue #487: lista única de orígenes del frontend, compartida por CORS
// (main.ts) y por SessionOriginGuard para que ambos nunca difieran.
export interface AllowedOriginsEnv {
  NODE_ENV?: string;
  LAN_DEV_URL?: string;
  FRONTEND_URL?: string;
}

export function getAllowedOrigins(env: AllowedOriginsEnv): string[] {
  return [
    env.NODE_ENV !== 'production' ? 'http://localhost:5173' : null,
    env.LAN_DEV_URL,
    env.FRONTEND_URL,
  ].filter((origin): origin is string => Boolean(origin));
}
