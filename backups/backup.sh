#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════
# Backup cifrado de Umbral SpA — control-fichas
#
# Requisitos de configuración (una sola vez, fuera de este repo):
#
#   1. Credenciales de BD vía ~/.pgpass (nunca en este script ni en git):
#        echo "localhost:5432:umbral_db:umbral_user:TU_PASSWORD" >> ~/.pgpass
#        chmod 600 ~/.pgpass
#
#   2. Frase de cifrado en un archivo protegido (nunca en este script ni en git):
#        openssl rand -base64 48 > ~/.umbral_backup_passphrase
#        chmod 600 ~/.umbral_backup_passphrase
#      Guardá una copia de esa frase en un gestor de contraseñas — sin
#      ella, los backups cifrados son irrecuperables.
#
#   3. (Opcional) Variables de entorno para personalizar rutas — ver
#      abajo. Todas tienen un default razonable si no se configuran.
#
# Restaurar un backup:
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$HOME/.umbral_backup_passphrase" \
#     -in umbral_backup_2026-07-15_02-00-00.sql.gz.enc | gunzip | \
#     psql -U umbral_user -h localhost -d umbral_db
# ═══════════════════════════════════════════════════════════════════════

# ─── CONFIGURACIÓN ───────────────────────────────────────
DB_USER="${DB_USER:-umbral_user}"
DB_NAME="${DB_NAME:-umbral_db}"
DB_HOST="${DB_HOST:-localhost}"

# Rotación operativa: backups diarios, se borran automáticamente pasados
# RETENTION_DAYS. Esto es solo para recuperación rápida ante un incidente
# reciente — NO es la custodia legal de 15 años (ver ARCHIVE_DIR abajo).
BACKUP_DIR="${BACKUP_DIR:-$HOME/control-fichas-backups/operational}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Custodia legal (Ley 20.584 / Decreto 41): un snapshot mensual que este
# script NUNCA borra. Distinto del backup diario de arriba a propósito.
ARCHIVE_DIR="${ARCHIVE_DIR:-$HOME/control-fichas-backups/archive}"
ARCHIVE_DAY_OF_MONTH="${ARCHIVE_DAY_OF_MONTH:-1}"

# Segunda copia local, en un dispositivo físico distinto (regla 3-2-1).
# Ejemplo con un NAS montado como unidad de red: NAS_DIR="/d/umbral-backups"
NAS_DIR="${NAS_DIR:-}"

# Frase de cifrado — nunca hardcodeada, vive en un archivo protegido fuera del repo
PASSPHRASE_FILE="${PASSPHRASE_FILE:-$HOME/.umbral_backup_passphrase}"

# Hook para subir a un destino offsite real (S3/B2/rclone/etc.). Pendiente
# de definir (T3.3) — si algún día se configura OFFSITE_UPLOAD_CMD, este
# script lo ejecuta con la ruta del backup cifrado como único argumento.
# Ejemplo futuro: OFFSITE_UPLOAD_CMD="aws s3 cp {} s3://mi-bucket/umbral/"
OFFSITE_UPLOAD_CMD="${OFFSITE_UPLOAD_CMD:-}"

DATE=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/umbral_backup_${DATE}.sql.gz.enc"

# ─── VALIDACIONES PREVIAS ────────────────────────────────
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "❌ pg_dump no está instalado o no está en el PATH"
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "❌ openssl no está instalado o no está en el PATH"
  exit 1
fi

if [ ! -f "$PASSPHRASE_FILE" ]; then
  echo "❌ No se encontró el archivo de frase de cifrado: $PASSPHRASE_FILE"
  echo "   Generalo con: openssl rand -base64 48 > \"$PASSPHRASE_FILE\" && chmod 600 \"$PASSPHRASE_FILE\""
  exit 1
fi

mkdir -p "$BACKUP_DIR" "$ARCHIVE_DIR"

# ─── GENERAR BACKUP CIFRADO ───────────────────────────────
# pg_dump -> gzip -> openssl, todo en un mismo pipeline: el volcado sin
# cifrar nunca toca el disco, ni siquiera momentáneamente.
echo "📦 Iniciando backup: $DATE"

if pg_dump -U "$DB_USER" -h "$DB_HOST" "$DB_NAME" \
    | gzip \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASSPHRASE_FILE" \
    > "$BACKUP_FILE"
then
  echo "✅ Backup cifrado generado: $BACKUP_FILE"
else
  echo "❌ Error al generar el backup"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# ─── COPIAR AL NAS (segunda copia, regla 3-2-1) ──────────
if [ -n "$NAS_DIR" ] && [ -d "$NAS_DIR" ]; then
  cp "$BACKUP_FILE" "$NAS_DIR/"
  echo "✅ Copia en NAS: $NAS_DIR"
else
  echo "⚠️  NAS no disponible o NAS_DIR sin configurar, omitiendo copia local secundaria"
fi

# ─── ARCHIVO DE CUSTODIA LEGAL (nunca se borra) ──────────
if [ "$(date +%d)" = "$(printf "%02d" "$ARCHIVE_DAY_OF_MONTH")" ]; then
  cp "$BACKUP_FILE" "$ARCHIVE_DIR/"
  echo "🗄️  Snapshot mensual copiado a custodia legal: $ARCHIVE_DIR"
  if [ -n "$NAS_DIR" ] && [ -d "$NAS_DIR/archive" ]; then
    cp "$BACKUP_FILE" "$NAS_DIR/archive/"
    echo "🗄️  Snapshot mensual también copiado al NAS: $NAS_DIR/archive"
  fi
fi

# ─── SUBIDA OFFSITE (pendiente hasta definir proveedor — T3.3) ──────────
if [ -n "$OFFSITE_UPLOAD_CMD" ]; then
  # shellcheck disable=SC2086
  eval "${OFFSITE_UPLOAD_CMD//\{\}/$BACKUP_FILE}"
  echo "☁️  Backup subido a destino offsite"
else
  echo "⚠️  OFFSITE_UPLOAD_CMD sin configurar — todavía no hay copia offsite real (T3.3 pendiente)"
fi

# ─── ELIMINAR SOLO BACKUPS OPERATIVOS ANTIGUOS ────────────
# Importante: esto NUNCA toca $ARCHIVE_DIR — ese es el punto de separar
# la rotación operativa de la custodia legal de 15 años.
find "$BACKUP_DIR" -name "*.sql.gz.enc" -mtime "+$RETENTION_DAYS" -delete
if [ -n "$NAS_DIR" ] && [ -d "$NAS_DIR" ]; then
  find "$NAS_DIR" -maxdepth 1 -name "*.sql.gz.enc" -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
fi
echo "🧹 Backups operativos con más de ${RETENTION_DAYS} días eliminados (el archivo de custodia legal no se toca)"

echo "✅ Proceso completado"
