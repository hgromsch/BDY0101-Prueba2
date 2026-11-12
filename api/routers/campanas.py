from datetime import datetime
from typing import Optional

from fastapi import APIRouter

from ..db import db, nuevo_id
from ..schemas import CampanaIn
from .comun import obtener_o_404, verificar_referencia

router = APIRouter(prefix="/campanas", tags=["campañas"])


@router.get("", summary="Campañas (opcionalmente vigentes a una fecha)")
def listar(vigentes_en: Optional[datetime] = None, objetivo: Optional[str] = None, limite: int = 20):
    filtro = {}
    if vigentes_en:
        filtro.update({"fecha_inicio": {"$lte": vigentes_en}, "fecha_fin": {"$gte": vigentes_en}})
    if objetivo:
        filtro["objetivo"] = objetivo
    return {"total": db.campanas.count_documents(filtro),
            "datos": list(db.campanas.find(filtro, {"calidad": 0}).sort("fecha_inicio", -1).limit(min(limite, 100)))}


@router.get("/{campana_id}/rendimiento", summary="Logro de la campaña vs sus métricas objetivo")
def rendimiento(campana_id: str):
    obtener_o_404("campanas", campana_id, {"_id": 1})
    r = list(db.campanas.aggregate([
        {"$match": {"_id": campana_id}},
        {"$lookup": {"from": "reacciones", "as": "r",
                     "let": {"pubs": "$publicaciones_asociadas", "ini": "$fecha_inicio", "fin": "$fecha_fin"},
                     "pipeline": [{"$match": {"$expr": {"$and": [
                         {"$in": ["$publicacion_id", "$$pubs"]}, {"$gte": ["$fecha", "$$ini"]}, {"$lte": ["$fecha", "$$fin"]},
                         {"$in": ["$tipo_reaccion", ["Me gusta", "Me encanta"]]}]}}}, {"$project": {"_id": 1}}]}},
        {"$lookup": {"from": "comentarios", "as": "c",
                     "let": {"pubs": "$publicaciones_asociadas", "ini": "$fecha_inicio", "fin": "$fecha_fin"},
                     "pipeline": [{"$match": {"$expr": {"$and": [
                         {"$in": ["$publicacion_id", "$$pubs"]}, {"$gte": ["$fecha", "$$ini"]}, {"$lte": ["$fecha", "$$fin"]}]}}},
                         {"$project": {"_id": 1}}]}},
        {"$project": {"nombre": 1, "objetivo": 1, "fecha_inicio": 1, "fecha_fin": 1, "metricas_objetivo": 1,
                      "publicaciones_asociadas": 1,
                      "logro": {"likes": {"$size": "$r"}, "comentarios": {"$size": "$c"}},
                      "cumplimiento_pct": {
                          "likes": {"$round": [{"$multiply": [{"$divide": [{"$size": "$r"}, {"$max": ["$metricas_objetivo.likes", 1]}]}, 100]}, 2]},
                          "comentarios": {"$round": [{"$multiply": [{"$divide": [{"$size": "$c"}, {"$max": ["$metricas_objetivo.comentarios", 1]}]}, 100]}, 2]}}}},
    ]))
    return r[0]


@router.post("", status_code=201, summary="Crear campaña (verifica publicaciones asociadas)")
def crear(datos: CampanaIn):
    for p in datos.publicaciones_asociadas:
        verificar_referencia("publicaciones", p, "publicaciones_asociadas")
    doc = {"_id": nuevo_id("campanas"), **datos.model_dump()}
    db.campanas.insert_one(doc)
    return doc


@router.post("/{campana_id}/publicaciones/{publicacion_id}", summary="Asociar publicación a campaña ($addToSet)")
def asociar(campana_id: str, publicacion_id: str):
    obtener_o_404("campanas", campana_id, {"_id": 1})
    verificar_referencia("publicaciones", publicacion_id, "publicacion_id")
    db.campanas.update_one({"_id": campana_id}, {"$addToSet": {"publicaciones_asociadas": publicacion_id}})
    return db.campanas.find_one({"_id": campana_id}, {"nombre": 1, "publicaciones_asociadas": 1})


@router.delete("/{campana_id}", status_code=204, summary="Eliminar campaña")
def eliminar(campana_id: str):
    from fastapi import Response
    obtener_o_404("campanas", campana_id, {"_id": 1})
    db.campanas.delete_one({"_id": campana_id})
    return Response(status_code=204)
