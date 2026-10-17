# Frontend — Umbral - RCE

Interfaz React 19 (Vite 7, Tailwind CSS 4) del sistema de gestión de fichas
clínicas. Documentación completa del proyecto (instalación, variables de
entorno, endpoints, compliance) en el [README raíz](../README.md). Requiere
Node.js 22.22 o superior.

## Comandos

```bash
npm install --legacy-peer-deps
npm run dev        # desarrollo (http://localhost:5173)
npm run build       # typecheck (tsc -b) + build de producción
npm run lint         # lint
npm run preview      # previsualizar el build
npm run test         # tests unitarios (Vitest)
npm run test:watch   # tests en modo watch
npm run test:cov     # tests con cobertura
npm run test:e2e     # e2e con Playwright (en CI corre en el job e2e, contra un backend real)
```

## Variables de entorno

- `VITE_API_URL`: URL base del backend, incluido `/api/v1`. Sin definir,
  `npm run dev` usa `http://localhost:3001/api/v1`; en un build de producción
  es un error de configuración.
- `VITE_SENTRY_DSN`: DSN de Sentry. Opcional; sin definir el SDK queda
  desactivado.

Los e2e necesitan el backend levantado con las cuentas de `npm run seed:e2e`:
ver la sección Pruebas del [README raíz](../README.md).
