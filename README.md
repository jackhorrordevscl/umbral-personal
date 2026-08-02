# Umbral SpA — Sistema de Gestión Clínica

![CI](https://github.com/jackhorrordevscl/control-fichas/actions/workflows/ci.yml/badge.svg?branch=main)

Sistema de gestión de fichas clínicas para consulta psicológica, desarrollado
para cumplir con la **Ley 20.584** (Derechos y Deberes de los Pacientes), la
**Ley 19.628** (Protección de la Vida Privada) y la **Ley 21.719** (nueva Ley
de Protección de Datos Personales) de Chile.

## Documentación relacionada

- [`docs/manual-terapeutas.md`](docs/manual-terapeutas.md) — manual funcional
  para terapeutas: primer acceso/MFA, roles, pacientes, consultas,
  documentos, archivos compartidos y reportes PDF.
- [`docs/caso-de-uso-testing.md`](docs/caso-de-uso-testing.md) — guía
  narrativa de testing manual/UAT paso a paso para voluntarios que prueban la
  app antes de que la usen pacientes reales.
- [`docs/registro-actividades-tratamiento.md`](docs/registro-actividades-tratamiento.md) —
  Registro de Actividades de Tratamiento (RAT, Ley 21.719): qué datos se
  tratan, con qué finalidad, base legal y retención.

---

## Stack Tecnológico

**Frontend**
- React 19 + TypeScript
- Tailwind CSS
- React Router v7
- TanStack Query (React Query)
- React Hook Form + Zod
- Axios
- Lucide React

**Backend**
- NestJS 11 + TypeScript
- PostgreSQL 16
- Prisma ORM v6
- JWT + Passport
- Argon2 (hash de contraseñas)
- Speakeasy (MFA/TOTP)
- PDFKit (generación de reportes)
- Helmet.js (seguridad HTTP)

---

## Requisitos Previos

- Node.js v22+ (versión usada en CI; v20+ también funciona)
- PostgreSQL 16 (en producción, Supabase gestiona la base — ver sección
  [Producción](#producción-actual))
- npm

---

## Instalación (desarrollo local)

### 1. Clonar el repositorio

```bash
git clone https://github.com/jackhorrordevscl/control-fichas.git
cd control-fichas
```

### 2. Configurar la base de datos

```bash
sudo -u postgres psql
```

```sql
CREATE USER umbral_user WITH PASSWORD 'tu_password_seguro';
CREATE DATABASE umbral_db OWNER umbral_user;
GRANT ALL PRIVILEGES ON DATABASE umbral_db TO umbral_user;
ALTER USER umbral_user CREATEDB;
\q
```

> Alternativa: `./install.sh` automatiza estos pasos (Node, PostgreSQL,
> creación de base, `.env`, dependencias y cron de backup) en Ubuntu/Debian.

### 3. Configurar el Backend

```bash
cd backend
npm install --legacy-peer-deps
```

Crea el archivo `.env` a partir de `.env.example`:

```bash
cp .env.example .env
nano .env
```

```env
DATABASE_URL="postgresql://umbral_user:tu_password_seguro@localhost:5432/umbral_db"
# En local (sin pooler) es la misma conexión que DATABASE_URL. En producción
# con un pooler delante (Supabase/PgBouncer), DIRECT_URL debe ser la
# conexión directa, no la pooled — Prisma Migrate la necesita para funcionar.
DIRECT_URL="postgresql://umbral_user:tu_password_seguro@localhost:5432/umbral_db"
JWT_SECRET="cambia-este-secreto-en-produccion"
JWT_EXPIRES_IN="8h"
MFA_APP_NAME="Umbral SpA"
FRONTEND_URL="http://localhost:5173"
# Clave de cifrado de documentos (T8.1) -- generá la tuya con:
# openssl rand -base64 32
DOCUMENT_ENCRYPTION_KEY="+rPRh0H2ayZ4yAIjhOWbvOghetuNtScBP8g2VgNuBik="
```

Ejecutar migraciones y seed inicial:

```bash
npx prisma migrate dev --name init
npm run seed
```

### 4. Configurar el Frontend

```bash
cd ../frontend
npm install --legacy-peer-deps
```

Si vas a usar en red local, edita `src/api/client.ts` y cambia la `baseURL`
con la IP de tu servidor:

```typescript
baseURL: 'http://TU_IP:3001/api/v1',
```

---

## Ejecución en Desarrollo

**Terminal 1 — Backend:**
```bash
cd backend
npm run start:dev
# Servidor en http://localhost:3001/api/v1
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# App en http://localhost:5173
```

### Credenciales por defecto

```
Email:     admin@umbral.cl
Password:  Umbral2024!
```

> ⚠️ Cambia estas credenciales inmediatamente después de la primera
> instalación. El usuario admin fuerza cambio de contraseña en su primer
> login (`mustChangePassword`), pero eso solo protege si cambiás la clave
> **antes** de que alguien más la use con el valor conocido.

---

## Producción actual

El despliegue vigente corre en **Render** (backend + frontend) detrás de
**Cloudflare**, con **Supabase** como base de datos gestionada (Postgres
detrás de Supavisor/PgBouncer en modo transacción). Por eso:

- `DATABASE_URL` en producción es la conexión **pooled** de Supabase (puerto
  `6543`, `?pgbouncer=true`); `DIRECT_URL` es la conexión **directa** (puerto
  `5432`) que necesita `prisma migrate` — ver el comentario en
  `backend/prisma/schema.prisma`.
- `TRUSTED_PROXY_HOPS=3` en producción (Render detrás de Cloudflare); en
  local/sin CDN delante es `1`.
- `RUN_MIGRATIONS=true` corre `prisma migrate deploy` de forma asíncrona
  después de levantar el server, pensado para plataformas cuyo Start Command
  no corre migraciones por su cuenta (caso Render) — ver `main.ts`.

---

## Estructura del Proyecto

```
control-fichas/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         # Modelos de base de datos
│   │   └── migrations/           # Historial de migraciones
│   ├── src/
│   │   ├── common/
│   │   │   ├── guards/           # JWT Guard, Roles Guard
│   │   │   ├── decorators/       # CurrentUser, Roles
│   │   │   └── interceptors/     # Audit Interceptor
│   │   ├── modules/
│   │   │   ├── auth/             # Login, JWT, MFA, cambio de contraseña forzado
│   │   │   ├── patients/         # CRUD, consentimientos e historial de pacientes
│   │   │   ├── consultations/    # Registro clínico versionado
│   │   │   ├── documents/        # Documentos adjuntos por paciente
│   │   │   ├── users/            # Gestión de usuarios (ADMIN/SUPERVISOR/COORDINATOR)
│   │   │   ├── reports/          # Generación de PDF
│   │   │   └── audit/            # Bitácora inmutable (interceptor global)
│   │   ├── shared-files/         # Biblioteca interna (plantillas, protocolos)
│   │   └── prisma/               # Servicio Prisma
│   └── .env.example
├── frontend/
│   └── src/
│       ├── api/                  # Cliente HTTP (Axios)
│       ├── context/              # AuthContext
│       ├── components/           # Layout, Sidebar
│       └── pages/                # Login, Dashboard, Pacientes, Consultas, Seguridad
├── docs/                         # Manual de uso, caso de testing, RAT
├── backups/
│   └── backup.sh                 # Script de backup automático
└── README.md
```

---

## Funcionalidades

### Autenticación y Seguridad
- Login con email y contraseña (hash Argon2)
- Tokens JWT con expiración configurable
- MFA obligatorio para roles administrativos, opcional para el resto (TOTP,
  compatible con Google Authenticator y Authy)
- Cambio de contraseña forzado en el primer login del admin semilla
- Guards de autenticación y control de roles (RBAC)
- Rate limiting en login (`@nestjs/throttler`)
- Headers HTTP seguros con Helmet.js

### Gestión de Pacientes (Ley 20.584)
- Ficha completa con datos de identificación, contacto de emergencia y red de salud
- Consentimiento granular por finalidad (`TREATMENT`, `TELEMEDICINE`,
  `HEALTH_NETWORK`) como ledger append-only (Ley 21.719)
- Acceso a fichas condicionado a consentimiento vigente y rol; acceso
  excepcional de `SUPERVISOR` sin consentimiento `HEALTH_NETWORK`, siempre
  con motivo auditado
- Soft delete — los registros nunca se eliminan físicamente
- Búsqueda por nombre o RUT, historial de cambios (`PatientHistory`)

### Registro Clínico
- Registro cronológico de sesiones con fecha y hora automática
- Campos: motivo de consulta, intervención, acuerdos y próxima sesión
- Soporte para sesiones presenciales y telemedicina
- Sistema de versionado legal — las correcciones crean nuevas versiones sin
  alterar el original (`ConsultationHistory`)

### Documentos y Archivos
- Documentos clínicos por paciente (consentimiento informado, informes,
  otros), PDF/imágenes hasta 10MB
- Biblioteca interna de archivos compartidos (plantillas, protocolos,
  formularios) para todo el staff, no ligada a pacientes

### Gestión de Usuarios
- CRUD de usuarios reservado a `ADMIN`, `SUPERVISOR` y `COORDINATOR`
- Soft delete de usuarios

### Exportación PDF
- Generación de ficha clínica completa en PDF
- Incluye datos del paciente e historial clínico completo
- Pie de página con referencia a Ley 20.584 y custodia obligatoria de 15 años

### Auditoría (Bitácora Inmutable)
- Registro automático de todas las acciones del sistema vía interceptor global
- Campos: usuario, acción, recurso, IP, user-agent, timestamp y motivo de
  acceso excepcional (`overrideReason`) cuando aplica
- Tabla append-only — ningún registro puede modificarse ni eliminarse

### Backups Automáticos
- Script de backup diario programado vía cron (2:00 AM)
- Compresión gzip + cifrado AES-256 de los respaldos (nunca se escribe un
  volcado sin cifrar a disco)
- Credenciales de base de datos vía `.pgpass`, nunca hardcodeadas en el script
- Rotación operativa de 30 días **separada** de un archivo de custodia legal
  mensual que nunca se borra (Ley 20.584: 15 años)
- Segunda copia local en un dispositivo físico distinto (NAS)
- Copia offsite real vía Backblaze B2 + `rclone` (T3.3, issue #17) — proveedor
  ya definido, configuración de infra pendiente (ver sección
  [Configuración de Backups](#configuración-de-backups))

---

## API Endpoints

Todas las rutas usan el prefijo global `/api/v1`.

### Autenticación
```
POST /api/v1/auth/login
POST /api/v1/auth/mfa/verify
POST /api/v1/auth/mfa/generate         🔒
POST /api/v1/auth/mfa/enable           🔒
POST /api/v1/auth/mfa/disable          🔒
POST /api/v1/auth/mfa/setup/begin      (setupToken)
POST /api/v1/auth/mfa/setup/confirm    (setupToken)
POST /api/v1/auth/password/change      (passwordChangeToken)
```

### Pacientes
```
POST   /api/v1/patients                        🔒
GET    /api/v1/patients                        🔒
GET    /api/v1/patients/by-rut/:rut            🔒 SUPERVISOR
GET    /api/v1/patients/:id/history            🔒
GET    /api/v1/patients/:id                    🔒
PATCH  /api/v1/patients/:id                    🔒
DELETE /api/v1/patients/:id                    🔒
POST   /api/v1/patients/:id/consents           🔒
GET    /api/v1/patients/:id/consents/status    🔒
GET    /api/v1/patients/:id/consents           🔒
POST   /api/v1/patients/:id/access-override    🔒 SUPERVISOR
```

### Consultas
```
POST  /api/v1/consultations                        🔒
GET   /api/v1/consultations/patient/:patientId     🔒
GET   /api/v1/consultations/:id                    🔒
PATCH /api/v1/consultations/:id/correct            🔒
```

### Documentos
```
POST /api/v1/documents/upload             🔒 (multipart, PDF/imagen, máx. 10MB)
GET  /api/v1/documents/patient/:patientId 🔒
GET  /api/v1/documents/:id/download       🔒
```

### Usuarios
```
GET    /api/v1/users        🔒 ADMIN/SUPERVISOR/COORDINATOR
GET    /api/v1/users/:id    🔒 ADMIN/SUPERVISOR/COORDINATOR
POST   /api/v1/users        🔒 ADMIN/SUPERVISOR/COORDINATOR
PATCH  /api/v1/users/:id    🔒 ADMIN/SUPERVISOR/COORDINATOR
DELETE /api/v1/users/:id    🔒 ADMIN/SUPERVISOR/COORDINATOR
```

### Archivos compartidos
```
GET    /api/v1/shared-files              🔒
GET    /api/v1/shared-files/:id          🔒
GET    /api/v1/shared-files/:id/download 🔒
POST   /api/v1/shared-files/upload       🔒
PATCH  /api/v1/shared-files/:id          🔒
DELETE /api/v1/shared-files/:id          🔒
```

### Reportes
```
GET /api/v1/reports/patient/:patientId    🔒
```

> 🔒 Requiere token JWT en el header `Authorization: Bearer <token>`

---

## Configuración de Backups

El script de backup está en `backups/backup.sh`. Antes de activarlo, configurá dos archivos protegidos **fuera del repositorio** (nunca en git):

```bash
# 1. Credenciales de base de datos
echo "localhost:5432:umbral_db:umbral_user:TU_PASSWORD" >> ~/.pgpass
chmod 600 ~/.pgpass

# 2. Frase de cifrado — guardá una copia en un gestor de contraseñas.
#    Sin ella, los backups cifrados son irrecuperables.
openssl rand -base64 48 > ~/.umbral_backup_passphrase
chmod 600 ~/.umbral_backup_passphrase
```

Variables opcionales (todas tienen un default razonable si no se configuran — ver comentarios al inicio de `backup.sh`):

| Variable | Para qué |
|---|---|
| `BACKUP_DIR` | Backups operativos, rotan cada `RETENTION_DAYS` |
| `ARCHIVE_DIR` | Custodia legal — nunca se borra automáticamente |
| `NAS_DIR` | Segunda copia local en un dispositivo físico distinto (regla 3-2-1) |
| `OFFSITE_UPLOAD_CMD` | Hook para subir a un destino offsite real (T3.3, issue #17) |

### Copia offsite real (Backblaze B2 + rclone)

Proveedor elegido: **Backblaze B2** (10 GB gratis de forma permanente, no
trial; el backup ya llega cifrado con AES-256 antes de subirse, así que B2
nunca tiene acceso al contenido en claro). Se descartó usar hosting propio
existente (ej. HostGator) porque su Acceptable Use Policy prohíbe
explícitamente usar el espacio de shared hosting como *"offsite storage of
electronic files"* — ver la discusión completa en el issue #17.

1. Crear cuenta gratuita en Backblaze B2 y un bucket **privado**.
2. Instalar [`rclone`](https://rclone.org) en el servidor y configurar el
   remote con el Application Key de B2:
   ```bash
   rclone config
   ```
3. Setear `OFFSITE_UPLOAD_CMD` en el entorno del servidor (variable de
   infra, **nunca en el repo**):
   ```bash
   OFFSITE_UPLOAD_CMD="rclone copy {} b2remote:mi-bucket/umbral/"
   ```
   `backup.sh` reemplaza `{}` por la ruta del backup cifrado y ejecuta el
   comando tal cual.
4. Verificar al menos una restauración real desde la copia offsite antes de
   dar por cerrado el punto.

Activarlo:

```bash
chmod +x backups/backup.sh

# Agregar al cron (ejecuta todos los días a las 2:00 AM)
crontab -e
```

Agregar la siguiente línea:

```
0 2 * * * /ruta/completa/control-fichas/backups/backup.sh >> /ruta/completa/control-fichas/backups/backup.log 2>&1
```

Restaurar un backup:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$HOME/.umbral_backup_passphrase" \
  -in umbral_backup_2026-07-15_02-00-00.sql.gz.enc | gunzip | \
  psql -U umbral_user -h localhost -d umbral_db
```

---

## Cumplimiento Legal

| Requisito | Implementación |
|---|---|
| Ficha clínica obligatoria | Módulo de pacientes con todos los campos exigidos |
| Secreto profesional | Datos cifrados en tránsito (HTTPS en producción) |
| Custodia 15 años | Soft delete + archivo de custodia legal mensual cifrado que nunca se borra (separado de la rotación operativa de 30 días) |
| Derecho del paciente a su ficha | Exportación PDF bajo demanda |
| Inalterabilidad de registros | Versionado en consultas + soft delete en pacientes |
| Bitácora de accesos | Audit Log inmutable con registro de todas las acciones |
| Consentimiento granular por finalidad (Ley 21.719) | Ledger append-only `PatientConsent` por `TREATMENT`/`TELEMEDICINE`/`HEALTH_NETWORK` |
| Acceso excepcional auditado | `SUPERVISOR` puede acceder sin consentimiento `HEALTH_NETWORK` vigente, con motivo obligatorio registrado |
| Inventario de tratamiento (RAT) | Ver [`docs/registro-actividades-tratamiento.md`](docs/registro-actividades-tratamiento.md) |

Pendiente de proveedor externo (no depende de código): firma electrónica
avanzada Ley 19.799 (issues #24-#26). La copia offsite de backups ya tiene
proveedor definido (Backblaze B2 + `rclone`) — ver
[Configuración de Backups](#configuración-de-backups) e issue #17.

---

## Variables de Entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `DATABASE_URL` | URL de conexión PostgreSQL (pooled en producción) | `postgresql://user:pass@localhost:5432/db` |
| `DIRECT_URL` | Conexión directa (sin pooler) para `prisma migrate` | Igual a `DATABASE_URL` en local |
| `JWT_SECRET` | Clave secreta para firmar tokens | Cadena aleatoria larga |
| `JWT_EXPIRES_IN` | Tiempo de expiración del token | `8h` |
| `MFA_APP_NAME` | Nombre que aparece en la app autenticadora | `Umbral SpA` |
| `FRONTEND_URL` | URL del frontend (para CORS) | `http://localhost:5173` |
| `DOCUMENT_ENCRYPTION_KEY` | Clave AES-256 (base64, 32 bytes) para cifrar documentos de pacientes en reposo (T8.1) | Generar con `openssl rand -base64 32` |
| `PORT` | Puerto del backend | `3001` (default) |
| `NODE_ENV` | Entorno de ejecución; en `production` exige `JWT_SECRET` fuerte y distinto del valor de ejemplo | `production` |
| `RUN_MIGRATIONS` | Si es `true`, corre `prisma migrate deploy` al arrancar (ver `main.ts`) | `false` |
| `TRUSTED_PROXY_HOPS` | Cantidad de proxies confiables delante de la app, para identificar la IP real del cliente en el rate-limit de login (ver comentario en `auth.module.ts`) | `1` (un único proxy de edge, sin CDN delante). Con Render detrás de Cloudflare (deploy actual): `3` |
| `SEED_ADMIN_EMAIL` | Email del admin creado por `prisma db seed` (`npm run seed`) | `admin@umbral.cl` (default, ver `prisma/seed-admin.defaults.ts`) |
| `SEED_ADMIN_PASSWORD` | Contraseña inicial del admin creado por el seed | Ver advertencia abajo — **nunca dejar el default en un entorno alcanzable** |

> ⚠️ Si el comando de arranque del hosting ya corre `prisma migrate deploy` antes de iniciar el server (recomendado), **no** setees `RUN_MIGRATIONS=true` también — no rompe nada (la migración es idempotente), pero la corre dos veces innecesariamente.

> 🔒 **El `DOCUMENT_ENCRYPTION_KEY` de ejemplo de arriba es público** (está en un repo público) — igual que con `JWT_SECRET`, en producción el arranque falla si detecta ese valor exacto o cualquier clave que no decodifique a 32 bytes en base64. Generá una propia con `openssl rand -base64 32` antes de desplegar.

> 🔒 **`SEED_ADMIN_PASSWORD` es pública si no la overrideás.** El default (`prisma/seed-admin.defaults.ts`) está commiteado en un repo público — cualquiera lo puede leer. La cuenta admin fuerza cambio de contraseña en su primer login (`mustChangePassword`), pero eso solo protege si el operador cambia la clave *antes* de que alguien más la use con la contraseña conocida: quien loguee primero con el default se queda con el `passwordChangeToken` y puede tomar la cuenta. En local/CI el default está bien (nadie más tiene acceso a esa base). En **cualquier entorno alcanzable desde afuera** (staging, producción), seteá `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` a valores propios antes de correr el seed por primera vez.

---

## Licencia

Uso privado — Umbral SpA © 2026. Todos los derechos reservados.
