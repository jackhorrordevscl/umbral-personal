# Umbral: Sistema de Gestión Clínica

![CI](https://github.com/jackhorrordevscl/umbral-personal/actions/workflows/ci.yml/badge.svg?branch=main)

Umbral es un sistema de fichas clínicas para un profesional de salud mental
que atiende por su cuenta (psicólogo/a, terapeuta). Cada cuenta es dueña
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
  imprimir/compartir](docs/manual-terapeutas.pdf)): manual funcional para
  terapeutas: crear tu cuenta, MFA obligatorio, recuperación de cuenta,
  pacientes, consultas, documentos, archivos personales y reportes PDF.
- [`docs/caso-de-uso-testing.md`](docs/caso-de-uso-testing.md): guía
  narrativa de testing manual/UAT paso a paso para voluntarios que prueban la
  app antes de que la usen pacientes reales.
- [`docs/registro-actividades-tratamiento.md`](docs/registro-actividades-tratamiento.md):
  Registro de Actividades de Tratamiento (RAT, Ley 21.719): qué datos se
  tratan, con qué finalidad, base legal y retención.
- [`docs/clausula-transferencia-internacional.md`](docs/clausula-transferencia-internacional.md):
  registro de la cláusula de transferencia internacional de datos incorporada
  a los documentos de consentimiento informado.
- [`docs/borrador-clausula-responsabilidad-documentos.md`](docs/borrador-clausula-responsabilidad-documentos.md):
  borrador de cláusula de responsabilidad sobre documentos aportados, pendiente
  de la revisión legal.
