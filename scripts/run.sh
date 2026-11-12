#!/usr/bin/env bash
# Ejecuta un script de mongosh contra Atlas leyendo la URI desde .env (nunca escrita en el código)
# y guarda la salida (con credenciales enmascaradas) en evidencias/salidas/<script>.txt
# Uso: scripts/run.sh 04_consultas
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${MONGODB_URI:?Falta MONGODB_URI en .env}"
mongosh "$MONGODB_URI" --quiet --file "scripts/$1.js" 2>&1 \
  | LC_ALL=C sed -E 's#(mongodb(\+srv)?://)[^@/]*@#\1***:***@#g' \
  | tee "evidencias/salidas/$1.txt"
