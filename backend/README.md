# Backend — Umbral - RCE

API NestJS 11 del sistema de gestión de fichas clínicas (Prisma 7 sobre
PostgreSQL). Documentación completa del proyecto (instalación, variables de
entorno, endpoints, compliance) en el [README raíz](../README.md).

## Comandos

```bash
npm install                # backend/.npmrc ya activa legacy-peer-deps
npx prisma generate        # genera el cliente de Prisma (no se genera en el postinstall)
npx prisma migrate deploy  # aplica las migraciones (usa DIRECT_URL)
npm run start:dev          # desarrollo (nest start --watch)
npm run start:debug        # desarrollo con inspector
npm run build              # compilar a dist/
npm run start:prod         # producción (node dist/src/main.js)
npm run lint               # eslint (con --fix)
npm run format             # prettier
npm run test               # tests unitarios (Jest)
npm run test:watch         # tests unitarios en modo watch
npm run test:cov           # cobertura
npm run test:e2e           # tests e2e (Jest + Supertest, necesitan Postgres real)
npm run seed               # seed inicial (usuario semilla; SEED_HOLIDAYS=true agrega los feriados)
npm run seed:e2e           # cuentas para los e2e de Playwright (opt-in, ver README raíz)
npm run crypto:reencrypt   # recifrado manual con la clave activa del llavero; dry-run salvo `-- --apply` (ver docs/rotacion-y-respaldo-de-claves.md)
```

El servidor escucha en `PORT` (3001 por defecto) bajo el prefijo `/api/v1`.
