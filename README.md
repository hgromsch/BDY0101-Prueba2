# ContentFlow · MongoDB Atlas + API REST

Evaluación Parcial N°2 — BDY0101 Base de Datos No Relacionales (Duoc UC) · Caso **Forma A (ContentFlow)**
Autor: Heinrich Werner Gromsch Sanz (trabajo individual)

Base de datos NoSQL de ContentFlow en **MongoDB Atlas M0** (Cluster-BDNR-Prueba1, AWS São Paulo `sa-east-1`),
con carga y limpieza de datos, consultas y agregaciones, evaluación con `explain`, operaciones CRUD de negocio
y una **API REST en Python (FastAPI + pymongo)** con validaciones, manejo de errores y logs.

## Estructura

```
contentflow/
├── .env.example                 # variables de entorno (sin credenciales reales)
├── requirements.txt             # dependencias de Python
├── scripts/
│   ├── lib.js                   # utilidades comunes de mongosh (read/write concern, formato de evidencias)
│   ├── run.sh                   # ejecuta un script de mongosh leyendo .env y guarda la salida enmascarada
│   ├── 00_conexion.js           # conectividad, región, roles y concerns
│   ├── 01_importar.sh           # mongoimport --jsonArray de los 5 JSON (campañas → campanas)
│   ├── 02_transformar_fechas.js # string ISO → Date con $dateFromString
│   ├── 03_indices_validadores.js# índices + validadores $jsonSchema
│   ├── 04_calidad_datos.js      # detección, auditoría y corrección de inconsistencias
│   ├── 05_consultas.js          # consultas find y pipelines de agregación del negocio
│   ├── 06_explain.js            # explain("executionStats") antes/después de índices
│   ├── 07_crud_negocio.js       # casos CRUD con estado antes/después y transacción
│   ├── 08_api_tiempo_real.sh    # escritura por la API y lectura en Atlas + pruebas de errores
│   └── ejecutar_todo.sh         # reproduce todo de punta a punta
├── api/                         # API REST (FastAPI)
│   ├── main.py  config.py  db.py  schemas.py
│   ├── routers/ (salud, usuarios, publicaciones, interacciones, campanas, reportes)
│   └── logs/api.log             # registro de actividad (se crea al ejecutar)
├── postman/                     # colección Postman v2.1 + environment
```

## Requisitos

- MongoDB Atlas con un cluster M0, tu IP en *Network Access* y dos usuarios:
  uno administrador (scripts) y `contentflow_app` con rol **readWrite@contentflow** (API).
- `mongosh` y `mongoimport` (MongoDB Database Tools).
- Python 3.10+ y Node.js 18+ (para `npx newman`).

## Instalación

```bash
cp .env.example .env          # completar las URIs (no se versiona)
python3 -m venv ~/.venvs/contentflow
~/.venvs/contentflow/bin/pip install -r requirements.txt
```

## Ejecución

Todo de una vez (importa de nuevo los datos, corre los scripts, levanta la API y ejecuta Postman con newman):

```bash
scripts/ejecutar_todo.sh
```

Paso a paso:

```bash
scripts/run.sh 00_conexion
scripts/01_importar.sh                 # usa ../Forma A/*.json (DATOS_DIR para cambiarlo)
scripts/run.sh 02_transformar_fechas
scripts/run.sh 03_indices_validadores
scripts/run.sh 04_calidad_datos
scripts/run.sh 05_consultas
scripts/run.sh 06_explain
scripts/run.sh 07_crud_negocio
~/.venvs/contentflow/bin/uvicorn api.main:app --port 8000     # API → http://127.0.0.1:8000/docs
npx newman run postman/ContentFlow.postman_collection.json -e postman/ContentFlow.postman_environment.json
scripts/08_api_tiempo_real.sh
```

La colección de `postman/` también se puede importar en Postman (File → Import) junto con el environment `ContentFlow local`.

## Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/salud` | Ping a Atlas, latencia, proveedor y región (503 si no hay conexión) |
| GET/POST | `/usuarios` | Listar con filtros / registrar (correo único → 409) |
| GET/PATCH/DELETE | `/usuarios/{id}` | Perfil con actividad / `$set` / eliminación en cascada con transacción (`?cascada=true`) |
| GET/POST | `/publicaciones` | Listar por categoría, tipo, hashtag, fecha / crear (verifica usuario → 422) |
| GET | `/publicaciones/populares` | Top por engagement (`$lookup`) |
| GET/PATCH/DELETE | `/publicaciones/{id}` | Detalle con métricas / `$set`, `$addToSet`, `$pull` / eliminar |
| POST/DELETE | `/reacciones` | Reaccionar (una por usuario y publicación → 409) |
| POST | `/comentarios`, PATCH `/comentarios/{id}/like` | Comentar (`$push` + `$slice`) / like (`$inc`) |
| GET/POST/DELETE | `/campanas` | Vigentes a una fecha / crear / eliminar |
| GET | `/campanas/{id}/rendimiento` | Logro vs métricas objetivo |
| GET | `/reportes/usuarios-activos`, `/reportes/horarios` | Reportes de gestión |

## Seguridad

- El string de conexión se lee **solo** desde variables de entorno (`api/config.py`); nunca está en el código.
- `.env` está en `.gitignore`; las salidas guardadas enmascaran usuario y clave (`mongodb+srv://***:***@host`).
- La API usa un usuario de mínimo privilegio para escritura (`readWrite@contentflow`).
