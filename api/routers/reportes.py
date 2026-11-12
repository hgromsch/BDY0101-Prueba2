from fastapi import APIRouter, Query

from ..db import db

router = APIRouter(prefix="/reportes", tags=["reportes"])


@router.get("/usuarios-activos", summary="Ranking de usuarios más activos")
def usuarios_activos(limite: int = Query(10, ge=1, le=50)):
    return list(db.publicaciones.aggregate([
        {"$project": {"usuario_id": 1, "t": {"$literal": "p"}}},
        {"$unionWith": {"coll": "reacciones", "pipeline": [{"$project": {"usuario_id": 1, "t": {"$literal": "r"}}}]}},
        {"$unionWith": {"coll": "comentarios", "pipeline": [{"$project": {"usuario_id": 1, "t": {"$literal": "c"}}}]}},
        {"$group": {"_id": "$usuario_id", "total": {"$sum": 1},
                    "publicaciones": {"$sum": {"$cond": [{"$eq": ["$t", "p"]}, 1, 0]}},
                    "reacciones": {"$sum": {"$cond": [{"$eq": ["$t", "r"]}, 1, 0]}},
                    "comentarios": {"$sum": {"$cond": [{"$eq": ["$t", "c"]}, 1, 0]}}}},
        {"$sort": {"total": -1, "_id": 1}}, {"$limit": limite},
        {"$lookup": {"from": "usuarios", "localField": "_id", "foreignField": "_id", "as": "u"}},
        {"$project": {"_id": 0, "usuario_id": "$_id", "nombre": {"$first": "$u.nombre"}, "pais": {"$first": "$u.pais"},
                      "total": 1, "publicaciones": 1, "reacciones": 1, "comentarios": 1}},
    ]))


@router.get("/horarios", summary="Interacciones por hora del día (hora de Chile), solo fechas confiables")
def horarios():
    confiable = {"calidad.flags": {"$nin": ["interaccion_antes_de_publicacion", "actividad_antes_de_registro"]}}
    return list(db.reacciones.aggregate([
        {"$match": confiable}, {"$project": {"fecha": 1}},
        {"$unionWith": {"coll": "comentarios", "pipeline": [{"$match": confiable}, {"$project": {"fecha": 1}}]}},
        {"$group": {"_id": {"$hour": {"date": "$fecha", "timezone": "America/Santiago"}}, "interacciones": {"$sum": 1}}},
        {"$sort": {"interacciones": -1}},
        {"$project": {"_id": 0, "hora": "$_id", "interacciones": 1}},
    ]))
