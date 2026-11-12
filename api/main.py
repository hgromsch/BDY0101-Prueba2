"""API REST de ContentFlow conectada a MongoDB Atlas.

Ejecutar desde la carpeta contentflow/:
    uvicorn api.main:app --port 8000
Documentación interactiva: http://127.0.0.1:8000/docs
"""
import logging
import time
import uuid
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo.errors import (ConnectionFailure, DuplicateKeyError, OperationFailure,
                            ServerSelectionTimeoutError, WriteError)

from .config import LOG_FILE
from .db import inicializar_contadores, ping
from .routers import campanas, interacciones, publicaciones, reportes, salud, usuarios

# ------------------------------------------------------------------ registro de actividad (logs)
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
formato = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s %(message)s")
archivo = RotatingFileHandler(LOG_FILE, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
archivo.setFormatter(formato)
consola = logging.StreamHandler()
consola.setFormatter(formato)
logging.basicConfig(level=logging.INFO, handlers=[archivo, consola])
log = logging.getLogger("contentflow.api")


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    try:
        info = ping()
        log.info("Conectado a MongoDB Atlas %s (%s %s) en %s ms", info["uri"], info["proveedor"],
                 info["region"], info["latencia_ms"])
        inicializar_contadores()
    except Exception as e:  # noqa: BLE001 - la API arranca igual y /salud informa el problema
        log.error("No se pudo conectar a MongoDB Atlas al iniciar: %s", type(e).__name__)
    yield
    log.info("API detenida")


app = FastAPI(title="ContentFlow API", version="1.0.0", lifespan=ciclo_de_vida,
              description="API REST de ContentFlow sobre MongoDB Atlas (EP2 BDY0101 – Forma A).")


@app.middleware("http")
async def trazabilidad(request: Request, call_next):
    """Asigna un id a cada petición, mide su duración y la registra en el log."""
    rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:8]
    request.state.rid = rid
    inicio = time.perf_counter()
    respuesta = await call_next(request)
    ms = (time.perf_counter() - inicio) * 1000
    nivel = logging.WARNING if respuesta.status_code >= 400 else logging.INFO
    log.log(nivel, "rid=%s %s %s → %s (%.1f ms)", rid, request.method, request.url.path, respuesta.status_code, ms)
    respuesta.headers["X-Request-ID"] = rid
    return respuesta


def error(request: Request, estado: int, tipo: str, detalle) -> JSONResponse:
    return JSONResponse(status_code=estado, content={"error": tipo, "detalle": detalle,
                                                     "request_id": getattr(request.state, "rid", None)})


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    tipos = {400: "solicitud_invalida", 404: "no_encontrado", 409: "conflicto", 422: "referencia_invalida"}
    return error(request, exc.status_code, tipos.get(exc.status_code, "error"), exc.detail)


@app.exception_handler(RequestValidationError)
async def validacion(request: Request, exc: RequestValidationError):
    campos = [{"campo": ".".join(str(x) for x in e["loc"][1:]), "problema": e["msg"]} for e in exc.errors()]
    log.warning("rid=%s validación de entrada fallida: %s", request.state.rid, campos)
    return error(request, 422, "validacion", campos)


@app.exception_handler(DuplicateKeyError)
async def duplicado(request: Request, exc: DuplicateKeyError):
    clave = (exc.details or {}).get("keyValue")
    log.warning("rid=%s clave duplicada %s", request.state.rid, clave)
    return error(request, 409, "duplicado", {"mensaje": "Ya existe un documento con esa clave única", "clave": clave})


@app.exception_handler(WriteError)
async def escritura(request: Request, exc: WriteError):
    if exc.code == 121:   # Document failed validation ($jsonSchema)
        return error(request, 400, "esquema", "El documento no cumple el validador $jsonSchema de la colección")
    log.error("rid=%s error de escritura %s", request.state.rid, exc.code)
    return error(request, 500, "escritura", str(exc.code))


@app.exception_handler(ServerSelectionTimeoutError)
@app.exception_handler(ConnectionFailure)
async def sin_conexion(request: Request, exc: Exception):
    log.error("rid=%s sin conexión con MongoDB Atlas: %s", request.state.rid, type(exc).__name__)
    return error(request, 503, "base_de_datos_no_disponible", "No hay conexión con MongoDB Atlas; intente más tarde")


@app.exception_handler(OperationFailure)
async def operacion(request: Request, exc: OperationFailure):
    estado = 403 if exc.code == 13 else 500   # 13 = Unauthorized (rol sin permisos)
    log.error("rid=%s operación rechazada por MongoDB: code=%s", request.state.rid, exc.code)
    return error(request, estado, "operacion_mongodb", exc.details.get("errmsg") if exc.details else str(exc.code))


for r in (salud, usuarios, publicaciones, interacciones, campanas, reportes):
    app.include_router(r.router)
