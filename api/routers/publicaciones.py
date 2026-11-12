from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response

from ..db import db, nuevo_id
from ..schemas import Categoria, PublicacionIn, PublicacionPatch, TipoPublicacion
from .comun import ahora, obtener_o_404, paginacion, verificar_referencia

router = APIRouter(prefix="/publicaciones", tags=["publicaciones"])


@router.get("", summary="Listar publicaciones (filtros por categoría, tipo, hashtag y fecha)")
def listar(categoria: Optional[Categoria] = None, tipo: Optional[TipoPublicacion] = None,
           hashtag: Optional[str] = None, desde: Optional[datetime] = None, usuario_id: Optional[str] = None,
           pag: dict = Depends(paginacion)):
    filtro = {}
    if categoria:
        filtro["categoria"] = categoria.value
    if tipo:
        filtro["tipo"] = tipo.value
    if hashtag:
        filtro["hashtags"] = hashtag if hashtag.startswith("#") else "#" + hashtag
    if desde:
        filtro["fecha_publicacion"] = {"$gte": desde}
    if usuario_id:
        filtro["usuario_id"] = usuario_id
    cursor = (db.publicaciones.find(filtro, {"contenido": 1, "usuario_id": 1, "categoria": 1, "tipo": 1,
                                             "hashtags": 1, "fecha_publicacion": 1})
              .sort("fecha_publicacion", -1).skip(pag["skip"]).limit(pag["limit"]))
    return {"total": db.publicaciones.count_documents(filtro), "datos": list(cursor)}


@router.get("/populares", summary="Top de publicaciones por engagement (reacciones + 2 × comentarios)")
def populares(limite: int = 10):
    return list(db.publicaciones.aggregate([
        {"$lookup": {"from": "reacciones", "localField": "_id", "foreignField": "publicacion_id", "as": "r",
                     "pipeline": [{"$project": {"_id": 1}}]}},
        {"$lookup": {"from": "comentarios", "localField": "_id", "foreignField": "publicacion_id", "as": "c",
                     "pipeline": [{"$project": {"_id": 1}}]}},
        {"$project": {"categoria": 1, "tipo": 1, "reacciones": {"$size": "$r"}, "comentarios": {"$size": "$c"},
                      "engagement": {"$add": [{"$size": "$r"}, {"$multiply": [{"$size": "$c"}, 2]}]}}},
        {"$sort": {"engagement": -1, "_id": 1}},
        {"$limit": max(1, min(limite, 50))},
    ]))


@router.get("/{publicacion_id}", summary="Detalle de publicación con métricas calculadas")
def obtener(publicacion_id: str):
    p = obtener_o_404("publicaciones", publicacion_id)
    p["metricas_calculadas"] = {
        "reacciones": db.reacciones.count_documents({"publicacion_id": publicacion_id}),
        "comentarios": db.comentarios.count_documents({"publicacion_id": publicacion_id}),
        "por_tipo": {r["_id"]: r["n"] for r in db.reacciones.aggregate([
            {"$match": {"publicacion_id": publicacion_id}},
            {"$group": {"_id": "$tipo_reaccion", "n": {"$sum": 1}}}])},
    }
    return p


@router.get("/{publicacion_id}/comentarios", summary="Comentarios de una publicación (recientes primero)")
def comentarios(publicacion_id: str, pag: dict = Depends(paginacion)):
    obtener_o_404("publicaciones", publicacion_id, {"_id": 1})
    return list(db.comentarios.find({"publicacion_id": publicacion_id}).sort("fecha", -1)
                .skip(pag["skip"]).limit(pag["limit"]))


@router.get("/{publicacion_id}/reacciones", summary="Reacciones de una publicación")
def reacciones(publicacion_id: str):
    obtener_o_404("publicaciones", publicacion_id, {"_id": 1})
    return list(db.reacciones.find({"publicacion_id": publicacion_id}).sort("fecha", -1))


@router.post("", status_code=201, summary="Crear publicación (verifica que el usuario exista)")
def crear(datos: PublicacionIn):
    verificar_referencia("usuarios", datos.usuario_id, "usuario_id")
    doc = {"_id": nuevo_id("publicaciones"), **datos.model_dump(mode="json"), "fecha_publicacion": ahora(),
           "metricas": {"reacciones": 0, "comentarios": 0}}
    db.publicaciones.insert_one(doc)
    return doc


@router.patch("/{publicacion_id}", summary="Editar contenido y hashtags ($set, $addToSet, $pull)")
def editar(publicacion_id: str, cambios: PublicacionPatch):
    obtener_o_404("publicaciones", publicacion_id, {"_id": 1})
    if not (cambios.contenido or cambios.agregar_hashtags or cambios.quitar_hashtags):
        raise HTTPException(status_code=400, detail="No se enviaron cambios")
    if cambios.contenido:
        db.publicaciones.update_one({"_id": publicacion_id},
                                    {"$set": {"contenido": cambios.contenido, "editado_en": ahora()}})
    if cambios.agregar_hashtags:
        db.publicaciones.update_one({"_id": publicacion_id},
                                    {"$addToSet": {"hashtags": {"$each": [h.lower() for h in cambios.agregar_hashtags]}}})
    if cambios.quitar_hashtags:
        db.publicaciones.update_one({"_id": publicacion_id}, {"$pull": {"hashtags": {"$in": cambios.quitar_hashtags}}})
    return db.publicaciones.find_one({"_id": publicacion_id})


@router.delete("/{publicacion_id}", status_code=204, summary="Eliminar publicación sin interacciones")
def eliminar(publicacion_id: str):
    obtener_o_404("publicaciones", publicacion_id, {"_id": 1})
    if db.reacciones.find_one({"publicacion_id": publicacion_id}) or db.comentarios.find_one({"publicacion_id": publicacion_id}):
        raise HTTPException(status_code=409, detail="La publicación tiene interacciones; no se elimina para no perder contexto")
    db.campanas.update_many({"publicaciones_asociadas": publicacion_id}, {"$pull": {"publicaciones_asociadas": publicacion_id}})
    db.publicaciones.delete_one({"_id": publicacion_id})
    return Response(status_code=204)
