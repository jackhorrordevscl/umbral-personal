# Umbral — Sistema de Gestión Clínica

![CI](https://github.com/jackhorrordevscl/umbral-personal/actions/workflows/ci.yml/badge.svg?branch=main)

Umbral es un sistema de fichas clínicas para un profesional de salud mental
que atiende por su cuenta (psicólogo/a, terapeuta) — cada cuenta es dueña
exclusiva de sus propios pacientes, sin roles jerárquicos ni panel
administrativo: quien se registra es quien usa el sistema. Nace como
evolución de un proyecto institucional multi-profesional (`control-fichas`)
que se simplificó a este modelo de una sola cuenta por profesional (issue
#2/#7), y sigue desarrollado para cumplir con la **Ley 20.584** (Derechos y
Deberes de los Pacientes), la **Ley 19.628** (Protección de la Vida Privada)
y la **Ley 21.719** (nueva Ley de Protección de Datos Personales) de Chile.

Si eres terapeuta y solo quieres saber cómo usar la app (sin instalar nada),
ve directo al [Manual de uso](docs/manual-terapeutas.md).

## Documentación relacionada

- [`docs/manual-terapeutas.md`](docs/manual-terapeutas.md) ([PDF para
  imprimir/compartir](docs/manual-terapeutas.pdf)) — manual funcional para
  terapeutas: crear tu cuenta, MFA obligatorio, recuperación de cuenta,
  pacientes, consultas, documentos, archivos personales y reportes PDF.
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
- React Router v8
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
  [Despliegue](#despliegue-issue-8))
- npm

---

## Instalación (desarrollo local)

### 1. Clonar el repositorio

```bash
git clone https://github.com/jackhorrordevscl/umbral-personal.git
cd umbral-personal
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
MFA_APP_NAME="Umbral - RCE"
FRONTEND_URL="http://localhost:5173"
# Clave de cifrado de documentos (T8.1) -- genera la tuya con:
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

### Cómo entrar la primera vez

No hay usuarios predefinidos por rol — cada profesional crea su propia
cuenta:

- **Alta normal**: `POST /auth/signup` (o el botón "Regístrate" del login)
  crea la cuenta con `emailVerified: false`. Sin `RESEND_API_KEY` configurada
  en local, el email de verificación no se envía de verdad — `MailService`
  lo saltea con un warning en el log del backend (revísalo ahí para sacar el
  link mientras pruebas en dev).
- **Cuenta semilla** (`npm run seed`, ver más abajo): crea una única cuenta
  de prueba para no tener que pasar por signup+verificación en cada corrida
  local.

```
Email:     admin@umbral.cl
Password:  Umbral2024!
```

> ⚠️ Cambia estas credenciales inmediatamente después de instalar en un
> entorno alcanzable por otras personas (ver `SEED_ADMIN_EMAIL`/
> `SEED_ADMIN_PASSWORD` en Variables de Entorno). La cuenta semilla fuerza
> cambio de contraseña en su primer login (`mustChangePassword`), pero eso
> solo protege si cambias la clave **antes** de que alguien más la use con
> el valor conocido — es público, está en este repo.
>
> Si perdiste tu contraseña o el dispositivo MFA de una cuenta ya
> existente, no hace falta tocar la base de datos: ver
> [Recuperación de cuenta](#recuperación-de-cuenta-issue-50).

---

## Despliegue (issue #8)

**Backend ya desplegado y en producción** en Render:
https://umbral-backend-uces.onrender.com/api/v1 (servicio `umbral-backend`,
deploy automático en cada push a `main`). Stack: **backend en Render** (free
tier, ver limitación de cold start más abajo), **frontend pensado para
Vercel** (`vercel.json` ya en el repo, `rootDir: frontend/`), **Postgres
gestionado en Supabase** (Supavisor/PgBouncer en modo transacción — la
`DATABASE_URL` de producción necesita `?pgbouncer=true` al final, o el
runtime choca con "prepared statement already exists" en cada reinicio),
copia offsite de backups en **Backblaze B2** (ver
[Configuración de Backups](#configuración-de-backups)).

> **Cold start de Render (free tier):** el proceso duerme a los 15 minutos
> de inactividad y tarda 30-60s+ en despertar. Para el patrón de uso real
> (un profesional abriendo la app entre pacientes, sesiones de 45-50 min —
> más que el timeout de Render) esto va a notarse en casi cada apertura. Se
> acepta para el MVP mientras se prueba con el terapeuta; la migración a
> una VM Oracle Cloud Always Free (always-on real, sin cold start) queda
> planificada en el issue #10 para cuando el uso real lo confirme necesario.

### Orden de setup

1. **Supabase**: crear proyecto → copiar desde Project Settings → Database:
   - `DATABASE_URL` = **Transaction pooler** (host
     `aws-0-<región>.pooler.supabase.com`, puerto `6543`, agregar
     `?pgbouncer=true` al final).
   - `DIRECT_URL` = **Session pooler** (mismo host que el de arriba, puerto
     `5432` -- NO el host "Direct connection"
     `db.<ref>.supabase.co:5432` que muestra el dashboard). El host directo
     real resuelve solo por IPv6 desde hace un tiempo (salvo que se pague el
     add-on de IPv4 de Supabase), y la mayoría de las PaaS (Render incluido)
     no tienen salida IPv6 -- la conexión nunca llega a establecerse, no es
     un problema de credenciales (issue #11). El Session pooler sí es IPv4 y
     soporta prepared statements, que es lo que necesita `prisma migrate
     deploy`; el Transaction pooler (6543) no lo garantiza, por eso no sirve
     para `DIRECT_URL`.
2. **Backend en Render**: conectar el repo, Render detecta `render.yaml`
   (Blueprint) en la raíz — define el servicio, build/start command y qué
   env vars hay que cargar a mano (`sync: false` en el archivo). Cargar ahí
   mismo: `DATABASE_URL`/`DIRECT_URL` del paso 1, `DOCUMENT_ENCRYPTION_KEY`
   (`openssl rand -base64 32`), `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
   (nunca el default del README), `RESEND_API_KEY`/`MAIL_FROM` (issue #5) y
   `FRONTEND_URL` (se completa después del paso 3, se puede editar y
   redeployar). `JWT_SECRET` se autogenera vía `generateValue: true`.
3. **Frontend en Vercel**: importar el repo con root directory `frontend/`
   (usa `vercel.json` para el rewrite de rutas del SPA). Variable
   `VITE_API_URL` apuntando a la URL pública del backend de Render + `/api/v1`.
   Con la URL final de Vercel, volver al paso 2 y setear `FRONTEND_URL` en
   Render (lo usa `main.ts` para CORS).
4. Correr `npm run seed` una vez contra la base de Supabase (con
   `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` de producción en el entorno) para
   crear el usuario semilla.
5. Configurar backups offsite — ver
   [Copia offsite real](#copia-offsite-real-backblaze-b2--rclone).

---

## Estructura del Proyecto

```
umbral-personal/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         # Modelos de base de datos (un solo Role: PROFESSIONAL)
│   │   └── migrations/           # Historial de migraciones
│   ├── src/
│   │   ├── common/
│   │   │   ├── guards/           # JwtAuthGuard (sin guard de roles -- ownership por therapistId)
│   │   │   ├── decorators/       # CurrentUser
│   │   │   └── interceptors/     # Audit Interceptor
│   │   ├── modules/
│   │   │   ├── auth/             # Signup, login, JWT, MFA obligatorio, recuperación de cuenta
│   │   │   ├── patients/         # CRUD, consentimientos e historial de pacientes propios
│   │   │   ├── consultations/    # Registro clínico versionado
│   │   │   ├── documents/        # Documentos adjuntos por paciente
│   │   │   ├── profile/          # Ver/editar los propios datos de cuenta
│   │   │   ├── mail/             # Envío de emails transaccionales (Resend)
│   │   │   ├── reports/          # Generación de PDF
│   │   │   └── audit/            # Bitácora inmutable (interceptor global)
│   │   ├── shared-files/         # Biblioteca personal (plantillas, protocolos) -- privada por usuario
│   │   └── prisma/               # Servicio Prisma
│   └── .env.example
├── frontend/
│   └── src/
│       ├── api/                  # Cliente HTTP (Axios)
│       ├── context/              # AuthContext
│       ├── components/           # Layout, Sidebar, RecoveryCodesReveal
│       └── pages/                # Login, Signup, VerifyEmail, ForgotPassword,
│                                  # ResetPassword, MfaRecover, Dashboard, Patients,
│                                  # Consultations, Settings (MFA), SharedFiles
├── docs/                         # Manual de uso, caso de testing, RAT
├── backups/
│   └── backup.sh                 # Script de backup automático
└── README.md
```

---

## Funcionalidades

### Autenticación y Seguridad
- Alta propia (self-signup) con verificación de email — no hay un admin que
  cree cuentas, cada profesional se registra solo (issue #5)
- Login con email y contraseña (hash Argon2)
- Tokens JWT con expiración configurable
- **MFA obligatorio para toda cuenta** (TOTP, compatible con Google
  Authenticator y Authy) — se enrola forzosamente en el primer login exitoso,
  no es opcional ni depende de un rol
- Recuperación de cuenta self-service sin intervención manual en la base de
  datos: contraseña olvidada por email, y 10 códigos de recuperación de un
  solo uso para desactivar MFA si se pierde el dispositivo (issue #50, ver
  [Recuperación de cuenta](#recuperación-de-cuenta-issue-50))
- Ownership estricto por `therapistId` en cada consulta — sin roles ni
  jerarquías: cada cuenta ve y administra únicamente sus propios pacientes
- Rate limiting con throttlers independientes por endpoint sensible (login,
  mfa/verify, signup, mfa/setup, password/change, password/reset,
  mfa/recover — `@nestjs/throttler`)
- Headers HTTP seguros con Helmet.js

### Gestión de Pacientes (Ley 20.584)
- Ficha completa con datos de identificación y contacto de emergencia
- Consentimiento granular por finalidad (`TREATMENT`, `TELEMEDICINE`) como
  ledger append-only (Ley 21.719) — otorgar o revocar no borra el historial
- Acceso a fichas siempre restringido al profesional dueño (`therapistId`) —
  sin excepciones ni accesos de terceros
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
- Biblioteca personal de archivos (plantillas, protocolos, formularios) —
  privada por cuenta, no se comparte entre profesionales ni está ligada a
  pacientes

### Perfil
- Cada cuenta puede ver y editar sus propios datos (email, nombre,
  contraseña) vía `GET`/`PATCH /profile` — sin panel de administración de
  terceros, porque no hay terceros que administrar

### Exportación PDF
- Generación de ficha clínica completa en PDF
- Incluye datos del paciente e historial clínico completo
- Pie de página con referencia a Ley 20.584 y custodia obligatoria de 15 años

### Auditoría (Bitácora Inmutable)
- Registro automático de todas las acciones del sistema vía interceptor global
- Campos: usuario, acción, recurso, IP, user-agent, timestamp y detalle
  libre (`detail`) cuando aplica
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
POST /api/v1/auth/signup
POST /api/v1/auth/verify-email
POST /api/v1/auth/login
POST /api/v1/auth/mfa/verify
POST /api/v1/auth/mfa/generate         🔒
POST /api/v1/auth/mfa/enable           🔒
POST /api/v1/auth/mfa/disable          🔒
POST /api/v1/auth/mfa/setup/begin      (setupToken)
POST /api/v1/auth/mfa/setup/confirm    (setupToken)
POST /api/v1/auth/mfa/recover          (email + password + recoveryCode, issue #50)
POST /api/v1/auth/password/change      (passwordChangeToken)
POST /api/v1/auth/password/forgot      (issue #50)
POST /api/v1/auth/password/reset       (resetToken, issue #50)
```

### Perfil
```
GET   /api/v1/profile    🔒
PATCH /api/v1/profile    🔒
```

### Pacientes
```
POST   /api/v1/patients                        🔒
GET    /api/v1/patients                        🔒
GET    /api/v1/patients/:id/history            🔒
GET    /api/v1/patients/:id                    🔒
PATCH  /api/v1/patients/:id                    🔒
DELETE /api/v1/patients/:id                    🔒
POST   /api/v1/patients/:id/consents           🔒
GET    /api/v1/patients/:id/consents/status    🔒
GET    /api/v1/patients/:id/consents           🔒
```

### Consultas
```
POST  /api/v1/consultations                        🔒
GET   /api/v1/consultations/patient/:patientId     🔒
GET   /api/v1/consultations/stats                  🔒
GET   /api/v1/consultations/:id                    🔒
PATCH /api/v1/consultations/:id/correct            🔒
```

### Documentos
```
POST /api/v1/documents/upload             🔒 (multipart, PDF/imagen, máx. 10MB)
GET  /api/v1/documents/patient/:patientId 🔒
GET  /api/v1/documents/:id/download       🔒
```

### Archivos personales
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

El script de backup está en `backups/backup.sh`. Antes de activarlo, configura dos archivos protegidos **fuera del repositorio** (nunca en git):

```bash
# 1. Credenciales de base de datos
echo "localhost:5432:umbral_db:umbral_user:TU_PASSWORD" >> ~/.pgpass
chmod 600 ~/.pgpass

# 2. Frase de cifrado — guarda una copia en un gestor de contraseñas.
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

Hay dos formas de correr el backup, según dónde se ejecute:

#### A) Automatizado vía GitHub Actions (producción actual)

`backups/backup.sh` asume una VM persistente con cron propio — este repo
corre el backend en Render free tier, que no tiene un proceso persistente
para cron (issue #10 evaluó y descartó migrar a una VM por ahora). Por eso
la copia offsite en producción corre como un workflow programado
(`.github/workflows/backup.yml`): todos los días hace `pg_dump` contra
Supabase, cifra igual que `backup.sh` y sube el resultado a B2 vía rclone,
sin depender de ningún servidor propio.

Setup (una sola vez):

1. Crear cuenta gratuita en Backblaze B2 y un bucket **privado**.
2. Instalar [`rclone`](https://rclone.org) en cualquier máquina (puede ser
   tu laptop, no hace falta que sea el servidor) y correr `rclone config`
   para generar el remote con el Application Key de B2. El archivo
   resultante (`~/.config/rclone/rclone.conf`) es el contenido del secret
   `RCLONE_CONFIG_CONTENT` de abajo.
3. Cargar estos secrets en GitHub (repo → Settings → Secrets and
   variables → Actions):

   | Secret | Valor |
   |---|---|
   | `BACKUP_DB_URL` | El `DIRECT_URL` de Supabase (session pooler, puerto 5432 — mismo que usa Render para `prisma migrate deploy`, no el transaction pooler) |
   | `BACKUP_PASSPHRASE` | `openssl rand -base64 48` — guarda una copia en un gestor de contraseñas, sin ella los backups son irrecuperables |
   | `RCLONE_CONFIG_CONTENT` | Contenido completo de `rclone.conf` generado en el paso 2 |
   | `B2_BUCKET_PATH` | `nombre-del-remote:mi-bucket/umbral/` (el remote que configuraste en `rclone config`) |

4. Disparar el workflow manualmente una vez (`Actions` → `Backup offsite` →
   `Run workflow`) y verificar que el archivo aparezca en el bucket de B2.
5. Verificar al menos una restauración real desde la copia offsite antes de
   dar por cerrado el punto (ver "Restaurar un backup" abajo). **Hecho y
   verificado el 2026-08-03** (issue #56): se bajó el `.sql.gz.enc` real de
   B2, se desencriptó y restauró contra un Postgres local descartable. Las
   11 tablas de `schema.prisma` restauraron con datos correctos (incluido
   `_prisma_migrations` con las 21 migraciones aplicadas) y el trigger
   `trg_audit_log_append_only` siguió bloqueando `UPDATE` después de
   restaurar. El dump completo también arrastra ~600 errores esperables de
   roles/extensiones internas de Supabase (`supabase_admin`,
   `dashboard_user`, `vault`, `pgbouncer`, etc.) que no existen fuera de su
   infraestructura — no son un problema, `psql -f` los saltea y sigue con
   el resto del archivo.

> Mientras estos 4 secrets no estén cargados, el workflow no falla: corta
> antes de instalar nada y termina en success con un aviso en el step
> summary de la corrida ("Backup offsite salteado: faltan uno o más
> secrets de B2"). No hace falta desactivar el cron a mano mientras B2
> todavía no está configurado.

#### B) Manual / local (`backup.sh`)

Sigue siendo útil para correr un backup puntual desde tu propia máquina, o
si en algún momento se migra a una VM persistente (issue #10) y conviene
volver a un cron tradicional:

```bash
chmod +x backups/backup.sh

# Agregar al cron (ejecuta todos los días a las 2:00 AM)
crontab -e
```

Agregar la siguiente línea:

```
0 2 * * * /ruta/completa/umbral-personal/backups/backup.sh >> /ruta/completa/umbral-personal/backups/backup.log 2>&1
```

Para que también suba a B2, setear `OFFSITE_UPLOAD_CMD` en el entorno de
esa máquina (nunca en el repo):

```bash
OFFSITE_UPLOAD_CMD="rclone copy {} b2remote:mi-bucket/umbral/"
```

Restaurar un backup (aplica a ambos casos, A y B; verificado end-to-end el
2026-08-03 contra un backup real bajado de B2, issue #56):

```bash
# 1. Bajar el backup más reciente de B2 (si restaurás desde la copia offsite,
#    no desde un backup.sh local):
rclone copy b2remote:mi-bucket/umbral/umbral_backup_2026-07-15_02-00-00.sql.gz.enc .

# 2. Desencriptar + descomprimir + restaurar. La frase de cifrado va siempre
#    en un archivo (nunca como argumento en texto plano, quedaría en el
#    historial de la shell):
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$HOME/.umbral_backup_passphrase" \
  -in umbral_backup_2026-07-15_02-00-00.sql.gz.enc | gunzip | \
  psql -U umbral_user -h localhost -d umbral_db
```

Si restaurás un dump que viene de Supabase (backup offsite vía A) contra un
Postgres que no es Supabase (ej. un descartable local para probar), vas a ver
~600 líneas de `ERROR: no existe el rol «...»` para roles internos de
Supabase (`supabase_admin`, `dashboard_user`, `vault`, `pgbouncer`, etc.) —
son esperables y no afectan las tablas de la app, `psql -f`/`psql <` los
saltea y sigue. Confirmá que restauró bien mirando solo tus tablas:

```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname = 'public';
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
| Consentimiento granular por finalidad (Ley 21.719) | Ledger append-only `PatientConsent` por `TREATMENT`/`TELEMEDICINE` |
| Sin acceso de terceros a fichas ajenas | Ownership estricto por `therapistId` — no existe ningún rol ni excepción que permita ver pacientes de otra cuenta |
| Inventario de tratamiento (RAT) | Ver [`docs/registro-actividades-tratamiento.md`](docs/registro-actividades-tratamiento.md) |
| Disponibilidad de la ficha ante pérdida de credenciales (Ley 20.584 art. 12, Ley 21.719) | Recuperación de cuenta self-service — ver abajo |

### Recuperación de cuenta (issue #50)

Sistema single-tenant: si el único usuario pierde su contraseña y/o el
dispositivo MFA, las fichas clínicas quedan inaccesibles vía la aplicación
hasta que pueda volver a entrar. Tres mecanismos, del menos al más invasivo:

1. **Contraseña olvidada** — `POST /api/v1/auth/password/forgot` con el
   email envía un link de un solo uso (30 min) vía Resend. `POST
   /api/v1/auth/password/reset` con ese token cambia la contraseña. No
   bypasea MFA: si la cuenta lo tiene habilitado, el siguiente login lo
   sigue exigiendo igual.
2. **MFA perdido (dispositivo extraviado)** — al habilitar MFA (`POST
   /api/v1/auth/mfa/enable`, o el paso 2 del enrolamiento forzado en `POST
   /api/v1/auth/mfa/setup/confirm`) se generan 10 códigos de recuperación de
   un solo uso, mostrados una única vez en la respuesta. `POST
   /api/v1/auth/mfa/recover` con email + contraseña + uno de esos códigos
   desactiva MFA sin necesitar el TOTP; el siguiente login vuelve a exigir
   enrolarlo. **Guardar esos 10 códigos en un gestor de contraseñas o
   impresos en un lugar seguro apenas se generan** — no hay forma de volver
   a verlos después.
3. **Último recurso: contraseña Y los 10 códigos de recuperación perdidos a
   la vez** — sin eso, no queda ningún camino self-service. Reset manual
   directo en base de datos, siempre dejando constancia en `AuditLog`:

   ```sql
   -- 1. Generar un hash argon2 nuevo para la contraseña temporal (fuera de
   --    la base, ej. con node -e "require('argon2').hash('...').then(console.log)")
   -- 2. Forzar el cambio en el próximo login, igual que el admin semilla:
   UPDATE "User"
   SET "passwordHash" = '<hash argon2 generado>',
       "mustChangePassword" = true,
       "mfaEnabled" = false,
       "mfaSecret" = NULL
   WHERE email = '<email de la cuenta>';

   -- 3. Dejar constancia auditable de la intervención manual (obligatorio):
   INSERT INTO "AuditLog" ("id", "userId", "action", "resource", "resourceId", "detail")
   VALUES (gen_random_uuid(), '<id de la cuenta>', 'MANUAL_ACCOUNT_RECOVERY', 'User', '<id de la cuenta>',
           'Reset manual en DB: contraseña y recovery codes perdidos a la vez. Autorizado por <quién/ticket>.');

   -- 4. Verificar en la MISMA sesión que el INSERT del paso 3 quedó escrito
   --    antes de cerrar la conexión (no asumir que "corrió sin error" =
   --    "quedó guardado" si hubo un rollback implícito de la transacción):
   SELECT id, "createdAt" FROM "AuditLog"
   WHERE "userId" = '<id de la cuenta>' AND action = 'MANUAL_ACCOUNT_RECOVERY'
   ORDER BY "createdAt" DESC LIMIT 1;
   ```

   `mustChangePassword=true` reusa el mismo flujo forzado que el admin
   semilla (`POST /api/v1/auth/password/change`): el próximo login exige
   cambiar la contraseña temporal antes de emitir cualquier token, y como
   `mfaEnabled` queda en `false`, ese mismo login fuerza un nuevo
   enrolamiento MFA con recovery codes frescos.

   🔒 **Issue #52 — el trigger append-only por sí solo no alcanza.**
   `trg_audit_log_append_only` impide modificar o borrar una fila ya
   escrita, pero no impedía que las mismas credenciales usadas para este
   procedimiento manual deshabiliten el trigger (`ALTER TABLE ... DISABLE
   TRIGGER` o `DROP TRIGGER`), hagan el reset sin dejar el paso 3, y lo
   reactiven después sin rastro — porque el rol de runtime de la app ERA el
   dueño de la tabla, y el dueño tiene esos permisos implícitos sin importar
   los GRANT/REVOKE.

   Primer intento descartado: un *event trigger* a nivel de base que
   bloqueara ese DDL sin importar el rol. `CREATE EVENT TRIGGER` requiere
   privilegios de superusuario en Postgres — verificado contra el rol real
   de producción (`SELECT rolsuper FROM pg_roles WHERE rolname =
   current_user`) que da `false`. No es viable en Supabase, ni en staging ni
   en producción: no es un problema de ambiente, es un techo de la
   plataforma.

   Fix real, migración `20260803060000_restrict_audit_log_owner_privileges`:
   se transfiere la ownership de `"AuditLog"` a un rol nuevo sin login
   (`audit_log_owner`), y el rol de runtime queda con `SELECT`/`INSERT`
   explícitos únicamente — sin `ALTER`/`TRIGGER`/`UPDATE`/`DELETE`. No
   necesita superusuario, solo que el rol que corre la migración tenga
   `CREATEROLE` (verificado con `SELECT rolcreaterole, rolcreatedb FROM
   pg_roles WHERE rolname = current_user` -> `true`). Probado
   end-to-end contra un cluster Postgres local descartable con un rol sin
   superusuario pero con ese mismo perfil de privilegios: `ALTER TABLE ...
   DISABLE TRIGGER` y `DROP TRIGGER` fallan por no ser dueño, `SET ROLE
   audit_log_owner` falla por no tener membership (no hay forma de asumir
   los privilegios del dueño), `UPDATE`/`DELETE` quedan bloqueados por
   permisos (ni siquiera llegan a evaluar el trigger), e `INSERT`/`SELECT`
   (lo único que usa `AuditService.log()`) siguen funcionando sin fricción.

   Nota operativa: una futura migración legítima que necesite alterar la
   estructura de `"AuditLog"` (ej. agregar una columna) va a fallar con este
   mismo rol porque ya no es el dueño — requiere un paso manual documentado
   (otorgar membership de `audit_log_owner` temporalmente, aplicar el
   cambio, revocarla de nuevo), no un `prisma migrate deploy` automático sin
   intervención.

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
| `MFA_APP_NAME` | Nombre que aparece en la app autenticadora | `Umbral - RCE` |
| `FRONTEND_URL` | URL del frontend (para CORS) | `http://localhost:5173` |
| `DOCUMENT_ENCRYPTION_KEY` | Clave AES-256 (base64, 32 bytes) para cifrar documentos de pacientes en reposo (T8.1) | Generar con `openssl rand -base64 32` |
| `PORT` | Puerto del backend | `3001` (default) |
| `NODE_ENV` | Entorno de ejecución; en `production` exige `JWT_SECRET` fuerte y distinto del valor de ejemplo | `production` |
| `RUN_MIGRATIONS` | Si es `true`, corre `prisma migrate deploy` al arrancar (ver `main.ts`) | `false` |
| `TRUSTED_PROXY_HOPS` | Cantidad de proxies confiables delante de la app, para identificar la IP real del cliente en el rate-limit de login (ver comentario en `auth.module.ts`) | `1` (un único proxy de edge, sin CDN delante). Con Render detrás de Cloudflare (deploy actual): `3` |
| `SEED_ADMIN_EMAIL` | Email del admin creado por `prisma db seed` (`npm run seed`) | `admin@umbral.cl` (default, ver `prisma/seed-admin.defaults.ts`) |
| `SEED_ADMIN_PASSWORD` | Contraseña inicial del admin creado por el seed | Ver advertencia abajo — **nunca dejar el default en un entorno alcanzable** |
| `RESEND_API_KEY` | API key de [Resend](https://resend.com) (free tier) para el email de verificación del signup propio (issue #5). Sin setear, `MailService` saltea el envío con un warning en logs — no bloquea signup en dev/test | Conseguir en el dashboard de Resend |
| `MAIL_FROM` | Remitente del email de verificación | `Umbral - RCE <onboarding@resend.dev>` (default) |

> ⚠️ Si el comando de arranque del hosting ya corre `prisma migrate deploy` antes de iniciar el server (recomendado), **no** setees `RUN_MIGRATIONS=true` también — no rompe nada (la migración es idempotente), pero la corre dos veces innecesariamente.

> 🔒 **El `DOCUMENT_ENCRYPTION_KEY` de ejemplo de arriba es público** (está en un repo público) — igual que con `JWT_SECRET`, en producción el arranque falla si detecta ese valor exacto o cualquier clave que no decodifique a 32 bytes en base64. Genera una propia con `openssl rand -base64 32` antes de desplegar.

> 🔒 **`SEED_ADMIN_PASSWORD` es pública si no la sobrescribes.** El default (`prisma/seed-admin.defaults.ts`) está commiteado en un repo público — cualquiera lo puede leer. La cuenta admin fuerza cambio de contraseña en su primer login (`mustChangePassword`), pero eso solo protege si el operador cambia la clave *antes* de que alguien más la use con la contraseña conocida: quien loguee primero con el default se queda con el `passwordChangeToken` y puede tomar la cuenta. En local/CI el default está bien (nadie más tiene acceso a esa base). En **cualquier entorno alcanzable desde afuera** (staging, producción), configura `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` a valores propios antes de correr el seed por primera vez.

---

## Licencia

Uso privado — Umbral - RCE © 2026. Todos los derechos reservados.
