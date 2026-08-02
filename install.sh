#!/bin/bash

echo "🚀 Instalando Sistema de Gestión Clínica Umbral SpA"
echo "=================================================="

# ─── VERIFICAR NODE ───────────────────────────────────
echo "📦 Verificando Node.js..."
NODE_VERSION=$(node --version 2>/dev/null)
if [ -z "$NODE_VERSION" ]; then
  echo "❌ Node.js no encontrado. Instalando via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  source ~/.bashrc
  nvm install 20
  nvm use 20
else
  echo "✅ Node.js $NODE_VERSION encontrado"
fi

# ─── CONFIGURAR NPM ───────────────────────────────────
echo "⚙️  Configurando npm..."
npm config set legacy-peer-deps true

# ─── INSTALAR POSTGRESQL ──────────────────────────────
echo "🐘 Verificando PostgreSQL..."
if ! command -v psql &> /dev/null; then
  echo "Instalando PostgreSQL..."
  sudo apt update
  sudo apt install -y postgresql postgresql-contrib
else
  echo "✅ PostgreSQL ya instalado"
fi

sudo systemctl start postgresql
sudo systemctl enable postgresql

# ─── CREAR BASE DE DATOS ──────────────────────────────
echo "🗄️  Configurando base de datos..."
sudo -u postgres psql <<EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'umbral_user') THEN
    CREATE USER umbral_user WITH PASSWORD 'umbral_password_2024';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE umbral_db OWNER umbral_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'umbral_db')\gexec

GRANT ALL PRIVILEGES ON DATABASE umbral_db TO umbral_user;
ALTER USER umbral_user CREATEDB;
EOF
echo "✅ Base de datos configurada"

# ─── BACKEND ──────────────────────────────────────────
echo "⚙️  Instalando dependencias del backend..."
cd "$(dirname "$0")/backend"

# Crear .env si no existe
if [ ! -f .env ]; then
  echo "📝 Creando archivo .env del backend..."
  cat > .env <<EOL
DATABASE_URL="postgresql://umbral_user:umbral_password_2024@localhost:5432/umbral_db"
# En producción con un pooler delante (ej. Supabase/PgBouncer), DIRECT_URL
# debe ser la conexión directa, no la pooled — la necesita prisma migrate.
DIRECT_URL="postgresql://umbral_user:umbral_password_2024@localhost:5432/umbral_db"
JWT_SECRET="umbral-jwt-secret-cambiar-en-produccion-2024"
JWT_EXPIRES_IN="8h"
MFA_APP_NAME="Umbral SpA"
FRONTEND_URL="http://localhost:5173"
# Clave de cifrado de documentos (T8.1) -- generá la tuya con:
# openssl rand -base64 32
DOCUMENT_ENCRYPTION_KEY="+rPRh0H2ayZ4yAIjhOWbvOghetuNtScBP8g2VgNuBik="
EOL
  echo "✅ .env creado"
else
  echo "✅ .env ya existe"
fi

npm install
npx prisma migrate deploy
npm run seed

echo "✅ Backend configurado"

# ─── FRONTEND ─────────────────────────────────────────
echo "🎨 Instalando dependencias del frontend..."
cd "$(dirname "$0")/frontend"
npm install
echo "✅ Frontend configurado"

# ─── BACKUP ───────────────────────────────────────────
echo "💾 Configurando backups automáticos..."
mkdir -p "$(dirname "$0")/backups/files"
chmod +x "$(dirname "$0")/backups/backup.sh"

# Agregar cron si no existe
CRON_JOB="0 2 * * * $(realpath $(dirname "$0"))/backups/backup.sh >> $(realpath $(dirname "$0"))/backups/backup.log 2>&1"
if ! crontab -l 2>/dev/null | grep -q "backup.sh"; then
  (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
  echo "✅ Backup automático configurado (2:00 AM diario)"
else
  echo "✅ Backup automático ya configurado"
fi

# ─── RESUMEN ──────────────────────────────────────────
echo ""
echo "=================================================="
echo "✅ Instalación completada"
echo ""
echo "Para iniciar el sistema:"
echo ""
echo "  Terminal 1 (Backend):"
echo "  cd backend && npm run start:dev"
echo ""
echo "  Terminal 2 (Frontend):"
echo "  cd frontend && npm run dev"
echo ""
echo "  Acceder en: http://localhost:5173"
echo "  Email:      admin@umbral.cl"
echo "  Password:   Umbral2024!"
echo "=================================================="