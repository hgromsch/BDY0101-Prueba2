#!/usr/bin/env bash
# 01 - Importación de los JSON del Anexo Forma A a MongoDB Atlas con mongoimport --jsonArray (IE1, IE3)
# Uso: scripts/01_importar.sh   (lee MONGODB_URI desde .env; la salida queda en evidencias/salidas/01_importar.txt)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
DATOS="${DATOS_DIR:-../Forma A}"
ZIP="${ZIP_ANEXO:-../AnexoForma A.zip}"
mask() { LC_ALL=C sed -E 's#(mongodb(\+srv)?://)[^@/]*@#\1***:***@#g'; }

{
echo "### I01 | Contenido del ZIP del anexo (se ignoran __MACOSX y los archivos ._*)"
echo '$ unzip -l "AnexoForma A.zip"'
unzip -l "$ZIP" || true

echo
echo "### I02 | Nombre del archivo de campañas: la ñ viene descompuesta (n + U+0303)"
echo '$ ls "Forma A" | grep camp | xxd | head -1'
ls "$DATOS" | grep camp | xxd | head -1
echo "→ Se importa con un comodín (campa*as.json) y la colección se llama 'campanas' (sin ñ)."

echo
echo "### I03 | Validación previa: cada archivo es un arreglo JSON"
for f in "$DATOS"/*.json; do
  python3 -I -c 'import json,sys,os; d=json.load(open(sys.argv[1])); print("%-20s tipo=%-5s documentos=%d" % (os.path.basename(sys.argv[1]), type(d).__name__, len(d)))' "$f"
done

echo
echo "### I04 | Importación con mongoimport --jsonArray --drop"
for par in "usuarios:usuarios.json" "publicaciones:publicaciones.json" "reacciones:reacciones.json" \
           "comentarios:comentarios.json" "campanas:campa*as.json"; do
  col="${par%%:*}"; patron="${par#*:}"
  archivo=$(ls "$DATOS"/$patron | head -1)
  echo "\$ mongoimport --uri \"\$MONGODB_URI\" --db contentflow --collection $col --jsonArray --drop --file \"$(basename "$archivo")\""
  mongoimport --uri "$MONGODB_URI" --db "${MONGODB_DB:-contentflow}" --collection "$col" \
    --jsonArray --drop --writeConcern '{w:"majority"}' --file "$archivo" 2>&1
done

mongosh "$MONGODB_URI" --quiet --eval 'db.getSiblingDB(process.env.MONGODB_DB || "contentflow").contadores.drop()' >/dev/null
echo "(se reinician los contadores de ids de la API y las colecciones derivadas de ejecuciones anteriores)"
mongosh "$MONGODB_URI" --quiet --eval '["auditoria_calidad","reacciones_descartadas","comentarios_eliminados"].forEach(c => db.getSiblingDB(process.env.MONGODB_DB || "contentflow")[c].drop())' >/dev/null

echo
echo "### I05 | Verificación de documentos por colección"
echo 'contentflow> ["usuarios","publicaciones","reacciones","comentarios","campanas"].map(c => ({coleccion: c, documentos: db[c].countDocuments()}))'
mongosh "$MONGODB_URI" --quiet --eval '
  db = db.getSiblingDB(process.env.MONGODB_DB || "contentflow");
  console.table(["usuarios","publicaciones","reacciones","comentarios","campanas"].map(c => ({coleccion: c, documentos: db[c].countDocuments()})))'

echo
echo "### I06 | Tipos de datos tras la importación (las fechas llegan como string, _id como string)"
mongosh "$MONGODB_URI" --quiet --eval '
  db = db.getSiblingDB(process.env.MONGODB_DB || "contentflow");
  const campos = {usuarios:["_id","fecha_registro"], publicaciones:["_id","fecha_publicacion"], reacciones:["_id","fecha"], comentarios:["_id","fecha"], campanas:["_id","fecha_inicio","fecha_fin"]};
  const filas = [];
  for (const [c, fs] of Object.entries(campos)) for (const f of fs) {
    const t = db[c].aggregate([{ $group: { _id: { $type: "$" + f }, n: { $sum: 1 } } }]).toArray();
    filas.push({ coleccion: c, campo: f, tipos: t.map(x => x._id + "=" + x.n).join(", ") });
  }
  console.table(filas)'
} 2>&1 | mask | tee evidencias/salidas/01_importar.txt
