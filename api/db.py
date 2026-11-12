"""Conexión única (pool) a MongoDB Atlas con pymongo, read concern majority y write concern majority + journal."""
import logging
import time

from pymongo import MongoClient, ReturnDocument
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern

from .config import MONGODB_DB, MONGODB_URI, TIMEOUT_MS, uri_enmascarada

log = logging.getLogger("contentflow.db")

cliente = MongoClient(
    MONGODB_URI,
    appname="contentflow-api",
    serverSelectionTimeoutMS=TIMEOUT_MS,
    connectTimeoutMS=TIMEOUT_MS,
    maxPoolSize=20,          # M0 admite 500 conexiones; se limita el pool para no agotarlas
    retryWrites=True,
    tz_aware=True,
)
db = cliente.get_database(
    MONGODB_DB,
    read_concern=ReadConcern("majority"),
    write_concern=WriteConcern(w="majority", j=True, wtimeout=10000),
)

COLECCIONES_CON_ID = {"usuarios": "user", "publicaciones": "pub", "reacciones": "react",
                      "comentarios": "comm", "campanas": "camp"}


def ping() -> dict:
    """Prueba de conectividad: ping al cluster y latencia."""
    inicio = time.perf_counter()
    cliente.admin.command("ping")
    ms = round((time.perf_counter() - inicio) * 1000, 1)
    hello = cliente.admin.command("hello")
    tags = hello.get("tags", {})
    return {"atlas": "conectado", "latencia_ms": ms, "base": MONGODB_DB,
            "replica_set": hello.get("setName"), "proveedor": tags.get("provider"),
            "region": tags.get("region"), "uri": uri_enmascarada()}


def inicializar_contadores() -> None:
    """Deja cada contador de ids en el máximo existente (user_500 → 500) para generar ids nuevos sin choques."""
    for col, prefijo in COLECCIONES_CON_ID.items():
        maximo = list(db[col].aggregate([
            {"$match": {"_id": {"$regex": f"^{prefijo}_[0-9]+$"}}},
            {"$group": {"_id": None, "max": {"$max": {"$toInt": {"$substrCP": [
                "$_id", len(prefijo) + 1, 20]}}}}},
        ]))
        valor = maximo[0]["max"] if maximo else 0
        db.contadores.update_one({"_id": col}, {"$max": {"seq": valor}}, upsert=True)
    log.info("Contadores de ids inicializados")


def nuevo_id(col: str) -> str:
    """Id legible y correlativo (patrón de contador atómico con $inc)."""
    doc = db.contadores.find_one_and_update({"_id": col}, {"$inc": {"seq": 1}}, upsert=True,
                                            return_document=ReturnDocument.AFTER)
    return f"{COLECCIONES_CON_ID[col]}_{doc['seq']}"
