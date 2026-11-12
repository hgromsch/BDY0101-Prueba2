#!/usr/bin/env bash
# 08 - Evidencia de lectura/escritura en tiempo real API ↔ Atlas y control de errores (IE9, IE10, IE11)
# Requiere la API corriendo en http://127.0.0.1:8000 (uvicorn api.main:app --port 8000)
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
API=http://127.0.0.1:8000
PY=~/.venvs/contentflow/bin/python
mask() { LC_ALL=C sed -E 's#(mongodb(\+srv)?://)[^@/]*@#\1***:***@#g'; }
bonito() { $PY -c 'import json,sys; print(json.dumps(json.load(sys.stdin), ensure_ascii=False, indent=2))'; }
consulta() { mongosh "$MONGODB_URI" --quiet --eval "db = db.getSiblingDB('contentflow'); $1"; }

{
echo "### T01 | Prueba de conectividad de la API (GET /salud)"
echo "\$ curl -s $API/salud"
curl -s $API/salud | bonito

echo
echo "### T02 | ESCRITURA vía API: POST /usuarios"
CUERPO='{"nombre":"Ignacio Fuentes","correo":"ignacio.fuentes.'$(date +%s)'@contentflow.cl","pais":"Chile","genero":"Masculino","dispositivo":"Móvil"}'
echo "\$ curl -s -X POST $API/usuarios -H 'Content-Type: application/json' -d '$CUERPO'"
RESP=$(curl -s -X POST $API/usuarios -H 'Content-Type: application/json' -d "$CUERPO")
echo "$RESP" | bonito
UID_NUEVO=$(echo "$RESP" | $PY -c 'import json,sys; print(json.load(sys.stdin)["_id"])')

echo
echo "### T03 | LECTURA directa en Atlas con mongosh (otra herramienta, mismo instante)"
echo "contentflow> db.usuarios.findOne({ _id: '$UID_NUEVO' })"
consulta "printjson(db.usuarios.findOne({ _id: '$UID_NUEVO' }))"

echo
echo "### T04 | ESCRITURA vía API: publicación + reacción + comentario del nuevo usuario"
PUB=$(curl -s -X POST $API/publicaciones -H 'Content-Type: application/json' \
  -d '{"usuario_id":"'$UID_NUEVO'","contenido":"Probando la API de ContentFlow conectada a Atlas","categoria":"Tecnología","tipo":"Texto","hashtags":["#innovacion"]}')
PUB_ID=$(echo "$PUB" | $PY -c 'import json,sys; print(json.load(sys.stdin)["_id"])')
echo "POST /publicaciones → $PUB_ID"
echo "POST /reacciones   → $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/reacciones -H 'Content-Type: application/json' -d '{"usuario_id":"user_10","publicacion_id":"'$PUB_ID'","tipo_reaccion":"Me gusta"}')"
echo "POST /comentarios  → $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/comentarios -H 'Content-Type: application/json' -d '{"usuario_id":"user_20","publicacion_id":"'$PUB_ID'","comentario":"Funciona en tiempo real"}')"
echo "contentflow> db.publicaciones.findOne({ _id: '$PUB_ID' }, { contenido: 1, metricas: 1, ultimos_comentarios: 1 })"
consulta "printjson(db.publicaciones.findOne({ _id: '$PUB_ID' }, { contenido: 1, metricas: 1, ultimos_comentarios: 1 }))"

echo
echo "### T05 | LECTURA vía API de lo recién escrito: GET /publicaciones/$PUB_ID"
curl -s $API/publicaciones/$PUB_ID | bonito

echo
echo "### T06 | Control de errores: respuestas con código HTTP y request_id"
echo "\$ curl -s $API/usuarios/user_99999"
curl -s -w '   ← HTTP %{http_code}\n' $API/usuarios/user_99999
echo "\$ curl -s -X POST $API/reacciones  (usuario ya reaccionó)"
curl -s -w '   ← HTTP %{http_code}\n' -X POST $API/reacciones -H 'Content-Type: application/json' -d '{"usuario_id":"user_10","publicacion_id":"'$PUB_ID'","tipo_reaccion":"Me gusta"}'
echo "\$ curl -s -X POST $API/comentarios  (publicación inexistente)"
curl -s -w '   ← HTTP %{http_code}\n' -X POST $API/comentarios -H 'Content-Type: application/json' -d '{"usuario_id":"user_20","publicacion_id":"pub_99999","comentario":"hola"}'
echo "\$ curl -s -X POST $API/usuarios  (campos inválidos)"
curl -s -w '   ← HTTP %{http_code}\n' -X POST $API/usuarios -H 'Content-Type: application/json' -d '{"nombre":"A","correo":"sin-arroba","genero":"X"}'

echo
echo "### T07 | Control de errores: base de datos no disponible (segunda instancia apuntando a un host inaccesible)"
MONGODB_URI_APP="mongodb://127.0.0.1:27999/" MONGODB_TIMEOUT_MS=2000 LOG_FILE=/tmp/contentflow_caida.log \
  ~/.venvs/contentflow/bin/uvicorn api.main:app --port 8001 >/dev/null 2>&1 &
PID=$!; sleep 6
echo "\$ curl -s http://127.0.0.1:8001/salud"
curl -s -w '   ← HTTP %{http_code}\n' http://127.0.0.1:8001/salud
echo "\$ curl -s http://127.0.0.1:8001/usuarios/user_1"
curl -s -w '   ← HTTP %{http_code}\n' http://127.0.0.1:8001/usuarios/user_1
kill $PID 2>/dev/null; wait $PID 2>/dev/null
echo "log de esa instancia:"; grep -E "ERROR|WARNING" /tmp/contentflow_caida.log | tail -3; rm -f /tmp/contentflow_caida.log

echo
echo "### T08 | Registro de actividad (últimas líneas de api/logs/api.log)"
echo "\$ tail -n 14 api/logs/api.log"
tail -n 14 api/logs/api.log

echo "$UID_NUEVO $PUB_ID" > evidencias/salidas/08_ids_creados.txt
} 2>&1 | mask | tee evidencias/salidas/08_api_tiempo_real.txt
