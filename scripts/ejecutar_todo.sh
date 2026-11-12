#!/usr/bin/env bash
# Reproduce TODO el proyecto contra MongoDB Atlas, en orden:
# conexión → importación → fechas → índices/validadores → calidad → consultas → explain → CRUD → API (newman + tiempo real)
# Requisitos: mongosh, mongoimport, Node (npx), venv de Python con requirements.txt, archivo .env (ver .env.example)
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-$HOME/.venvs/contentflow/bin/python}"
UVICORN="$(dirname "$PY")/uvicorn"

scripts/run.sh 00_conexion
scripts/01_importar.sh
for s in 02_transformar_fechas 03_indices_validadores 04_calidad_datos 05_consultas 06_explain 07_crud_negocio; do
  scripts/run.sh "$s"
done

# API REST (se reinicia para que tome los contadores de ids recién reiniciados)
pkill -f "uvicorn api.main:app" 2>/dev/null || true
: > api/logs/api.log
"$UVICORN" api.main:app --port 8000 > evidencias/salidas/uvicorn.txt 2>&1 &
for i in $(seq 1 30); do curl -s localhost:8000/salud >/dev/null 2>&1 && break; sleep 1; done
npx -y newman@6 run postman/ContentFlow.postman_collection.json -e postman/ContentFlow.postman_environment.json \
  --color off --reporters cli,json --reporter-json-export evidencias/salidas/newman.json \
  | tee evidencias/salidas/09_newman.txt
scripts/08_api_tiempo_real.sh
echo "Listo. La API sigue corriendo en http://127.0.0.1:8000/docs (detener con: pkill -f 'uvicorn api.main:app')"