- [`docs/rotacion-y-respaldo-de-claves.md`](docs/rotacion-y-respaldo-de-claves.md):
  procedimiento operativo para respaldar y rotar las claves de cifrado
  (issue #382, ADR 0005).
- [`docs/incident-log.md`](docs/incident-log.md): bitácora de incidentes de
  seguridad reales: qué pasó, impacto, causa raíz, remediación y
  verificación.
- [`docs/evaluacion-v1.md`](docs/evaluacion-v1.md): evaluación de
  preparación para v1 (veredicto, bloqueantes, riesgos y checklist de salida).
- [`docs/datos-landing.md`](docs/datos-landing.md): ficha de datos
  verificados (funcionalidades, cifras, stack y qué no afirmar) para
  actualizar la landing page.
- [`docs/decisiones/`](docs/decisiones/): decisiones de arquitectura (ADR),
  p. ej. por qué NestJS y Vite están congelados en su major actual (0001; la
  parte de Tailwind se resolvió al migrar a la versión 4), la validación de
  formularios del frontend (0002), el almacenamiento de la sesión en el frontend (0003), el cifrado de
  datos clínicos (0004), el versionado y la rotación de claves (0005), el
  informe de alta con firma simple y hash (0006), los pacientes niños, niñas y adolescentes (NNA) y su
  representante legal (0007) y la respuesta uniforme de la reserva pública ante
  una colisión de identidad (0008).

---

## Stack Tecnológico

**Frontend**
- React 19.2 + TypeScript 5.9
- Vite 7 (congelado en su major actual, ver
  [ADR 0001](docs/decisiones/0001-congelar-majors-nestjs-vite-tailwind.md))
- Tailwind CSS 4.3 (vía `@tailwindcss/postcss`; migrado desde la 3.4, issue
  #458)
- React Router v8
- TanStack Query (React Query)
- React Hook Form + Zod 4
- Tiptap 3 (editor de texto enriquecido de las notas clínicas) y DOMPurify
- Axios
- Lucide React
- `react-window` (listas virtualizadas)
- Sentry (`@sentry/react`, captura de errores, opcional)
- Vitest 4 (tests unitarios y de componentes)
- Playwright con `@axe-core/playwright` (tests e2e y de accesibilidad de la
  reserva pública, el pago de la reserva y las notificaciones)

**Backend**
- NestJS 11 + TypeScript
- PostgreSQL 16 (local y CI; ver Requisitos Previos para producción)
- Prisma ORM 7.10 (con el adaptador `@prisma/adapter-pg`)
- JWT + Passport
- Argon2 (hash de contraseñas)
- Speakeasy (MFA/TOTP) y `qrcode` (código QR de enrolamiento)
- `google-auth-library` (OAuth 2.0 de Google Calendar)
- PDFKit (generación de la ficha clínica y del informe de alta en PDF)
- Helmet.js (seguridad HTTP)
- `@nestjs/throttler` (rate limiting)
- `@nestjs/schedule` (tareas programadas: recordatorios, purgas, reconciliaciones)
- Resend (`resend`, emails transaccionales)
- Jest 30 (tests unitarios y e2e)
- `sanitize-html` (sanitización de notas clínicas)
- `@aws-sdk/client-s3` (storage S3-compatible sobre Backblaze B2)
- Sentry (`@sentry/node`, captura de errores, opcional)

---

## Requisitos Previos

- Node.js 22.22 o superior (CI usa Node 22; `react-router` 8 exige
  `>=22.22.0` y `jsdom` 30 exige `^22.22.2` en el frontend, y Prisma 7 exige
  `^20.19 || ^22.12 || >=24`)
- PostgreSQL 16 en local y en CI; en producción Supabase gestiona la base
  (Postgres 17.x según el comentario de `.github/workflows/backup.yml`, ver
  sección [Despliegue](#despliegue-issue-8)). En local puede levantarse con el
  `docker-compose.yml` de la raíz (Postgres 16)
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

> Alternativa con Docker: `docker compose up -d` en la raíz levanta un
> Postgres 16 solo para desarrollo local (contenedor `umbral-postgres-local`,
> base `umbral_db`, usuario `umbral_user`, puerto 5432 enlazado a
> `127.0.0.1`). Las credenciales de ese archivo son ejemplos públicos: no
> usarlas fuera de desarrollo.
>
> Alternativa: `./install.sh` automatiza estos pasos (Node, PostgreSQL,
> creación de base, `.env`, dependencias, migraciones y seed) en
> Ubuntu/Debian. No configura backups: el respaldo corre en GitHub Actions
> (ver [Configuración de Backups](#configuración-de-backups)).

### 3. Configurar el Backend

```bash
cd backend
npm install   # backend/.npmrc ya activa legacy-peer-deps
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
# conexión directa, no la pooled: Prisma Migrate la necesita para funcionar.
DIRECT_URL="postgresql://umbral_user:tu_password_seguro@localhost:5432/umbral_db"
JWT_SECRET="cambia-este-secreto-en-produccion"
JWT_EXPIRES_IN="8h"
FRONTEND_URL="http://localhost:5173"
# Clave de cifrado de documentos (T8.1) -- genera la tuya con:
# openssl rand -base64 32
DOCUMENT_ENCRYPTION_KEY="+rPRh0H2ayZ4yAIjhOWbvOghetuNtScBP8g2VgNuBik="
# sdd/google-calendar-integration: clave AES-256-GCM propia (distinta de
# DOCUMENT_ENCRYPTION_KEY a propósito) para el refresh token de Google
# Calendar -- genera la tuya con: openssl rand -base64 32
GOOGLE_TOKEN_ENCRYPTION_KEY="vihs9JiRKVRGjurFGk+YqxhpvD7zanIZJgbHGeSOMi4="
# sdd/online-payment-integration: clave AES-256-GCM propia (distinta de
# DOCUMENT_ENCRYPTION_KEY/GOOGLE_TOKEN_ENCRYPTION_KEY) para la credencial del
# merchant Flow de cada terapeuta (PaymentAccount.credentialEncrypted, PR 2)
# -- genera la tuya con: openssl rand -base64 32
PAYMENT_CREDENTIALS_ENCRYPTION_KEY="wgh8ZnZbpZMfvKifp5ufX9uFp+WoISHDRsDCRFkRP1U="
# Issue #302: clave AES-256-GCM propia (distinta de las anteriores) para cifrar
# User.mfaSecret en reposo -- genera la tuya con: openssl rand -base64 32
MFA_SECRET_ENCRYPTION_KEY="MoDh8f3G8V0hR0m5wq8V0hR0m5wq8V0hR0m5wq8V0i8="
# ADR 0004 (opción B): clave AES-256-GCM propia para cifrar los textos clínicos
# libres (notas de consulta e informe de alta) en reposo -- genera la tuya con:
# openssl rand -base64 32
CLINICAL_TEXT_ENCRYPTION_KEY="Y2xpbmljYWwtdGV4dC1leGFtcGxlLWtleS0wMDAwMDA="
# Desactiva por completo la creación de cargos, el checkout, los emails de
# pago y el cron de vencimiento sin necesitar un deploy/revert (default:
# habilitado si está ausente)
PAYMENTS_ENABLED="false"
```

> La foto de perfil (`POST/GET/DELETE /profile/avatar`), los archivos
> personales (`shared-files`) y los documentos de ficha clínica (`documents`,
> issue #158) se guardan en Backblaze B2, no en disco local (issue #170).
> Sin `B2_AVATARS_*`/`B2_SHARED_FILES_*`/`B2_PATIENT_DOCUMENTS_*` configuradas
> en tu `.env` local, esas tres funciones fallan (ver Variables de Entorno).
> El informe de alta en PDF también se guarda como documento de ficha, por lo
> que depende de `B2_PATIENT_DOCUMENTS_*`. El resto de la app funciona igual
> sin ellas.

Generar el cliente de Prisma, ejecutar migraciones y seed inicial (Prisma 7 ya
no genera el cliente en el `postinstall`, así que `npx prisma generate` es un
paso explícito; `prisma.config.ts` toma la conexión de `DIRECT_URL`, o de
`DATABASE_URL` si no está definida):

```bash
npx prisma generate
npx prisma migrate deploy
npm run seed
```

### 4. Configurar el Frontend

```bash
cd ../frontend
npm install --legacy-peer-deps
```

En desarrollo, sin `VITE_API_URL` el frontend usa `http://localhost:3001/api/v1`
(ver `frontend/src/api/client.ts`). Si vas a usarlo en red local, define
`VITE_API_URL` en el `.env` del frontend con la IP de tu servidor:

```
VITE_API_URL=http://TU_IP:3001/api/v1
```

Y en el `.env` del backend define `LAN_DEV_URL` con el origen desde el que se
abre el frontend (por ejemplo `http://TU_IP:5173`), para que CORS lo acepte.

---

## Ejecución en Desarrollo

**Terminal 1: Backend**
```bash
cd backend
npm run start:dev
# Servidor en http://localhost:3001/api/v1
```

**Terminal 2: Frontend**
```bash
cd frontend
npm run dev
# App en http://localhost:5173
```

### Pruebas

| Alcance | Comando | Notas |
|---|---|---|
| Backend, unitarias | `cd backend && npm test` | Jest 30; `npm run test:cov` agrega cobertura |
| Backend, e2e | `cd backend && npm run test:e2e` | Jest + Supertest contra una base Postgres real (`backend/test/`); necesita las variables de entorno del job `backend` de `.github/workflows/ci.yml` |
| Frontend, unitarias y de componentes | `cd frontend && npm test` | Vitest 4 (jsdom); `npm run test:cov` agrega cobertura |
| Frontend, e2e | `cd frontend && npm run test:e2e` | Playwright (`frontend/e2e/`): reserva pública (escritorio y móvil), pago de la reserva y detalle de notificaciones |

Los e2e de Playwright necesitan el backend levantado (`npm run start:dev` o
`start:prod`) con las cuentas de prueba que crea `npm run seed:e2e` (se niega
a correr sin `E2E_SEED_CONFIRM=1`, `E2E_TEST_PASSWORD` y `E2E_TEST_MFA_SECRET`,
y nunca en producción) y con `PUBLIC_SCHEDULING_ENABLED=true`. Playwright
levanta por su cuenta el frontend (`npm run dev`) y el Flow simulado.
`frontend/playwright.config.ts` define dos proyectos: escritorio (`*.e2e.ts`)
y móvil, con el viewport de un Pixel 7 (`*.mobile.e2e.ts`, issue #419). En
local usan el navegador Brave instalado (ruta por defecto de Windows,
configurable con `PLAYWRIGHT_BRAVE_PATH`), por lo que no hace falta descargar
un navegador; en CI (`CI` definida) usan el Chromium de Playwright.

El e2e del pago (`public-booking-payment.e2e.ts`) nunca usa el sandbox real de
Flow: Playwright levanta un Flow simulado (`frontend/e2e/support/fake-flow-server.mjs`,
puerto 4010) y el backend debe arrancar con `PAYMENTS_ENABLED=true`,
`PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED=true`,
`FLOW_API_BASE_URL=http://127.0.0.1:4010` y `BACKEND_PUBLIC_URL=http://localhost:3001`
(como el job `e2e` de `ci.yml`). El seed crea para eso un terapeuta con cuenta de
pago conectada (credenciales falsas) y un paciente que ya existe con tarifa.

El workflow `ci.yml` (en `pull_request` y `push` a `main`, con Node 22 y
Postgres 16) corre tres jobs: backend (`prisma generate`, lint, migraciones,
seed, tests unitarios con cobertura, e2e y `npm audit --omit=dev
--audit-level=high`), frontend (lint, tests con cobertura, typecheck y build,
y el mismo `npm audit`) y e2e de Playwright contra un backend real con
Postgres.

### Cómo entrar la primera vez

No hay usuarios predefinidos por rol: cada profesional crea su propia
cuenta, pero desde el issue #124 el signup público exige un código de
invitación:

- **Alta normal**: `POST /auth/signup` (o el botón "Regístrate" del login)
  requiere `inviteCode` además de `email`/`password`/`name`, y crea la cuenta
  con `emailVerified: false`. El código se obtiene con `POST
  /auth/invitations` (requiere sesión), pero solo lo acepta si quien está
  logueado tiene el email configurado en `INVITE_CREATOR_EMAIL`; sin esa
  variable definida, nadie puede generar invitaciones y el signup público
  queda efectivamente cerrado. Sin `RESEND_API_KEY` configurada en local, el
  email de verificación no se envía de verdad: `MailService` lo omite con
  un warning en el log del backend (revísalo ahí para obtener el enlace mientras
  pruebas en dev).
- **Cuenta semilla** (`npm run seed`, ver más abajo): crea una única cuenta
  de prueba para no tener que pasar por signup+verificación en cada corrida
  local. Es la vía más simple en dev para generar la primera invitación: define
  `INVITE_CREATOR_EMAIL` con el mismo email de la cuenta semilla
  (`SEED_ADMIN_EMAIL`), inicia sesión con ella, y llama a `POST /auth/invitations`
  desde la sección "Generar invitación" de Seguridad (o directo por API) para
  conseguir un código válido.

```
Email:     admin@umbral.cl
Password:  Umbral2024!
```

> ⚠️ Cambia estas credenciales inmediatamente después de instalar en un
> entorno alcanzable por otras personas (ver `SEED_ADMIN_EMAIL`/
> `SEED_ADMIN_PASSWORD` en Variables de Entorno). La cuenta semilla fuerza
> cambio de contraseña en su primer login (`mustChangePassword`), pero eso
> solo protege si cambias la clave **antes** de que alguien más la use con
> el valor conocido (es público, está en este repo).
>
> Si perdiste tu contraseña o el dispositivo MFA de una cuenta ya
> existente, no hace falta tocar la base de datos: ver
> [Recuperación de cuenta](#recuperación-de-cuenta-issue-50).

---

## Despliegue (issue #8)

**Backend ya desplegado y en producción** en Render:
https://umbralapi.groundzerodevs.com/api/v1 (servicio `umbral-backend`,
auto-deploy desactivado a propósito para no gastar crédito del free tier con
cada push; el deploy es manual desde el dashboard de Render). Stack:
**backend en Render** (free
tier, ver limitación de cold start más abajo), **frontend en Vercel**
(`vercel.json` en `frontend/`, con el rewrite del SPA y los headers de
seguridad, incluida una Content-Security-Policy), **Postgres
gestionado en Supabase** (Supavisor/PgBouncer en modo transacción: la
`DATABASE_URL` de producción necesita `?pgbouncer=true` al final, o el
runtime choca con "prepared statement already exists" en cada reinicio),
copia offsite de backups en **Backblaze B2** (ver
[Configuración de Backups](#configuración-de-backups)).

> **Cold start de Render (free tier):** el proceso duerme a los 15 minutos
> de inactividad y tarda 30-60s+ en despertar. Para el patrón de uso real
> (un profesional abriendo la app entre pacientes, sesiones de 45-50 min,
> más que el timeout de Render) esto va a notarse en casi cada apertura. Se
> acepta para el MVP mientras se prueba con el terapeuta; la migración a
> una VM Oracle Cloud Always Free (always-on real, sin cold start) queda
> planificada en el issue #10 para cuando el uso real lo confirme necesario.

> **Ping externo para mantener despierto el backend (issue #422):** un
> monitor externo (UptimeRobot) hace un `GET` cada 10 minutos a
> `https://umbralapi.groundzerodevs.com/api/v1/health`, con lo que el servicio
> no llega a los 15 minutos de inactividad y los procesos programados
> (recordatorios, reconciliación de pagos, sincronización de calendario)
> siguen corriendo. Como el endpoint ejecuta un `SELECT 1`, el ping también
> mantiene activa la base. Es un parche reversible, no una garantía: un
> deploy o un reinicio igual deja el servicio frío un momento. Para
> desactivarlo, pausar o borrar el monitor en el panel de UptimeRobot.
> **Límite de horas:** un servicio encendido todo el mes consume 720-744 de
> las 750 horas gratis del workspace de Render; por eso Umbral debe ser el
> único servicio free del workspace. Si se agregara otro, las horas se
> agotan y Render suspende todos los servicios free hasta el mes siguiente.

> **Topología de red y acceso al origen (issue #307):** el tráfico entra por
> el dominio propio `umbralapi.groundzerodevs.com`, que pasa por Cloudflare y
> luego por la infraestructura de Render hasta la app; por eso
> `TRUSTED_PROXY_HOPS=3`. El subdominio `umbral-backend-uces.onrender.com`
> está **desactivado** (Render → servicio → Settings → *Render Subdomain* =
> disabled): responde `404` con `x-render-routing: blocked-render-subdomain`.
> Es lo que impide llegar al origen sin pasar por el dominio propio y
> mandar un `X-Forwarded-For` falsificado para evadir los límites de tasa
> (login, MFA, reset, autoagenda pública). Si se reactiva ese subdominio, el
> límite por IP deja de ser confiable. Todas las URLs públicas que usa el
> backend (`BACKEND_PUBLIC_URL`, `GOOGLE_REDIRECT_URI`, webhook de Resend)
> apuntan al dominio propio. El valor `3` se deduce de esta topología; no se
> midió con un request real contra producción.

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
   (Blueprint) en la raíz: define el servicio, build/start command y qué
   env vars hay que cargar a mano (`sync: false` en el archivo). El start
   command es `npx prisma migrate deploy && npm run start:prod`, por lo que
   las migraciones se aplican solas en cada deploy. Cargar ahí
   mismo: `DATABASE_URL`/`DIRECT_URL` del paso 1, `DOCUMENT_ENCRYPTION_KEY`
   (`openssl rand -base64 32`), `GOOGLE_TOKEN_ENCRYPTION_KEY`,
   `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`, `MFA_SECRET_ENCRYPTION_KEY` y
   `CLINICAL_TEXT_ENCRYPTION_KEY` (cada una con su propia clave), `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
   (nunca el default del README), `RESEND_API_KEY`/`MAIL_FROM` (issue #5),
   `INVITE_CREATOR_EMAIL` (issue #124), `BACKEND_PUBLIC_URL` (URL pública del
   backend, usada para armar la URL de confirmación de pagos) y
   `FRONTEND_URL` (se completa después del paso 3, se puede editar y
   redeployar). `JWT_SECRET` se autogenera vía `generateValue: true`.
   También cargar `RESEND_WEBHOOK_SECRET` (issue #163): se genera al crear
   el webhook en el dashboard de Resend (sección Webhooks), apuntando a
   `<URL pública del backend>/api/v1/webhooks/resend`; el prefijo
   `/api/v1` es obligatorio, sin él la ruta da 404. El panel de Resend no
   tiene botón "Send test event"; para probarlo hay que disparar un envío
   real (por ejemplo, reenviar el email de verificación) y confirmar que
   el evento `email.delivered` llega con `200`. Con `MAIL_FROM` en el
   default `onboarding@resend.dev` (dominio sandbox), Resend restringe el
   envío únicamente al email con el que te registraste en la cuenta, en
   cualquier ambiente. Para enviar a cualquier destinatario (pacientes
   incluidos) hay que verificar un dominio propio en el dashboard de
   Resend (SPF/DKIM) y actualizar `MAIL_FROM` a ese dominio.
   También cargar `B2_AVATARS_ENDPOINT`/`B2_AVATARS_REGION`/
   `B2_AVATARS_BUCKET`/`B2_AVATARS_KEY_ID`/`B2_AVATARS_APPLICATION_KEY`
   (issue #170): storage de avatares en un bucket B2 **privado y separado**
   del que usan los backups offsite (ver
   [Copia offsite real](#copia-offsite-real-backblaze-b2--rclone)): crear
   una Application Key nueva restringida solo a ese bucket, Read+Write.
   Mismo criterio para `B2_SHARED_FILES_ENDPOINT`/`B2_SHARED_FILES_REGION`/
   `B2_SHARED_FILES_BUCKET`/`B2_SHARED_FILES_KEY_ID`/
   `B2_SHARED_FILES_APPLICATION_KEY` (issue #170): storage de los archivos de la biblioteca privada
   de cada terapeuta (`shared-files`), en otro bucket B2 **propio**, también
   separado del de avatares y del de backups offsite: crear otra
   Application Key restringida solo a ese bucket, Read+Write.
   Mismo criterio para `B2_PATIENT_DOCUMENTS_ENDPOINT`/
   `B2_PATIENT_DOCUMENTS_REGION`/`B2_PATIENT_DOCUMENTS_BUCKET`/
   `B2_PATIENT_DOCUMENTS_KEY_ID`/`B2_PATIENT_DOCUMENTS_APPLICATION_KEY`
   (issue #158): storage de los documentos de ficha clínica (`documents`:
   exámenes, certificados, consentimientos), cifrados con AES-256-GCM antes
   de subirlos, en un bucket B2 **propio**, separado del de avatares,
   shared-files y backups offsite, con su propia Application Key
   restringida solo a ese bucket, Read+Write.
   Opcionalmente, cargar `SENTRY_DSN` (issue #191) para el error tracking, y
   las variables de Google Calendar, pagos y auto-agenda pública
   (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`,
   `PAYMENTS_ENABLED`, `PUBLIC_SCHEDULING_ENABLED`) si se activan esas
   funciones (ver Variables de Entorno). Para rotar claves de cifrado, el
   `render.yaml` también declara las variables `*_KEYRING` y
   `*_ACTIVE_KEY_ID` (ver
   [`docs/rotacion-y-respaldo-de-claves.md`](docs/rotacion-y-respaldo-de-claves.md)).
3. **Frontend en Vercel**: importar el repo con root directory `frontend/`
   (usa `vercel.json` para el rewrite de rutas del SPA). Variable
   `VITE_API_URL` apuntando a la URL pública del backend de Render + `/api/v1`.
   Con la URL final de Vercel, volver al paso 2 y definir `FRONTEND_URL` en
   Render (lo usa `main.ts` para CORS).
4. Correr `npm run seed` una vez contra la base de Supabase (con
   `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` de producción en el entorno) para
   crear el usuario semilla.
5. Configurar backups offsite: ver
   [Copia offsite real](#copia-offsite-real-backblaze-b2--rclone).

### Orden de despliegue en cambios de contrato

Los dos servicios se despliegan de forma distinta: **Vercel (frontend)
despliega solo al mergear a `main`**, mientras que **Render (backend) es
manual** desde el dashboard. Un merge que cambia el contrato de la API deja
el frontend nuevo hablando con el backend anterior hasta que se despliega
Render (ocurrió con la paginación de `GET /patients`, issue #290). Para que
el orden de despliegue no importe, un cambio de contrato se hace en pasos
compatibles:

1. **Backend compatible**: un PR que acepta el formato anterior y el nuevo.
   Se mergea, se despliega Render a mano y se verifica.
2. **Frontend**: un PR que pasa a usar el formato nuevo. Se mergea cuando el
   paso 1 ya está en producción.
3. **Limpieza** (opcional): un PR que retira el formato anterior del backend,
   una vez que el frontend nuevo ya está en producción.

Si un cambio no puede ser compatible (por ejemplo, cambia un tipo de
respuesta sin alternativa), mergear solo después de desplegar el backend en
Render, o pausar el auto-deploy del proyecto en Vercel hasta que el backend
esté arriba.

Antes de desplegar Render conviene revisar lo que trae el backend desde el
último deploy: migraciones en `backend/prisma/`, cambios en `render.yaml` y
variables nuevas en `backend/src/config/env.validation.ts`. Después del
deploy, comprobar que `/api/v1/health` responde `200` (es el `healthCheckPath`
de `render.yaml` y ejecuta un `SELECT 1` contra la base) y que la pantalla
afectada carga en producción.

---

## Estructura del Proyecto

```
umbral-personal/
├── backend/
│   ├── prisma.config.ts          # Configuración de Prisma 7 (schema, migraciones, seed y conexión DIRECT_URL)
│   ├── prisma/
│   │   ├── schema.prisma         # Modelos de base de datos (un solo Role: PROFESSIONAL)
│   │   ├── seed.ts               # Seed de la cuenta semilla (y feriados con SEED_HOLIDAYS=true)
│   │   ├── seed-admin.defaults.ts # Credenciales por defecto de la cuenta semilla (compartidas con los e2e)
│   │   ├── seed-e2e.ts           # Seed de la cuenta con MFA para los tests e2e de Playwright (opt-in)
│   │   └── migrations/           # Historial de migraciones
│   ├── src/
│   │   ├── instrument.ts         # Inicialización de Sentry (se importa antes que el resto de la app)
│   │   ├── config/               # Validación de variables de entorno al arrancar (env.validation.ts)
│   │   ├── health/               # GET /health (SELECT 1 contra la base, usado por Render y el monitor externo)
│   │   ├── common/
│   │   │   ├── guards/           # JwtAuthGuard (sin guard de roles -- ownership por therapistId) y SessionOriginGuard (exige un Origin del frontend en peticiones que cambian estado con la cookie de sesión)
│   │   │   ├── decorators/       # CurrentUser, AuditRead (auditoría de lecturas/descargas), SkipAudit
│   │   │   ├── interceptors/     # Audit Interceptor
│   │   │   ├── middleware/       # IP real del cliente (TRUSTED_PROXY_HOPS) y NoStore (cabeceras de no cachear)
│   │   │   ├── filters/          # Filtros de excepciones (AllExceptions, Prisma)
│   │   │   ├── crypto/           # AES-256-GCM compartido, llaveros versionados y recifrado (issue #382)
│   │   │   ├── dto/              # DTOs compartidos (paginación)
│   │   │   ├── validators/       # Validadores de class-validator propios
│   │   │   └── utils/            # Storage B2, sanitizado de notas, hora de Chile, edad/NNA, RUT, slug, máscara de emails, etc.
│   │   ├── modules/
│   │   │   ├── auth/             # Signup, login, JWT, MFA obligatorio, sesiones revocables, recuperación de cuenta
│   │   │   ├── patients/         # CRUD, consentimientos, representantes legales y asentimiento de NNA, historial
│   │   │   ├── consultations/    # Registro clínico versionado
│   │   │   ├── discharges/       # Informe de alta: cierre de tratamiento, PDF, hash de integridad y entregas
│   │   │   ├── documents/        # Documentos adjuntos por paciente
│   │   │   ├── profile/          # Ver/editar los propios datos de cuenta + cambio de email diferido
│   │   │   ├── notifications/    # Modelo genérico de notificaciones in-app (sdd/session-reminders)
│   │   │   ├── reminders/        # Cron de recordatorios de sesión (24h/2h, in-app + email)
│   │   │   ├── calendar-integration/ # OAuth + sync push-only con Google Calendar (issue #78)
│   │   │   ├── availability/     # Horario semanal, bloqueos y cálculo de horarios libres (sdd/patient-self-scheduling)
│   │   │   ├── payments/         # Cuenta Flow por terapeuta, cargos y webhook de confirmación (sdd/online-payment-integration)
│   │   │   ├── public-scheduling/ # Portal público de auto-agenda sin autenticación (sdd/patient-self-scheduling)
│   │   │   ├── mail/             # Envío de emails transaccionales (Resend)
│   │   │   ├── webhooks/         # Webhook de Resend (tracking de entrega/apertura de emails)
│   │   │   ├── reports/          # Generación de PDF de la ficha clínica
│   │   │   └── audit/            # Bitácora inmutable (interceptor global)
│   │   ├── shared-files/         # Biblioteca personal (plantillas, protocolos) -- privada por usuario
│   │   └── prisma/               # Servicio Prisma
│   ├── test/                     # Tests e2e del backend (Jest + Supertest, contra Postgres real)
│   ├── scripts/                  # Scripts manuales (seed-holidays, notify-document-reupload, reencrypt-keys; este último con `npm run crypto:reencrypt`)
│   └── .env.example
├── frontend/
│   ├── src/
│       ├── api/                  # Cliente HTTP (Axios) y módulos por recurso
│       │                         # (availability, consultations, discharges,
│       │                         # documents, notifications, patients, payments,
│       │                         # publicScheduling, reports)
│       ├── context/              # AuthContext
│       ├── components/           # Layout, IdleManager, IdleWarningModal,
│       │                         # ErrorBoundary, RecoveryCodesReveal
│       │                         # y subcarpetas por dominio: availability/,
│       │                         # booking/, calendar/, consultations/,
│       │                         # discharges/, notifications/, patients/,
│       │                         # payments/, reminders/, ui/ (Modal,
│       │                         # ConfirmDialog, ErrorBanner, EmptyState,
│       │                         # FormField, PasswordInput, RichTextEditor)
│       ├── hooks/                # Un hook de TanStack Query por dominio
│       │                         # (usePatients, useConsultations,
│       │                         # useDischarges, useGuardians, useAssents,
│       │                         # useAvailability, usePaymentAccount,
│       │                         # useProfile, useMfa, etc.) + useIdleTimeout
│       ├── utils/                # api-error, availability, datetime, download,
│       │                         # error-tracking (Sentry), age, rut, etc.
│       ├── types/, test/         # Tipos compartidos, setup de Vitest y tests de accesibilidad (test/a11y)
│       └── pages/                # Login, Signup, VerifyEmail, ForgotPassword,
│                                  # ResetPassword, MfaRecover, ConfirmEmailChange,
│                                  # Dashboard, Patients, Consultations, Calendar,
│                                  # Payments, PaymentReturn, PublicBooking,
│                                  # Profile (datos de cuenta), Security (MFA,
│                                  # conexión Google Calendar), SharedFiles
│   ├── e2e/                      # Tests e2e de Playwright (*.e2e.ts, *.mobile.e2e.ts) y helpers
│   ├── playwright.config.ts      # Proyectos de escritorio y móvil (Pixel 7)
│   ├── vitest.config.ts          # Configuración de Vitest (jsdom, cobertura)
│   └── vercel.json               # Rewrite del SPA y headers de seguridad (CSP)
├── docs/                         # Manual de uso, caso de testing, RAT, cláusulas, rotación de claves,
│   │                             # incident-log, evaluación de v1 y ficha de datos para la landing
│   ├── decisiones/               # ADR (decisiones de arquitectura)
│   └── evidencia-compliance/     # DPA y términos de proveedores, salida de npm audit
├── odd/tasks/                    # Documentos de seguimiento de features (ODD)
├── openspec/                     # Specs y cambios SDD (changes/, specs/)
├── .github/
│   ├── workflows/                # CI (ci.yml: backend, frontend y e2e de Playwright) y backup diario (backup.yml)
│   └── ISSUE_TEMPLATE/           # Plantillas de issues (bug, feature, deuda técnica)
├── docker-compose.yml            # Postgres 16 para desarrollo local
├── render.yaml                   # Blueprint del backend en Render
├── install.sh                    # Instalador para Ubuntu/Debian
├── LICENSE
└── README.md
```

---

## Funcionalidades

### Autenticación y Seguridad
- Alta propia (self-signup) con verificación de email: no hay un admin que
  cree cuentas, cada profesional se registra solo (issue #5); desde el issue
  #124 requiere además un código de invitación de un solo uso, generado por
  el único email configurado en `INVITE_CREATOR_EMAIL` (sin rol ADMIN,
  decisión explícita; ver Variables de Entorno)
- Login con email y contraseña (hash Argon2)
- Tokens JWT con expiración configurable y sesiones revocables (ver Perfil).
  La sesión viaja en una cookie HttpOnly `SameSite=Strict`, por lo que
  frontend y API deben ser same-site (mismo dominio registrable); en el
  navegador solo queda en `localStorage` el dato no secreto `user` (issue
  #387, ADR 0003)
- **MFA obligatorio para toda cuenta** (TOTP, compatible con Google
  Authenticator y Authy): se enrola forzosamente en el primer login exitoso,
  no es opcional ni depende de un rol. El secreto TOTP se guarda cifrado en
  reposo (`MFA_SECRET_ENCRYPTION_KEY`, issue #302) y cada código solo puede
  usarse una vez (`lastUsedStep`). Además del límite por IP, cada cuenta
  admite 5 intentos de segundo factor (TOTP o código de recuperación) por
  hora antes de bloquearse con esperas crecientes de 1, 5, 15 y 60 minutos
  (responde 429; acertar el código limpia el contador, issue #487)
- Cifrado en reposo con AES-256-GCM y llaveros versionados: documentos de
  pacientes, refresh token de Google, credenciales de Flow, secreto TOTP y
  textos clínicos libres (notas de consulta, informe de alta, y el título y
  cuerpo de las notificaciones internas) usan cada uno su propia clave, y
  pueden rotarse sin perder datos (issue #382, ver
  [`docs/rotacion-y-respaldo-de-claves.md`](docs/rotacion-y-respaldo-de-claves.md))
- Defensa contra CSRF en profundidad: una petición `POST`/`PUT`/`PATCH`/
  `DELETE` que viaja con la cookie de sesión debe venir de un origen
  permitido (`FRONTEND_URL`, `LAN_DEV_URL`); si no, responde 403
  (`SessionOriginGuard`, issue #487). Toda respuesta de la API lleva
  `Cache-Control: no-store`
- Los códigos de invitación se guardan como hash SHA-256 (`codeHash`), no en
  claro, y un alta con un email que ya tiene cuenta responde igual que una
  alta nueva (el titular recibe un aviso por email), para no revelar quién
  usa Umbral (issue #487)
- Recuperación de cuenta self-service sin intervención manual en la base de
  datos: contraseña olvidada por email, y 10 códigos de recuperación de un
  solo uso para desactivar MFA si se pierde el dispositivo (issue #50, ver
  [Recuperación de cuenta](#recuperación-de-cuenta-issue-50))
- Ownership estricto por `therapistId` en cada consulta: sin roles ni
  jerarquías, cada cuenta ve y administra únicamente sus propios pacientes
- Rate limiting con throttlers independientes por endpoint sensible (login,
  mfa/verify, signup, mfa/setup, mfa/enable, mfa/disable, password/change, password/reset,
  mfa/recover, verificación y reenvío de email, confirmación de cambio de
  email, `PATCH /profile`, la exportación de la ficha en PDF y los
  endpoints públicos de pagos y de auto-agenda; `@nestjs/throttler`). La IP
  del cliente se resuelve con
  `TRUSTED_PROXY_HOPS`
- Headers HTTP seguros con Helmet.js; en el frontend, Content-Security-Policy
  y demás headers definidos en `frontend/vercel.json` (ADR 0003)
- Cierre de sesión por inactividad en el frontend (aviso previo con
  `IdleWarningModal`)

### Gestión de Pacientes (Ley 20.584)
- Ficha completa con datos de identificación y contacto de emergencia
- Consentimiento granular por finalidad (`TREATMENT`, `TELEMEDICINE`) como
  ledger append-only (Ley 21.719): otorgar o revocar no borra el historial.
  La declaración retroactiva en bloque (issue #131) permite registrar el
  consentimiento de pacientes ya existentes; se audita una fila por cada
  paciente del lote (issue #488)
- Acceso a fichas siempre restringido al profesional dueño (`therapistId`),
  sin excepciones ni accesos de terceros. El RUT del paciente es único por
  terapeuta, no global (issue #314)
- Soft delete: los registros nunca se eliminan físicamente
- Búsqueda por nombre o RUT con listado paginado, historial de cambios
  (`PatientHistory`) y desglose por canal de origen en el dashboard
- Estado del tratamiento (`treatmentStatus`): `ACTIVE`, `DISCHARGED`,
  `REFERRED` o `DROPPED_OUT`. Un tratamiento cerrado no admite consultas
  nuevas ni reservas públicas; agendar una consulta con confirmación
  (`reopenPatient`) lo reabre (ver Informe de alta)

### Pacientes NNA y representante legal (ADR 0007)
- La edad se calcula en el servidor (mayoría de edad a los 18 años, hora de
  Chile). Cada ficha informa si el paciente es NNA y su estado
  (`minorStatus`), por ejemplo falta de representante o consentimiento
  heredado otorgado por el propio paciente
- Hasta dos representantes legales por paciente (`LegalGuardian`: nombre, RUT,
  relación, email, teléfono, tutela `SOLE`/`SHARED`/`UNKNOWN`, conflicto entre
  representantes y permisos de consentir, acceder a reportes, recibir
  comunicaciones y pagar), con alta, edición y baja desde la ficha
  (`/patients/:patientId/guardians`). El RUT de un representante debe ser
  distinto al del paciente y al de otro representante del mismo paciente
  (responde 409, issue #488)
- Para un NNA, otorgar el consentimiento de tratamiento exige un
  representante con permiso de consentir; revocarlo nunca se bloquea. El
  ledger de consentimientos registra quién lo otorgó (`grantedBy`:
  `PATIENT` o `GUARDIAN`). Desde la fecha de vigencia 2026-12-01
  (`MINOR_GUARDIAN_ENFORCEMENT_DATE`) el consentimiento de un NNA debe
  haberlo otorgado su representante; antes de esa fecha el consentimiento
  heredado se acepta y se marca como `LEGACY_CONSENT`
- Asentimiento del NNA (`PatientAssent`, ledger append-only): el paciente
  con menos de 14 años es informado y escuchado, y de 14 a 17 años se registra su
  asentimiento (`GRANTED`, `REFUSED`, `WITHDRAWN` o `INFORMED_AND_HEARD`);
  bajo 14 años el registro manual no admite `GRANTED` (responde 400).
  Nunca reemplaza el consentimiento del representante, y un rechazo no
  bloquea nada: alerta al terapeuta (`/patients/:patientId/assents`)
- Al subir un documento de consentimiento de un NNA se exige indicar el
  representante que lo firma. Al subir un documento de asentimiento se
  registra el asentimiento del NNA junto con el documento: `GRANTED` desde los
  14 años e `INFORMED_AND_HEARD` bajo esa edad
- Auto-agenda pública de NNA: la reserva identifica al paciente por su
  RUT y el del representante, que es el contacto de pago y comunicaciones.
  Ese representante se crea sin permiso de consentir ni de acceder a reportes
  (el terapeuta los habilita al verificarlo; ver Auto-agenda pública)

### Registro Clínico
- Registro cronológico de sesiones con fecha y hora automática
- Campos: motivo de consulta, intervención, acuerdos y próxima sesión
- Soporte para sesiones presenciales y telemedicina
- Sistema de versionado legal: las correcciones crean nuevas versiones sin
  alterar el original (`ConsultationHistory`)
- Las notas clínicas (motivo de consulta, intervención) se sanitizan en el
  backend (`sanitize-html`) y se editan con un editor de texto enriquecido
  (Tiptap)
- Vista de calendario mensual de las sesiones (`GET /consultations/range`)
- Al agendar una consulta de un paciente con tratamiento cerrado, el backend
  responde `409` con el código `PATIENT_TREATMENT_CLOSED`; reenviar la
  solicitud con `reopenPatient` reabre el tratamiento y lo audita como
  `TREATMENT_REOPENED` (issue #446)

### Informe de alta (ADR 0006)
- Cierre formal del tratamiento con un informe versionado e inmutable
  (`TreatmentDischarge`). Motivo de cierre: `DISCHARGED`, `REFERRED` o
  `DROPPED_OUT`; en una deserción se exige el motivo (`DropoutReason`) y,
  para `OTHER`, una nota breve; en una derivación se puede indicar el destino
- Dos orígenes: informe **generado** por Umbral (borrador editable que se
  emite con `POST /discharges/:id/issue`, con PDF propio) o informe
  **aportado** por el terapeuta (`POST /patients/:patientId/discharges/upload`,
  solo PDF, que nace emitido y la interfaz lo identifica como aportado, no
  como generado por el sistema)
- Al emitir, el informe fija un hash SHA-256 canónico del contenido y un
  snapshot del firmante (nombre, RUT y registro profesional del perfil). Para
  un informe generado, el RUT del terapeuta en el perfil es obligatorio.
  `GET /discharges/:id/verify` recalcula el hash y comprueba la integridad
  del PDF guardado (la respuesta trae `hashScope`: `CONTENT` en un informe
  generado y `FILE_ONLY` en uno aportado, donde la huella cubre solo el
  archivo y no los datos del cierre); el PDF se cifra y se guarda como documento de ficha
  (`DISCHARGE_REPORT`) y no se puede subir por la vía de documentos comunes
- Un informe emitido nunca se edita: `POST /discharges/:id/correct` (o
  `correct-upload` para uno aportado) crea una versión nueva que hereda el
  `groupId`
- Emitir el informe cancela las consultas futuras del paciente (vista previa
  en `GET /patients/:patientId/discharges/cancellation-preview`), borra sus
  eventos de Google Calendar y avisa por email al paciente adulto, o a los
  representantes que reciben comunicaciones si es NNA, sin incluir el
  motivo del cierre. Se audita como `TREATMENT_CLOSED`, `DISCHARGE_ISSUE` y
  `CONSULTATION_CANCELLED`
- Registro de entregas (`DischargeDelivery`, solo se agrega): a quién se
  entregó el informe (paciente, representante o tercero), con qué fin y por
  qué canal (`IN_PERSON`, `EMAIL`, `POSTAL`, `OTHER`). La entrega a un tercero
  exige un documento de autorización del mismo paciente (`DELIVERY_AUTHORIZATION`)
  y una declaración del terapeuta de que lo revisó; Umbral solo deja
  constancia de esa declaración y no valida el documento. No se puede
  registrar la entrega de un informe reemplazado por una versión posterior ni
  de uno con el PDF anulado (responde 409). Se audita como
  `DISCHARGE_DELIVER`; la descarga del PDF se audita como lectura

### Documentos y Archivos
- Documentos clínicos por paciente (consentimiento informado, asentimiento
  informado, acuerdo de telemedicina, informe del paciente, resumen de
  sesión, resultado de examen, autorización de entrega, informe de alta y
  otros), PDF, Word, Excel, ZIP e imágenes hasta 25MB, cifrados con AES-256-GCM
  antes de subirse a B2
- Anulación de documentos subidos por error, con motivo obligatorio: el
  documento no se elimina (custodia de 15 años), queda marcado como anulado y
  sigue descargable. Si sustentaba el consentimiento vigente y no queda otro
  documento del mismo tipo, se registra un `REVOKE` en el ledger de
  consentimientos
- Biblioteca personal de archivos (plantillas, protocolos, formularios):
  privada por cuenta, no se comparte entre profesionales ni está ligada a
  pacientes

### Perfil (issue #76)
- Cada cuenta puede ver y editar sus propios datos (email, nombre,
  contraseña) vía `GET`/`PATCH /profile`, sin panel de administración de
  terceros, porque no hay terceros que administrar. También se editan el RUT
  y el registro profesional del terapeuta (`rut`, `professionalRegistration`),
  que se copian al informe de alta al emitirlo
- Cambio de nombre inmediato; cambio de email diferido hasta confirmarlo
  desde un enlace de un solo uso enviado a la casilla nueva (`POST
  /profile/email-change/confirm`), con aviso a la casilla antigua
- Cambiar la contraseña invalida la sesión en **todos** los dispositivos,
  no solo el actual (`passwordChangedAt` comparado contra el `iat` del
  JWT en cada request)
- Sesiones revocables: cada JWT de sesión lleva un `jti` respaldado por una
  fila de `Session`; `JwtStrategy` exige que esté activa (no revocada ni
  vencida). `POST /auth/logout` revoca la sesión actual y `POST
  /auth/logout-all` todas las del usuario (auditados como `LOGOUT` /
  `LOGOUT_ALL`). Los tokens emitidos antes de este cambio no traen `jti` y se
  rechazan: cada usuario vuelve a iniciar sesión una vez. Un cron diario
  (04:00) borra las sesiones expiradas o revocadas hace más de 7 días
  (`SESSION_PURGE_ENABLED`)
- Throttler propio (`profile-update`, keyed por `userId`) en `PATCH
  /profile`, independiente del resto de los throttlers de `auth`
- Foto de perfil: subir/reemplazar (`POST /profile/avatar`, JPG/PNG/WEBP/GIF
  hasta 5MB), verla (`GET /profile/avatar`) y eliminarla (`DELETE
  /profile/avatar`), almacenada en Backblaze B2, no en disco local (ver
  Variables de Entorno, `B2_AVATARS_*`, issue #170)
- Perfil público (issue #155): bio (hasta 500 caracteres) y especialidad
  (hasta 120 caracteres), editables desde la sección "Perfil público" junto
  al resto de los datos de cuenta (mismo `PATCH /profile`); se muestran sin
  autenticación en la auto-agenda pública (ver más abajo)
- Sitio web del terapeuta (`User.website`, opcional, solo `http`/`https`):
  se edita en Perfil con el mismo `PATCH /profile` y se muestra como enlace
  en la tarjeta de perfil de la agenda pública

### Recordatorios y notificaciones (sdd/session-reminders)
- Modelo genérico de notificaciones in-app (`GET /notifications`, contador
  de no leídas, marcar una o todas como leídas). El título y el cuerpo se
  guardan cifrados con `CLINICAL_TEXT_ENCRYPTION_KEY` (pueden nombrar al
  paciente) y la API los devuelve en claro
- Recordatorio automático de sesión 24h y 2h antes de cada consulta
  agendada, por dos canales independientes (in-app + email) con garantía
  de envío exactamente una vez por (consulta, offset, canal); un fallo en
  un canal no bloquea ni duplica el otro
- Cron de escaneo cada 5 minutos (`RemindersService`, desactivable con
  `REMINDERS_ENABLED=false` sin necesitar un deploy/revert)
- Tracking de entrega y apertura del canal email (issue #163): `POST
  /webhooks/resend` (público, sin JWT) recibe los eventos
  `email.delivered`/`email.opened` de Resend, verifica la firma Svix contra
  `RESEND_WEBHOOK_SECRET` y actualiza `ReminderDispatch.deliveredAt`/
  `openedAt` por `resendMessageId`. Sin `RESEND_WEBHOOK_SECRET` configurada
  responde `501`; firma inválida responde `401`. El estado más reciente por
  sesión se muestra como badge (enviado/entregado/abierto/no enviado) en la
  lista de consultas
- Notificación al terapeuta cuando un paciente nuevo se autoagenda: avisa que
  agendó su primera sesión y recuerda definir el monto de cobro
  (`defaultSessionAmount`) en su ficha, para no perder ese cargo en silencio
  (`PATIENT_MISSING_SESSION_AMOUNT`)
- Tipos de notificación (`NotificationType`): `SESSION_REMINDER`,
  `GOOGLE_CALENDAR_DISCONNECTED`, `PAYMENT_LATE`,
  `PATIENT_MISSING_SESSION_AMOUNT`, `PATIENT_DOCUMENT_REUPLOAD_REQUIRED` (aviso
  único de un script de mantenimiento) y `PAYMENT_ANOMALY` (la pasarela
  reportó un cobro inconsistente)
- Purga diaria (04:30) de notificaciones **leídas** con más de 30 días
  (`NOTIFICATIONS_PURGE_RETENTION_DAYS`, desactivable con
  `NOTIFICATIONS_PURGE_ENABLED=false`) y de las **no leídas** con más de 90 días
  desde su creación (`NOTIFICATIONS_PURGE_UNREAD_RETENTION_DAYS`)

### Integración con Google Calendar (sdd/google-calendar-integration, issue #78)
- Conexión OAuth 2.0 por cuenta de terapeuta (`calendar.events`, acceso
  offline), con refresh token cifrado AES-256-GCM en reposo
  (`GOOGLE_TOKEN_ENCRYPTION_KEY`, clave propia distinta de
  `DOCUMENT_ENCRYPTION_KEY`)
- Sincronización de una sola vía (Umbral → Google): crear/corregir una
  consulta crea o actualiza el evento; un paciente eliminado borra sus
  eventos futuros. Lo que se edite en Google nunca se refleja en Umbral
- Contenido minimizado: el evento solo lleva iniciales del paciente, un
  código corto no reversible y un link a Umbral, nunca el nombre
  completo, el RUT, el tipo de sesión ni texto clínico
- Backfill acotado a una ventana al conectar; reconciliador periódico que
  repara links fallidos y eventos desincronizados
- El `state` del OAuth va atado al navegador que inició la conexión mediante
  una cookie propia (`umbral_calendar_oauth`, `SameSite=Lax`): sin ella el
  callback no completa el flujo (issue #497)
- Ante un token revocado o expirado (401/`invalid_grant`), la conexión se
  marca desconectada y se notifica una sola vez, sin reintentar en loop
- Toda falla de sincronización es un efecto secundario no bloqueante: la
  escritura clínica que la dispara siempre se guarda igual
- Desactivable por completo con `GOOGLE_CALENDAR_SYNC_ENABLED=false`; sin
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` el módulo se registra
  deshabilitado sin bloquear el arranque
- **Limitación conocida, pendiente de terceros (issue #123):** la app OAuth
  de Google está publicada (no en modo "Testing"), por lo que los refresh
  tokens no expiran a los 7 días. La verificación del scope sensible
  `calendar.events` sigue en revisión en Google; mientras no se complete, el
  terapeuta ve el aviso de "app no verificada" al conectar y Google limita la
  app a 100 usuarios. No es un bug de Umbral, es una restricción de la app
  OAuth mientras no esté verificada. Usa un cliente OAuth de desarrollo
  separado del de producción para `localhost` (ver `GOOGLE_REDIRECT_URI`)
- Conectar o desconectar el calendario queda registrado en la bitácora
  (`CALENDAR_CONNECTED`/`CALENDAR_DISCONNECTED`). Si se conecta otra cuenta de Google, Umbral no
  detecta el cambio (el scope `calendar.events` no expone el email de la
  cuenta) y los eventos ya creados en la cuenta anterior quedan ahí, sin
  borrarse (limitación documentada, issue #427)

### Cobro en línea (sdd/online-payment-integration, sdd/payments-multigateway-redesign)
- Cargo pendiente automático al crear una consulta, solo si el terapeuta
  dueño tiene su propia cuenta Flow conectada (cuenta *therapist-owned*:
  cada terapeuta aporta sus propias credenciales de comercio Flow).
  Umbral nunca custodia los fondos del paciente ni guarda las credenciales
  en claro: se cifran en reposo con `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`
- El cargo queda identificado por el `groupId` de la consulta (no por su
  id de versión): corregir una sesión actualiza el mismo cargo y mueve su
  fecha de vencimiento en vez de crear uno segundo
- Monto snapshoteado al crear el cargo (`Patient.defaultSessionAmount` o un
  override por sesión): un cambio posterior del monto por defecto nunca
  reescribe un cargo ya emitido. El mínimo que acepta Flow es 350 CLP
- El vencimiento del cargo suma 24 horas de gracia a la fecha de la sesión
  (o a la fecha de creación, si la sesión ya ocurrió), issue #284
- Cron de reconciliación cada 30 minutos (`PaymentReconciliationService`):
  consulta a Flow los cargos pendientes cuyo callback pudo perderse, marca
  como vencidos (`LATE`) los que pasaron su fecha y notifica al terapeuta
  (`PAYMENT_LATE`). El webhook `POST /payments/confirm` sigue siendo la fuente
  de confirmación, y el estado que ve el paciente al volver del checkout
  (`GET /payments/return-status`) no revela datos personales
- Reintento de cobro: si al crear la consulta no se pudo generar el cargo en
  Flow (por ejemplo, por un fallo transitorio), `POST
  /payments/:groupId/retry-charge` vuelve a intentar crear la orden para un
  cargo que todavía no tiene link de pago (issue #271). Si Flow no confirmó
  si creó la orden (timeout o corte de red tras enviar), el cobro queda con un
  aviso de verificación manual y el reintento responde 409 hasta que el
  terapeuta confirme con `{ "confirmOrderNotCreated": true }` que no existe
  una orden con el identificador de la sesión en su panel de Flow (issue #494)
- Wizard de 5 pasos conecta la cuenta Flow del terapeuta (pegar
  apiKey/secretKey, validar contra Flow antes de persistir, confirmación);
  reemplaza el flujo `onboard()`/`createMerchant` retirado
- Desactivable por completo con `PAYMENTS_ENABLED=false` sin necesitar un
  deploy/revert; sin una cuenta Flow conectada, agendar sesiones se
  comporta exactamente igual que sin este módulo

### Auto-agenda pública de pacientes (sdd/patient-self-scheduling)
- Portal público sin autenticación (`/book/:therapistId`) donde el paciente
  ve los horarios libres del terapeuta y reserva su propia sesión, sin que
  el terapeuta la agende a mano. El link se arma con el slug del terapeuta
  (`User.slug`, derivado de su nombre: `/book/juan-jose-martinez`); se
  regenera cuando el terapeuta cambia su nombre, por lo que el link con el
  slug anterior deja de funcionar. El UUID sigue siendo válido en la misma
  ruta, así que los links antiguos no se rompen
- Perfil público del terapeuta (issue #155) antes del calendario: nombre,
  foto (cuadrada, con degradación graciosa a iniciales si no hay avatar o
  falla el fetch), especialidad, bio y sitio web, vía `GET
  /public/therapists/:therapistId/profile` y `GET
  /public/therapists/:therapistId/avatar`, ambos sin autenticación. El
  avatar responde con `Cross-Origin-Resource-Policy: cross-origin` (issue
  #168, necesario porque frontend y backend viven en dominios distintos en
  producción) y `404` en vez de `500` si el archivo no existe en B2 (issue
  #169)
- Origen del paciente (issue #157/#165): si la reserva llega con `utm_source`
  o `document.referrer`, Umbral lo guarda en el nuevo paciente
  (`Patient.acquisitionSource`/`acquisitionReferrer`) y lo resume por canal
  en el dashboard (`GET /patients/stats/acquisition`), sección "Origen de
  pacientes"
- El terapeuta configura su propio horario semanal recurrente y sus
  bloqueos (día completo, rango horario o rango de fechas) desde Perfil,
  sin acceso admin/dev, y define ahí mismo la duración de sus sesiones
  (`User.sessionDurationMinutes`)
- Cálculo de horarios libres al momento de la consulta (con cache en
  memoria de ~5 min): resta consultas ya agendadas, bloqueos del
  terapeuta y feriados de Chile (`PublicHoliday`, sembrados desde
  Boostr.cl) sobre la regla semanal
- Ventana de reserva de 24h de anticipación mínima y 60 días de horizonte
  máximo (constantes fijas, no configurables por env)
- Identidad del paciente resuelta por `(email, therapistId)`: si ya existe
  como paciente de ese terapeuta y el RUT enviado coincide con el guardado,
  la reserva se liga a su ficha completa;
  si no, se crea un `Patient` nuevo con un formulario público reducido
  (nombre, RUT, fecha de nacimiento, email), sin monto por defecto de
  cobro ni documentos de consentimiento, que siguen siendo manejados por
  el terapeuta. Sin OTP ni ningún paso de autenticación para el paciente.
  Si el paciente es adulto y su ficha ya existe, pero tiene el tratamiento
  cerrado, la reserva no se crea (ver la respuesta uniforme más abajo)
- Reserva de un NNA: el formulario pide además los datos de un
  representante legal (nombre, RUT, relación y email obligatorio, teléfono
  opcional). El NNA se identifica por su RUT dentro del terapeuta y el
  representante por el suyo, porque un NNA puede no tener email propio; la
  ficha del NNA y su representante se crean en la misma transacción que la
  consulta. Una ficha de NNA nunca se reutiliza solo por email
- Concurrencia real garantizada por `BookedSlot` (`(therapistId, slotStart)`
  único) dentro de una transacción: un doble booking simultáneo
  devuelve `409 Conflict` limpio en vez de duplicar la sesión
- Respuesta uniforme ante colisión de identidad (ADR 0008, issue #502): si el
  email o el RUT ya pertenecen a una ficha del terapeuta y no coinciden entre
  sí, el email es ambiguo, la ficha es de un NNA o el tratamiento está
  cerrado, el endpoint responde `201` con la misma forma que una reserva nueva
  (ids inventados), sin crear consulta, paciente, representante ni
  notificación, para no revelar quién se atiende con el terapeuta. Si la ficha
  tiene email, se le envía un aviso de que la solicitud no pudo completarse.
  Los rechazos que dependen solo del request (horario ya no disponible, `409`;
  tope diario, `429`; representante ausente, `400`; dígito verificador del RUT
  del representante inválido, `409`) siguen siendo errores
- La reserva creada dispara los mismos efectos secundarios no bloqueantes
  que una consulta agendada por el terapeuta (sync a Google Calendar,
  cargo Flow pendiente). No se envía email de confirmación al paciente
  ni de aviso al terapeuta todavía (fuera de alcance de este cambio)
- Throttlers propios `public-availability` (lectura) y `public-booking`
  (escritura, mismo presupuesto conservador que login/signup), keyed por
  IP + terapeuta (y hash SHA-256 del email en booking, nunca en claro)
- Desactivable por completo con `PUBLIC_SCHEDULING_ENABLED=false` (o sin
  definir, que es el default) sin necesitar un deploy/revert; cubre tanto
  la lectura de disponibilidad como la reserva

#### Overlay de Google Calendar y checkout en línea (sdd/public-booking-payment-calendar)
- Overlay opcional (`CALENDAR_AVAILABILITY_OVERLAY_ENABLED=true`): un cron
  cada 30 min (`CalendarBusyService`) sincroniza los eventos ocupados del
  Google Calendar ya conectado del terapeuta (mismo scope `calendar.events`,
  sin re-consentimiento) a `CalendarBusyBlock`, y `computeSlots()` los resta
  del grid de horarios libres junto con los bloqueos propios de Umbral
- Checkout en línea opcional (`PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED=true`):
  si el terapeuta tiene una cuenta Flow `CONNECTED` y el paciente ya existe
  con `defaultSessionAmount` resuelto, la confirmación de la reserva
  pública consulta periódicamente `GET .../book/:groupId/checkout` y muestra el link de
  pago en la misma página, además del email existente
- Los dos flags son independientes entre sí: cada uno lee su propia env
  var y ninguno consulta ni depende del estado del otro: apagar uno no
  afecta al otro. Ambos son opt-in (`=== 'true'`, no `!== 'false'`): sin
  definir, ninguno de los dos cambia el comportamiento pre-existente

### Exportación PDF
- Generación de ficha clínica completa en PDF (`GET /reports/patient/:patientId`)
- Incluye datos del paciente e historial clínico completo. Una ficha con más
  de 500 sesiones no se exporta (responde 422)
- Limitada a 5 exportaciones por minuto por terapeuta (`REPORTS_EXPORT_*`) y
  auditada como `EXPORT_PDF` antes de entregar el archivo: si la fila de
  auditoría no se puede escribir, la ficha no se entrega
- Pie de página con referencia a Ley 20.584 y custodia obligatoria de 15 años
- El informe de alta tiene su propio PDF (`GET /discharges/:id/pdf`), ver
  Informe de alta

### Auditoría (Bitácora Inmutable)
- Registro automático de las acciones del sistema vía interceptor global,
  incluidas las lecturas (`GET` queda como `VIEW`) y las descargas, que se
  marcan con `@AuditRead` (issue #175). Las rutas del informe de alta que
  registran su propia fila explícita usan `@SkipAudit` para no duplicarla
- Acciones sensibles con su propio tipo: inicio y cierre de sesión (`LOGIN`,
  `LOGIN_FAILED`, `LOGOUT`, `LOGOUT_ALL`), MFA, recuperación de cuenta,
  cambios de contraseña y de email, conexión de Google Calendar y de la
  cuenta de pagos, anulación de documentos y ciclo de vida del informe de alta
- Los accesos denegados o a recursos inexistentes o ajenos se registran como
  `UNAUTHORIZED_ATTEMPT`, con un tope por IP y ventana
  (`UNAUTHORIZED_AUDIT_LIMIT`)
- Campos: usuario, acción, recurso, IP, user-agent, timestamp y detalle
  libre (`detail`) cuando aplica
- Tabla append-only: ningún registro puede modificarse ni eliminarse

### Backups Automáticos
- Workflow diario de GitHub Actions (`.github/workflows/backup.yml`), sin
  depender de ningún servidor propio (issue #8)
- Compresión gzip + cifrado AES-256 de los respaldos (nunca se escribe un
  volcado sin cifrar a disco)
- Sin rotación: se conserva todo indefinidamente. Al volumen real
  (~250 KB/backup diario, medido el 2026-10-14 en un respaldo con datos de
  prueba), 15 años de historial completo ocupan ~1,4 GB y entran en los 10 GB
  gratis de B2; si el volumen crece unas 7 veces se superaría ese tope. No hace
  falta distinguir "operativo" de
  "custodia legal" (Ley 20.584: 15 años)
- Copia offsite real vía Backblaze B2 + `rclone`, con una Application Key
  restringida (sin `deleteFiles`) para que un secret filtrado no permita
  borrar el historial (issue #58)
- Tercera copia local en la máquina del terapeuta, espejo de B2 vía una key
  de solo lectura separada (regla 3-2-1, issue #57); ver sección
  [Copia offsite real](#copia-offsite-real-backblaze-b2--rclone)

---

## API Endpoints

Todas las rutas usan el prefijo global `/api/v1`.

### Autenticación
```
POST /api/v1/auth/signup               (requiere inviteCode, issue #124)
POST /api/v1/auth/invitations          🔒 (solo INVITE_CREATOR_EMAIL, issue #124)
POST /api/v1/auth/verify-email
POST /api/v1/auth/verify-email/resend
POST /api/v1/auth/login
POST /api/v1/auth/mfa/verify
POST /api/v1/auth/mfa/generate         🔒
POST /api/v1/auth/mfa/enable           🔒
POST /api/v1/auth/mfa/disable          🔒
POST /api/v1/auth/mfa/setup/begin      (setupToken)
POST /api/v1/auth/mfa/setup/confirm    (setupToken)
POST /api/v1/auth/logout               🔒
POST /api/v1/auth/logout-all           🔒
POST /api/v1/auth/mfa/recover          (email + password + recoveryCode, issue #50)
POST /api/v1/auth/password/change      (passwordChangeToken)
POST /api/v1/auth/password/forgot      (issue #50)
POST /api/v1/auth/password/reset       (resetToken, issue #50)
```

### Perfil
```
GET   /api/v1/profile                        🔒
PATCH /api/v1/profile                        🔒
GET   /api/v1/profile/mfa-history            🔒
POST  /api/v1/profile/email-change/confirm      (token de un solo uso)
POST   /api/v1/profile/avatar                 🔒 (multipart, imagen, máx. 5MB)
GET    /api/v1/profile/avatar                 🔒
DELETE /api/v1/profile/avatar                 🔒
```

### Pacientes
```
POST   /api/v1/patients                        🔒
GET    /api/v1/patients                        🔒 (paginado: ?search=&page=&pageSize=, devuelve total)
GET    /api/v1/patients/summary                🔒 (total de pacientes y con consentimiento vigente)
GET    /api/v1/patients/stats/acquisition      🔒 (desglose por canal de origen, issue #157/#165)
GET    /api/v1/patients/:id/history            🔒
GET    /api/v1/patients/:id                    🔒
PATCH  /api/v1/patients/:id                    🔒
DELETE /api/v1/patients/:id                    🔒
POST   /api/v1/patients/:id/consents           🔒
GET    /api/v1/patients/:id/consents/status    🔒
GET    /api/v1/patients/:id/consents           🔒
POST   /api/v1/patients/consents/bulk-declare  🔒 (declaración retroactiva en bloque, issue #131; no revierte revocaciones ni repite ids)
GET    /api/v1/patients/:patientId/guardians                🔒 (representantes legales, máx. 2)
POST   /api/v1/patients/:patientId/guardians                🔒
PATCH  /api/v1/patients/:patientId/guardians/:guardianId    🔒
DELETE /api/v1/patients/:patientId/guardians/:guardianId    🔒
GET    /api/v1/patients/:patientId/assents                  🔒 (asentimiento de NNA)
POST   /api/v1/patients/:patientId/assents                  🔒
```

### Informe de alta
```
POST  /api/v1/patients/:patientId/discharges                      🔒 (crea el borrador)
GET   /api/v1/patients/:patientId/discharges                      🔒
GET   /api/v1/patients/:patientId/discharges/cancellation-preview 🔒 (consultas futuras que cancelaría el cierre)
POST  /api/v1/patients/:patientId/discharges/upload               🔒 (informe aportado por el terapeuta, solo PDF)
GET   /api/v1/discharges/:id                                      🔒
PATCH /api/v1/discharges/:id                                      🔒 (edita un borrador)
POST  /api/v1/discharges/:id/issue                                🔒 (emite, cierra el tratamiento y cancela consultas futuras)
POST  /api/v1/discharges/:id/correct                              🔒 (nueva versión de un informe generado)
POST  /api/v1/discharges/:id/correct-upload                       🔒 (nueva versión de un informe aportado)
GET   /api/v1/discharges/:id/pdf                                  🔒
GET   /api/v1/discharges/:id/verify                               🔒 (recalcula el hash de integridad)
POST  /api/v1/discharges/:id/deliveries                           🔒 (registra una entrega)
GET   /api/v1/discharges/:id/deliveries                           🔒
```

### Consultas
```
POST  /api/v1/consultations                        🔒
GET   /api/v1/consultations/patient/:patientId     🔒
GET   /api/v1/consultations/stats                  🔒
GET   /api/v1/consultations/range                  🔒 (rango de fechas, sdd/session-calendar-view)
GET   /api/v1/consultations/:id                    🔒
PATCH /api/v1/consultations/:id/correct            🔒
```

### Documentos
```
POST /api/v1/documents/upload             🔒 (multipart, PDF/Word/Excel/ZIP/imagen, máx. 25MB)
GET  /api/v1/documents/patient/:patientId 🔒
POST /api/v1/documents/:id/void           🔒 (anulación con motivo obligatorio, issue #270)
GET  /api/v1/documents/:id/download       🔒
```

### Archivos personales
```
GET    /api/v1/shared-files              🔒
GET    /api/v1/shared-files/:id          🔒
GET    /api/v1/shared-files/:id/download 🔒
POST   /api/v1/shared-files/upload       🔒 (multipart, máx. 50MB)
PATCH  /api/v1/shared-files/:id          🔒
DELETE /api/v1/shared-files/:id          🔒
```

### Reportes
```
GET /api/v1/reports/patient/:patientId    🔒
```

### Notificaciones
```
GET   /api/v1/notifications                 🔒
GET   /api/v1/notifications/unread-count    🔒
PATCH /api/v1/notifications/read-all        🔒
PATCH /api/v1/notifications/:id/read        🔒
```

### Integración con Google Calendar
```
GET  /api/v1/calendar-integration/status        🔒
POST /api/v1/calendar-integration/authorize     🔒
GET  /api/v1/calendar-integration/callback         (redirect de Google, sin auth)
POST /api/v1/calendar-integration/disconnect    🔒
```

### Auto-agenda / Disponibilidad (sdd/patient-self-scheduling)
```
GET    /api/v1/availability/schedule                                 🔒
PUT    /api/v1/availability/schedule                                 🔒
GET    /api/v1/availability/blockouts                                🔒
POST   /api/v1/availability/blockouts                                🔒
DELETE /api/v1/availability/blockouts/:id                            🔒
GET    /api/v1/public/therapists/:therapistId/availability              (pública, sin auth)
POST   /api/v1/public/therapists/:therapistId/availability/book         (pública, sin auth)
GET    /api/v1/public/therapists/:therapistId/availability/book/:groupId/checkout  (pública, sin auth, link de checkout de la reserva)
GET    /api/v1/public/therapists/:therapistId/profile                   (pública, sin auth, issue #155)
GET    /api/v1/public/therapists/:therapistId/avatar                    (pública, sin auth, issue #155)
```
Las de `availability` requieren `PUBLIC_SCHEDULING_ENABLED=true` (ver
Variables de Entorno) y no llevan 🔒 porque son intencionalmente accesibles
sin sesión, porque es el portal que usa el paciente para autoagendarse. `profile`
y `avatar` (issue #155) no dependen de ese flag y quedan siempre públicas.
En todas estas rutas `:therapistId` acepta el slug del terapeuta o su UUID;
un valor desconocido responde igual que antes (`404`, o lista vacía en
`availability`). El rate limit por `ip:therapistId` usa el valor tal cual
viene en la ruta, así que slug y UUID cuentan en buckets separados.

### Cobro en línea (sdd/online-payment-integration, sdd/payments-multigateway-redesign)
```
GET    /api/v1/payments/account                  🔒
POST   /api/v1/payments/account/validate         🔒 (paso previo del wizard, sin persistir)
POST   /api/v1/payments/account                   🔒 (confirmación, persiste la cuenta Flow)
DELETE /api/v1/payments/account                   🔒
PATCH  /api/v1/payments/:groupId                  🔒 (corrige el monto de un cargo; 409 si la pasarela ya lo registra pagado)
POST   /api/v1/payments/:groupId/resend-link       🔒
POST   /api/v1/payments/:groupId/retry-charge      🔒 (reintenta crear el cargo cuando aún no tiene link de pago, issue #271; 409 si el intento anterior quedó incierto y falta `confirmOrderNotCreated`)
POST   /api/v1/payments/confirm                       (webhook de Flow, sin auth, firma verificada)
GET    /api/v1/payments/return                        (redirect del paciente tras el checkout, sin auth)
POST   /api/v1/payments/return                        (mismo caso, safety net de método HTTP)
GET    /api/v1/payments/return-status?token=          (estado PAID/PENDING/REJECTED del cobro tras el checkout, sin auth, sin datos personales)
```

### Webhooks
```
POST /api/v1/webhooks/resend    (webhook de Resend, sin JWT, firma Svix verificada; 501 sin RESEND_WEBHOOK_SECRET)
```

### Salud del servicio
```
GET /api/v1/health    (sin auth, SELECT 1 contra la base; 200 {"status":"ok"} o 503)
GET /api/v1/          (sin auth, respuesta de texto fija de `AppController`, sin uso funcional)
```

> 🔒 Requiere sesión: el JWT viaja en la cookie `umbral_session` (HttpOnly,
> `SameSite=Strict`, `Secure` en producción) que el backend emite al iniciar
> sesión, o en el header `Authorization: Bearer <token>`, que sigue siendo
> válido (`JwtStrategy` acepta ambos; issue #387, ADR 0003).

---

## Configuración de Backups

Producción corre íntegramente vía GitHub Actions: no hay ningún script
local que configurar. Ver el setup completo en la sección siguiente.

### Copia offsite real (Backblaze B2 + rclone)

Proveedor elegido: **Backblaze B2** (10 GB gratis de forma permanente, no
trial; el backup ya llega cifrado con AES-256 antes de subirse, así que B2
nunca tiene acceso al contenido en claro). Se descartó usar hosting propio
existente (ej. HostGator) porque su Acceptable Use Policy prohíbe
explícitamente usar el espacio de shared hosting como *"offsite storage of
electronic files"* (ver la discusión completa en el issue #17).

#### A) Automatizado vía GitHub Actions (producción actual)

Este repo corre el backend en Render free tier, que no tiene un proceso
persistente para cron (issue #10 evaluó y descartó migrar a una VM por
ahora). Por eso la copia offsite en producción corre como un workflow
programado (`.github/workflows/backup.yml`): todos los días a las 05:00 UTC
(y a demanda con `workflow_dispatch`) hace `pg_dump` contra Supabase (con el
cliente `postgres:17-alpine` vía Docker), cifra el resultado (gzip + AES-256)
y lo sube a B2 vía `rclone` (versión 1.75.0 fijada y verificada con SHA256),
sin depender de ningún servidor propio.

Setup (una sola vez):

1. Crear cuenta gratuita en Backblaze B2 y un bucket **privado**.
2. Crear una Application Key **restringida al bucket** con capabilities
   `listFiles` + `writeFiles` únicamente (sin `deleteFiles` ni
   `readFiles`), que es la key que va a vivir en el secret de CI. El
   workflow de GitHub Actions solo necesita subir backups nuevos
   (`rclone copy`), nunca leerlos ni borrarlos, así que aunque el secret
   `RCLONE_CONFIG_CONTENT` se filtre (ej. una vulnerabilidad en una
   Action de terceros), un atacante no puede borrar el historial de
   backups existente, que es el escenario de ransomware que el offsite
   debería mitigar (issue #58). Para restaurar o listar backups desde tu
   propia máquina, genera una segunda key aparte con `readFiles` +
   `listFiles` (sin `writeFiles`) y úsala solo local, nunca en un secret
   de CI.
3. Instalar [`rclone`](https://rclone.org) en cualquier máquina (puede ser
   tu laptop, no hace falta que sea el servidor) y correr `rclone config`
   para generar el remote con la Application Key de CI del paso 2. El
   archivo resultante (`~/.config/rclone/rclone.conf`) es el contenido
   del secret `RCLONE_CONFIG_CONTENT` de abajo.
4. Cargar estos secrets en GitHub (repo → Settings → Secrets and
   variables → Actions):

   | Secret | Valor |
   |---|---|
   | `BACKUP_DB_URL` | El `DIRECT_URL` de Supabase (session pooler, puerto 5432, el mismo que usa Render para `prisma migrate deploy`, no el transaction pooler) |
   | `BACKUP_PASSPHRASE` | `openssl rand -base64 48`; guarda una copia en un gestor de contraseñas, sin ella los backups son irrecuperables |
   | `RCLONE_CONFIG_CONTENT` | Contenido completo de `rclone.conf` generado en el paso 3 |
   | `B2_BUCKET_PATH` | `nombre-del-remote:mi-bucket/umbral/` (el remote que configuraste en `rclone config`) |

5. Disparar el workflow manualmente una vez (`Actions` → `Backup offsite` →
   `Run workflow`) y verificar que el archivo aparezca en el bucket de B2.
6. Verificar al menos una restauración real desde la copia offsite antes de
   dar por cerrado el punto (ver "Restaurar un backup" abajo). **Hecho y
   verificado el 2026-08-03** (issue #56); detalle completo del
   procedimiento y resultado en [`docs/incident-log.md`](docs/incident-log.md).

> Si falta alguno de estos 4 secrets, el workflow falla (queda en rojo) en su
> primer paso con el error "Backup offsite sin configurar, faltan secrets: ..."
> antes de instalar nada (issue #209): un backup omitido en silencio pasaría
> desapercibido. Los secrets deben estar cargados antes de habilitar el cron.

#### B) Tercera copia local (regla 3-2-1, issue #57)

Con Supabase (origen) + B2 (offsite) hay 2 copias en 2 medios, pero la regla
3-2-1 completa pide 3 copias, 1 offsite. Falta una segunda copia de
respaldo en un medio físico distinto: la máquina local del terapeuta,
sincronizada desde B2.

Importante: se usa `rclone copy`, **no** `rclone sync`, porque `sync` replica
borrados desde B2 hacia lo local, así que si un backup se borra por error
(o la cuenta de B2 se ve comprometida) esa pérdida se propagaría a la
copia local. `copy` solo agrega, nunca borra.

También importante: esto **lee** de B2 (`GET` de descarga), algo que la key
`umbral-backup-ci` del punto A no puede hacer a propósito (solo tiene
`listFiles,writeFiles`). Hace falta una segunda Application Key,
de solo lectura, exclusiva para este uso local:

```bash
b2 key create --bucket mi-bucket umbral-local-mirror listFiles,readFiles
```

Setup (una sola vez):

1. Agregar un segundo remote en `rclone.conf` (junto al usado por el punto
   A) con las credenciales de la key de solo lectura de arriba (nunca la
   de CI):

   ```ini
   [b2read]
   type = b2
   account = <keyID de umbral-local-mirror>
   key = <applicationKey de umbral-local-mirror>
   ```

2. Elegir una carpeta local como destino (ej. `b2-local-mirror/` en la raíz
   del repo, agregada a `.gitignore` para que nunca se trackee) y correr
   una vez a mano para confirmar:

   ```bash
   rclone copy b2read:mi-bucket/umbral/ b2-local-mirror/
   ```

3. Automatizar con el Task Scheduler de Windows (`onlogon`, para no
   depender de que la máquina esté encendida a una hora fija):

   ```
   schtasks /create /tn "UmbralBackupLocalMirror" /tr "<ruta>\backup-local-mirror.bat" /sc onlogon /rl limited /f
   ```

   donde el `.bat` solo llama a `rclone copy` con el mismo comando del
   paso 2.

Costo real: $0 (mismo `rclone` del punto A, sin secrets nuevos ni
infraestructura adicional).

Restaurar un backup (aplica a los dos casos, A y B; verificado end-to-end el
2026-08-03 contra un backup real bajado de B2, issue #56):

```bash
# 1. Bajar el backup más reciente de B2 (o usar directamente el archivo ya
#    presente en b2-local-mirror/, si restauras desde la copia local):
rclone copy b2remote:mi-bucket/umbral/umbral_backup_2026-07-15_02-00-00.sql.gz.enc .

# 2. Desencriptar + descomprimir + restaurar. La frase de cifrado va siempre
#    en un archivo (nunca como argumento en texto plano, quedaría en el
#    historial de la shell):
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$HOME/.umbral_backup_passphrase" \
  -in umbral_backup_2026-07-15_02-00-00.sql.gz.enc | gunzip | \
  psql -U umbral_user -h localhost -d umbral_db
```

Si restauras un dump que viene de Supabase (backup offsite vía A) contra un
Postgres que no es Supabase (ej. un descartable local para probar), vas a ver
~600 líneas de `ERROR: no existe el rol «...»` para roles internos de
Supabase (`supabase_admin`, `dashboard_user`, `vault`, `pgbouncer`, etc.);
son esperables y no afectan las tablas de la app, `psql -f`/`psql <` los
omite y sigue. Confirma que restauró bien mirando solo tus tablas:

```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname = 'public';
```

---

## Cumplimiento Legal

| Requisito | Implementación |
|---|---|
| Ficha clínica obligatoria | Módulo de pacientes con todos los campos exigidos |
| Secreto profesional | Datos cifrados en tránsito (HTTPS en producción) |
| Custodia 15 años | Soft delete + backups diarios cifrados a Backblaze B2, sin rotación ni borrado (ver [Backups Automáticos](#backups-automáticos)) |
| Derecho del paciente a su ficha | Exportación PDF bajo demanda |
| Inalterabilidad de registros | Versionado en consultas + soft delete en pacientes |
| Bitácora de accesos | Audit Log inmutable con registro de todas las acciones |
| Consentimiento granular por finalidad (Ley 21.719) | Ledger append-only `PatientConsent` por `TREATMENT`/`TELEMEDICINE` |
| Sin acceso de terceros a fichas ajenas | Ownership estricto por `therapistId`: no existe ningún rol ni excepción que permita ver pacientes de otra cuenta |
| Inventario de tratamiento (RAT) | Ver [`docs/registro-actividades-tratamiento.md`](docs/registro-actividades-tratamiento.md) |
| Disponibilidad de la ficha ante pérdida de credenciales (Ley 20.584 art. 12, Ley 21.719) | Recuperación de cuenta self-service, ver abajo |
| Cierre del tratamiento e integridad del informe de alta | Informe de alta versionado e inmutable con hash SHA-256 y registro de entregas (ADR 0006); ver [Informe de alta](#informe-de-alta-adr-0006) |
| Pacientes NNA | Representantes legales, consentimiento otorgado por el representante y asentimiento del NNA (ADR 0007); ver [Pacientes NNA y representante legal](#pacientes-nna-y-representante-legal-adr-0007) |
| Cifrado de datos en reposo | AES-256-GCM con llaveros versionados para documentos, token de Google, credenciales de Flow, secreto TOTP y textos clínicos libres, incluidas las notificaciones internas (ADR 0004 y 0005) |

### Subprocesadores y ubicación de los datos (issue #177)

Proveedores que reciben datos personales o de salud, y dónde los procesan. El
detalle, la evidencia de cada DPA (`docs/evidencia-compliance/`) y las
preguntas legales abiertas están en la sección
[Transferencia internacional de datos](docs/registro-actividades-tratamiento.md#transferencia-internacional-de-datos)
del RAT, que es la fuente de verdad.

| Proveedor | Qué recibe | Ubicación | DPA |
|---|---|---|---|
| Supabase | Base de datos primaria (fichas, consultas, auditoría) | São Paulo, Brasil | Se incorpora al aceptar los Términos de Servicio (cláusula 12.2) |
| Backblaze B2 | Backups offsite cifrados con AES-256 antes de subir; avatares, archivos personales y documentos de ficha (buckets privados y separados) | Estados Unidos, región `us-west-004` en todos los buckets | Se incorpora al aceptar los Términos de Servicio, pero el DPA público está acotado a GDPR |
| Render, Cloudflare y Vercel | Hosting del backend (Render), proxy delante de la API (Cloudflare, ver `TRUSTED_PROXY_HOPS` en `render.yaml`) y hosting del frontend (Vercel, `frontend/vercel.json`): todo el tráfico de la API, incluidos datos de pacientes en tránsito, pasa por Render y Cloudflare | Ver el RAT | Ver el RAT |
| Resend | Nombre y email del profesional (verificación, recuperación de cuenta, recordatorios); si se activa el cobro, también el email del paciente con el link de pago | Estados Unidos | Se incorpora al aceptar los Términos de Servicio |
| Sentry (opcional, solo si se define `SENTRY_DSN`) | Trazas de errores 500 y excepciones no controladas. En el backend se redactan emails y RUT y se descartan bodies, cookies, headers y breadcrumbs; en el frontend se descartan bodies, cookies y headers de las requests | Estados Unidos (Iowa; host `ingest.us.sentry.io`) | DPA firmado el 2026-10-08 (`docs/evidencia-compliance/sentry-dpa-firmado-2026-10-08.pdf`) |
| Google (opcional) | Metadata minimizada de sesiones, solo si el terapeuta conecta su calendario | Estados Unidos | Pendiente de confirmar si aplica a cuentas personales |
| Flow (opcional) | Nombre y email del paciente, monto y fecha, si el terapeuta activa el cobro | AWS us-east-2 (Ohio, EE.UU.) | Sin DPA descargable; ver política de privacidad |

Pendiente: la aplicabilidad legal de los DPA a Chile y la Ley 21.719. Ver "Pendientes conocidos" en el RAT. Esto es orientación técnica, no
validación legal.

### Recuperación de cuenta (issue #50)

Sistema single-tenant: si el único usuario pierde su contraseña y/o el
dispositivo MFA, las fichas clínicas quedan inaccesibles vía la aplicación
hasta que pueda volver a entrar. Tres mecanismos, del menos al más invasivo:

1. **Contraseña olvidada**: `POST /api/v1/auth/password/forgot` con el
   email envía un link de un solo uso (30 min) vía Resend. `POST
   /api/v1/auth/password/reset` con ese token cambia la contraseña. Mientras
   haya un enlace vigente, pedir otro envía un correo con el mismo vencimiento
   original (no invalida el enlace anterior). No
   bypasea MFA: si la cuenta lo tiene habilitado, el siguiente login lo
   sigue exigiendo igual.
2. **MFA perdido (dispositivo extraviado)**: al habilitar MFA (`POST
   /api/v1/auth/mfa/enable`, o el paso 2 del enrolamiento forzado en `POST
   /api/v1/auth/mfa/setup/confirm`) se generan 10 códigos de recuperación de
   un solo uso, mostrados una única vez en la respuesta. `POST
   /api/v1/auth/mfa/recover` con email + contraseña + uno de esos códigos
   desactiva MFA sin necesitar el TOTP (el código se acepta sin importar
   mayúsculas ni guiones); el siguiente login vuelve a exigir
   enrolarlo. **Guardar esos 10 códigos en un gestor de contraseñas o
   impresos en un lugar seguro apenas se generan**: no hay forma de volver
   a verlos después.
3. **Último recurso: contraseña Y los 10 códigos de recuperación perdidos a
   la vez**: sin eso, no queda ningún camino self-service. Reset manual
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

   🔒 **Issue #52: el trigger append-only por sí solo no alcanza.**
   `trg_audit_log_append_only` impide modificar o borrar una fila ya
   escrita, pero no impedía que las mismas credenciales usadas para este
   procedimiento manual deshabiliten el trigger y reseteen sin dejar el
   paso 3 de auditoría, porque el rol de runtime de la app ERA el dueño de
   la tabla. Fix real: migración
   `20260803060000_restrict_audit_log_owner_privileges`, que transfiere la
   ownership a un rol nuevo sin login. Narrativa completa (intento
   descartado, fix, verificación end-to-end) en
   [`docs/incident-log.md`](docs/incident-log.md).

Pendiente de proveedor externo (no depende de código): firma electrónica
avanzada Ley 19.799 (issues #24-#26). La copia offsite de backups ya tiene
proveedor definido (Backblaze B2 + `rclone`); ver
[Configuración de Backups](#configuración-de-backups) e issue #17.

---

## Variables de Entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `DATABASE_URL` | URL de conexión PostgreSQL (pooled en producción) | `postgresql://user:pass@localhost:5432/db` |
| `DIRECT_URL` | Conexión directa (sin pooler) para `prisma migrate` | Igual a `DATABASE_URL` en local |
| `JWT_SECRET` | Clave secreta para firmar tokens | Cadena aleatoria larga |
| `JWT_EXPIRES_IN` | Tiempo de expiración del token | `8h` |
| `FRONTEND_URL` | URL del frontend (para CORS) | `http://localhost:5173` |
| `DOCUMENT_ENCRYPTION_KEY` | Clave AES-256 (base64, 32 bytes) para cifrar documentos de pacientes en reposo (T8.1) | Generar con `openssl rand -base64 32` |
| `PORT` | Puerto del backend | `3001` (default) |
| `NODE_ENV` | Entorno de ejecución; en `production` exige `JWT_SECRET` fuerte y distinto del valor de ejemplo, las claves de cifrado y, desde el issue #287, `FRONTEND_URL` (URL `http(s)://`), `DATABASE_URL`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `MAIL_FROM` y todas las `B2_*` (los endpoints con `https://`); si falta alguna el backend no arranca | `production` |
| `RUN_MIGRATIONS` | Si es `true`, corre `prisma migrate deploy` al arrancar (ver `main.ts`) | `false` |
| `TRUSTED_PROXY_HOPS` | Cantidad de proxies confiables delante de la app, para identificar la IP real del cliente (helper común `getClientIp`): la usan todos los rate-limits (auth, payments, profile, reserva pública) y se registra en `AuditLog`, `Session` y el historial de MFA. Si `X-Forwarded-For` trae menos valores que este número se usa la IP del socket (`req.ip`), nunca un valor de la cabecera (ver comentario en `auth.module.ts`) | `1` (un único proxy de edge, sin CDN delante). Con Render detrás de Cloudflare (deploy actual): `3` |
| `SEED_ADMIN_EMAIL` | Email del admin creado por `prisma db seed` (`npm run seed`) | `admin@umbral.cl` (default, ver `prisma/seed-admin.defaults.ts`) |
| `SEED_ADMIN_PASSWORD` | Contraseña inicial del admin creado por el seed | Ver advertencia abajo: **nunca dejar el default en un entorno alcanzable** |
| `RESEND_API_KEY` | API key de [Resend](https://resend.com) (free tier) para el email de verificación del signup propio (issue #5). Sin definir, `MailService` omite el envío con un warning en logs; no bloquea signup en dev/test. **Obligatoria en producción** (issue #287) | Conseguir en el dashboard de Resend |
| `MAIL_FROM` | Remitente del email de verificación. **Obligatoria en producción** (issue #287) | `Umbral - RCE <onboarding@resend.dev>` (default) |
| `RESEND_WEBHOOK_SECRET` | Secreto del webhook de Resend (issue #163) para verificar la firma Svix de `POST /webhooks/resend` (tracking de entrega/apertura de recordatorios por email). Sin definir, esa ruta responde `501` sin intentar verificar nada; no bloquea el resto de la app. **Obligatoria en producción** (issue #287) | Conseguir en el dashboard de Resend, sección Webhooks |
| `SENTRY_DSN` (backend) / `VITE_SENTRY_DSN` (frontend) | DSN de un proyecto Sentry (issue #191) para capturar errores 500 y excepciones no controladas. Opcional: sin DSN el SDK queda desactivado. No se envían bodies, cookies ni headers de las requests | Proyecto Node (backend) y proyecto React (frontend) en sentry.io |
| `B2_AVATARS_ENDPOINT` / `B2_AVATARS_REGION` / `B2_AVATARS_BUCKET` / `B2_AVATARS_KEY_ID` / `B2_AVATARS_APPLICATION_KEY` | Credenciales de un bucket Backblaze B2 **privado**, dedicado solo a fotos de perfil (issue #170): storage vía `@aws-sdk/client-s3` (S3-compatible), reemplaza el disco local que Render (free tier) no persiste entre deploys. Sin estas variables, subir/ver un avatar falla. **Obligatorias en producción** (issue #287); `*_ENDPOINT` debe incluir `https://` | Ver [Despliegue](#despliegue-issue-8), paso 2 |
| `B2_SHARED_FILES_ENDPOINT` / `B2_SHARED_FILES_REGION` / `B2_SHARED_FILES_BUCKET` / `B2_SHARED_FILES_KEY_ID` / `B2_SHARED_FILES_APPLICATION_KEY` | Mismo patrón que `B2_AVATARS_*` (issue #170), pero para la biblioteca personal de archivos (`shared-files`): bucket B2 propio y separado del de avatares. Sin estas variables, subir/descargar un archivo personal falla. **Obligatorias en producción** (issue #287) | Ver [Despliegue](#despliegue-issue-8), paso 2 |
| `B2_PATIENT_DOCUMENTS_ENDPOINT` / `B2_PATIENT_DOCUMENTS_REGION` / `B2_PATIENT_DOCUMENTS_BUCKET` / `B2_PATIENT_DOCUMENTS_KEY_ID` / `B2_PATIENT_DOCUMENTS_APPLICATION_KEY` | Mismo patrón que `B2_AVATARS_*`/`B2_SHARED_FILES_*` (issue #158), pero para los documentos de ficha clínica (`documents`: exámenes, certificados, consentimientos, informes de alta): bucket B2 propio, separado de los anteriores. El contenido sigue cifrado en reposo con `DOCUMENT_ENCRYPTION_KEY` (AES-256-GCM) antes de subirse. Sin estas variables, subir/descargar un documento clínico falla. **Obligatorias en producción** (issue #287) | Ver [Despliegue](#despliegue-issue-8), paso 2 |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Clave AES-256 (base64, 32 bytes) para cifrar el refresh token de Google Calendar en reposo, distinta de `DOCUMENT_ENCRYPTION_KEY` a propósito (sdd/google-calendar-integration) | Generar con `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Credenciales OAuth del proyecto de Google Cloud. Sin definir, el módulo de integración con Google Calendar se registra deshabilitado (mismo criterio que `MailService` sin `RESEND_API_KEY`); no bloquea el arranque en dev/test/CI | Conseguir en Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | Redirect URI del handshake OAuth, registrada en Google Cloud Console. Usa un cliente OAuth de **desarrollo** separado del de producción: la URI de `localhost` se registra solo en el cliente de desarrollo; el de producción lleva únicamente la URI HTTPS del backend (Google marca como inseguro un cliente de producción con redirects de loopback) | Desarrollo: `http://localhost:3001/api/v1/calendar-integration/callback`. Producción: `https://<host-del-backend>/api/v1/calendar-integration/callback` |
| `GOOGLE_CALENDAR_SYNC_ENABLED` | Si es `false`, desactiva el cron de reconciliación y los intents de sync sin necesitar un deploy/revert | `false` en CI/e2e |
| `SESSION_PURGE_ENABLED` | Si es `false`, desactiva el cron diario (04:00, hora del servidor) que borra sesiones expiradas o revocadas hace más de 7 días (`SessionPurgeService`, issue #287). Debe ser exactamente `true` o `false` | Habilitado si no se define |
| `NOTIFICATIONS_PURGE_ENABLED` | Si es `false`, desactiva el cron diario (04:30, hora del servidor) que borra notificaciones leídas con más de `NOTIFICATIONS_PURGE_RETENTION_DAYS` días y no leídas con más de `NOTIFICATIONS_PURGE_UNREAD_RETENTION_DAYS` días desde su creación (`NotificationsPurgeService`, issues #290 y #501). Debe ser exactamente `true` o `false` | Habilitado si no se define |
| `NOTIFICATIONS_PURGE_RETENTION_DAYS` | Días que se conserva una notificación leída antes de purgarla. Entero positivo | `30` |
| `NOTIFICATIONS_PURGE_UNREAD_RETENTION_DAYS` | Días desde su creación que se conserva una notificación no leída antes de purgarla (issue #501). Entero positivo | `90` |
| `NOTIFICATIONS_PURGE_MAX_BATCHES` | Máximo de lotes de 1000 filas por corrida de la purga de notificaciones. Entero positivo | `100` |
| `REMINDERS_ENABLED` | Si es `false`, desactiva el cron de recordatorios de sesión (`RemindersService`, cada 5 min) sin necesitar un deploy/revert | `false` en CI/e2e |
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | Clave AES-256 (base64, 32 bytes) para cifrar la credencial del merchant Flow de cada terapeuta en reposo, distinta de `DOCUMENT_ENCRYPTION_KEY`/`GOOGLE_TOKEN_ENCRYPTION_KEY` (sdd/online-payment-integration) | Generar con `openssl rand -base64 32` |
| `MFA_SECRET_ENCRYPTION_KEY` | Clave AES-256 (base64, 32 bytes) para cifrar el secreto TOTP de cada usuario (`User.mfaSecret`) en reposo, distinta de las demás claves de cifrado (issue #302). Los secretos guardados en texto plano antes de este cambio siguen funcionando y se re-cifran solos en el siguiente login con MFA. **No reemplazar el valor sin usar el llavero**: cambiarla directamente deja ilegibles los secretos ya cifrados (para rotarla, ver `*_KEYRING` más abajo) | Generar con `openssl rand -base64 32` |
| `CLINICAL_TEXT_ENCRYPTION_KEY` | Clave AES-256 (base64, 32 bytes) para cifrar en reposo los textos clínicos libres (notas de consulta e informe de alta), distinta de las demás claves de cifrado (ADR 0004, opción B). Obligatoria en producción: sin ella el arranque falla, y sin una copia de la clave el texto cifrado es irrecuperable | Generar con `openssl rand -base64 32` |
| `DOCUMENT_ENCRYPTION_KEY_KEYRING` / `GOOGLE_TOKEN_ENCRYPTION_KEY_KEYRING` / `PAYMENT_CREDENTIALS_ENCRYPTION_KEY_KEYRING` / `MFA_SECRET_ENCRYPTION_KEY_KEYRING` / `CLINICAL_TEXT_ENCRYPTION_KEY_KEYRING` | Opcionales (issue #382, ADR 0005). Agregan claves de cifrado al llavero del dato correspondiente con el formato `id:base64,id:base64` (ids enteros de 1 a 255, sin repetir, cada clave de 32 bytes en base64). La variable original sigue siendo la clave id 0. Solo se usan al rotar una clave | Ver [docs/rotacion-y-respaldo-de-claves.md](docs/rotacion-y-respaldo-de-claves.md) |
| `DOCUMENT_ENCRYPTION_KEY_ACTIVE_KEY_ID` / `GOOGLE_TOKEN_ENCRYPTION_KEY_ACTIVE_KEY_ID` / `PAYMENT_CREDENTIALS_ENCRYPTION_KEY_ACTIVE_KEY_ID` / `MFA_SECRET_ENCRYPTION_KEY_ACTIVE_KEY_ID` / `CLINICAL_TEXT_ENCRYPTION_KEY_ACTIVE_KEY_ID` | Opcionales (issue #382). Id de la clave con la que se cifran los datos nuevos; debe ser `0` o existir en el `_KEYRING` correspondiente. Si falta, se usa la id 0. Un valor mal formado hace fallar el arranque | Ver [docs/rotacion-y-respaldo-de-claves.md](docs/rotacion-y-respaldo-de-claves.md) |
| `PAYMENTS_ENABLED` | Si es `false`, desactiva por completo la creación de cargos, el checkout, los emails de pago y el cron de vencimiento sin necesitar un deploy/revert | `true` en el job `backend` de CI (lo necesita `payments.e2e-spec.ts`) y en el e2e de Playwright (contra un Flow simulado) |
| `INVITE_CREATOR_EMAIL` | Issue #124: único email autorizado a generar códigos de invitación (`POST /auth/invitations`), requeridos para completar `POST /auth/signup`. Mecanismo temporal sin rol ADMIN (decisión explícita); sin definir, nadie puede generar invitaciones y el signup público queda efectivamente cerrado | `terapeuta@ejemplo.cl` |
| `PUBLIC_SCHEDULING_ENABLED` | Habilita el portal público de auto-agenda (sdd/patient-self-scheduling): tanto la lectura de disponibilidad como la reserva. **Sin default**: sin definir, ambos endpoints públicos se registran deshabilitados (a diferencia de `PAYMENTS_ENABLED`/`GOOGLE_CALENDAR_SYNC_ENABLED`, acá "ausente" es deshabilitado, no habilitado, por ser superficie pública nueva) | `true` |
| `BACKEND_PUBLIC_URL` | URL pública del backend, usada para armar las URL de confirmación y de retorno (`confirmUrl`, `returnUrl`) de los cobros de Flow. Opcional; sin definir usa `http://localhost:3001`, por lo que en producción debe definirse | `https://umbralapi.groundzerodevs.com` |
| `PAYMENT_CONFIRM_THROTTLE_LIMIT` / `PAYMENT_CONFIRM_THROTTLE_TTL_MS` | Tope de `POST /payments/confirm` (callbacks de Flow) por IP y la ventana en milisegundos. Todos los callbacks de todos los terapeutas salen de pocas IP de Flow y comparten el cupo. Opcionales; un valor que no sea un entero positivo vuelve al default | `300` por `60000` ms |
| `E2E_SEED_CONFIRM` / `E2E_TEST_PASSWORD` / `E2E_TEST_MFA_SECRET` (y opcionales `E2E_TEST_EMAIL`, `E2E_FLOW_API_KEY`, `E2E_FLOW_SECRET_KEY`) | Solo para `npm run seed:e2e` (cuentas de los e2e de Playwright). `E2E_SEED_CONFIRM=1` es un opt-in explícito; `E2E_TEST_MFA_SECRET` debe ser una cadena base32. El seed se niega a correr con `NODE_ENV=production` | Ver [Pruebas](#pruebas) |
| `FLOW_API_BASE_URL` | Base URL de la API de Flow que usa el cliente de pagos. Fuera de producción es opcional (sin definir usa el sandbox). En producción es obligatoria, con esquema `https://`, salvo con `PAYMENTS_ENABLED=false`: sin ella el backend no arranca | `https://www.flow.cl/api` (producción); `https://sandbox.flow.cl/api` (sandbox) |
| `LAN_DEV_URL` | Origen adicional permitido por CORS para probar el frontend desde otro dispositivo de la red local. Opcional; si se define, debe ser una URL válida (se valida al arrancar) | `http://192.168.1.10:5173` |
| `VITE_API_URL` (frontend) | URL base del backend (incluye `/api/v1`) que usa el frontend. Variable de build de Vite; en Vercel se define en el proyecto. Sin definir, en desarrollo cae a `http://localhost:3001/api/v1`; en un build de producción es un error de configuración | `http://localhost:3001/api/v1` |
| `*_THROTTLE_LIMIT` / `*_THROTTLE_TTL_MS` (throttlers de auth, perfil y pagos) | Límite (peticiones) y ventana (ms) de cada throttler nombrado. Prefijos: `LOGIN_`, `SIGNUP_`, `MFA_` (verificación en login), `MFA_SETUP_`, `MFA_RECOVER_`, `PASSWORD_CHANGE_`, `PASSWORD_RESET_`, `VERIFY_EMAIL_`, `RESEND_VERIFICATION_`, `EMAIL_CHANGE_CONFIRM_`, `PROFILE_UPDATE_`, `REPORTS_EXPORT_` (exportación de la ficha PDF, por terapeuta), `PAYMENT_CONFIRM_`, `PAYMENT_RETURN_`. Un valor que no sea un entero positivo se ignora con un warning en el arranque | Límite por defecto `5` peticiones, salvo `EMAIL_CHANGE_CONFIRM_` (`10`), `PAYMENT_CONFIRM_` (`300`) y `PAYMENT_RETURN_` (`20`); ventana por defecto `60000` ms, salvo `PROFILE_UPDATE_` (`900000` ms). En `NODE_ENV=test` el límite por defecto es `1000` |
| `PUBLIC_AVAILABILITY_THROTTLE_LIMIT` / `PUBLIC_AVAILABILITY_THROTTLE_TTL_MS` | Límite del throttler `public-availability` (lectura de horarios libres, sin auth) | `20` req / `60000` ms (default) |
| `PUBLIC_BOOKING_THROTTLE_LIMIT` / `PUBLIC_BOOKING_THROTTLE_TTL_MS` | Límite del throttler `public-booking` (crea `Patient` + `Consultation`, mismo presupuesto conservador que login/signup) | `5` req / `60000` ms (default) |
| `PUBLIC_BOOKING_IP_THROTTLE_LIMIT` / `PUBLIC_BOOKING_IP_THROTTLE_TTL_MS` | Límite extra de la reserva pública por `ip:therapistId`, independiente del email enviado (el bucket por email se reabre con cada email distinto) | `10` req / `3600000` ms (default); `1000` en `NODE_ENV=test` |
| `UNAUTHORIZED_AUDIT_LIMIT` / `UNAUTHORIZED_AUDIT_WINDOW_MS` | Máximo de filas `UNAUTHORIZED_ATTEMPT` (requests sin token válido) que se escriben en `AuditLog` por IP de cliente y ventana; el resto se rechaza igual con 401 pero sin auditar. Solo se guarda el path, sin query string. Contador en memoria por proceso | `10` filas / `60000` ms |
| `PUBLIC_BOOKING_DAILY_LIMIT` / `PUBLIC_BOOKING_DAILY_TTL_MS` | Tope de reservas públicas **exitosas** por terapeuta en la ventana (sin importar la IP); se cuenta en base de datos (`BookedSlot`), los intentos fallidos no lo consumen; al alcanzarlo responde 429 | `100` reservas / `86400000` ms (default); `10000` en `NODE_ENV=test` |
| `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` | Habilita el overlay de bloqueos de Google Calendar sobre `computeSlots()` (sdd/public-booking-payment-calendar): el cron `CalendarBusyService` deja de sincronizar `CalendarBusyBlock` y el cálculo de horarios libres deja de consultarlo. Opt-in (`=== 'true'`, no el `!== 'false'` de `GOOGLE_CALENDAR_SYNC_ENABLED`/`PAYMENTS_ENABLED`); sin definir, `computeSlots()` es byte-idéntico al comportamiento anterior a este cambio. Independiente de `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED`: cada flag lee su propia env var, ninguno depende del estado del otro | `true` |
| `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED` | Habilita el link de checkout Flow en la propia página de confirmación de la auto-agenda pública (sdd/public-booking-payment-calendar), además del email de pago existente. Opt-in (`=== 'true'`); sin definir, la reserva pública sigue el flujo solo-email de siempre, sin cambios de comportamiento. Independiente de `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` | `true` |

> ⚠️ Si el comando de arranque del hosting ya corre `prisma migrate deploy` antes de iniciar el server (recomendado), **no** setees `RUN_MIGRATIONS=true` también: no rompe nada (la migración es idempotente), pero la corre dos veces innecesariamente.

> 🔒 **El `DOCUMENT_ENCRYPTION_KEY` de ejemplo de arriba es público** (está en un repo público): igual que con `JWT_SECRET`, en producción el arranque falla si detecta ese valor exacto o cualquier clave que no decodifique a 32 bytes en base64. Genera una propia con `openssl rand -base64 32` antes de desplegar.

> 🔒 **El `GOOGLE_TOKEN_ENCRYPTION_KEY` de ejemplo de arriba también es público**: mismo criterio y mismo rechazo en producción que `DOCUMENT_ENCRYPTION_KEY`. Genera una propia con `openssl rand -base64 32` antes de desplegar.

> ⚠️ **Feriados de Chile (sdd/patient-self-scheduling):** no son una env var
> persistente: se cargan con un comando manual e idempotente,
> `SEED_HOLIDAYS=true npm run seed` (desde `backend/`), que hace upsert en
> `PublicHoliday` contra [Boostr.cl](https://api.boostr.cl/holidays.json)
> (sin API key) keyeado por `date`. No corre nunca automáticamente (ni en
> CI, ni al bootear, ni en el `startCommand` de Render), así que hay que
> correrlo a mano una vez al año (o contra `DATABASE_URL` de producción, si
> el hosting no da shell). Sin correrlo, la auto-agenda funciona igual, solo
> que nunca excluye feriados de los horarios libres.

> 🔒 **`SEED_ADMIN_PASSWORD` es pública si no la sobrescribes.** El default (`prisma/seed-admin.defaults.ts`) está commiteado en un repo público: cualquiera lo puede leer. La cuenta admin fuerza cambio de contraseña en su primer login (`mustChangePassword`), pero eso solo protege si el operador cambia la clave *antes* de que alguien más la use con la contraseña conocida: quien loguee primero con el default se queda con el `passwordChangeToken` y puede tomar la cuenta. En local/CI el default está bien (nadie más tiene acceso a esa base). En **cualquier entorno alcanzable desde afuera** (staging, producción), configura `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` a valores propios antes de correr el seed por primera vez.

---

## Licencia

Uso privado. Umbral - RCE © 2026. Todos los derechos reservados.
