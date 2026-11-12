from fastapi import APIRouter, Response

from ..db import db, nuevo_id
from ..schemas import ComentarioIn, ReaccionIn
from .comun import ahora, obtener_o_404, verificar_referencia

router = APIRouter(tags=["interacciones"])


@router.post("/reacciones", status_code=201, summary="Registrar reacción (una por usuario y publicación)")
def reaccionar(datos: ReaccionIn):
    verificar_referencia("usuarios", datos.usuario_id, "usuario_id")
    verificar_referencia("publicaciones", datos.publicacion_id, "publicacion_id")
    doc = {"_id": nuevo_id("reacciones"), **datos.model_dump(mode="json"), "fecha": ahora()}
    db.reacciones.insert_one(doc)        # índice único usuario+publicación → 409 si ya reaccionó
    db.publicaciones.update_one({"_id": datos.publicacion_id}, {"$inc": {"metricas.reacciones": 1}})
    return doc


@router.delete("/reacciones/{reaccion_id}", status_code=204, summary="Quitar una reacción")
def quitar_reaccion(reaccion_id: str):
    r = obtener_o_404("reacciones", reaccion_id)
    db.reacciones.delete_one({"_id": reaccion_id})
    db.publicaciones.update_one({"_id": r["publicacion_id"]}, {"$inc": {"metricas.reacciones": -1}})
    return Response(status_code=204)


@router.post("/comentarios", status_code=201, summary="Comentar una publicación")
def comentar(datos: ComentarioIn):
    verificar_referencia("usuarios", datos.usuario_id, "usuario_id")
    verificar_referencia("publicaciones", datos.publicacion_id, "publicacion_id")
    doc = {"_id": nuevo_id("comentarios"), **datos.model_dump(mode="json"), "fecha": ahora(), "likes": 0}
    db.comentarios.insert_one(doc)
    db.publicaciones.update_one({"_id": datos.publicacion_id}, {
        "$inc": {"metricas.comentarios": 1},
        "$push": {"ultimos_comentarios": {"$each": [{"id": doc["_id"], "usuario_id": doc["usuario_id"],
                                                      "texto": doc["comentario"]}], "$position": 0, "$slice": 3}}})
    return doc


@router.patch("/comentarios/{comentario_id}/like", summary="Dar like a un comentario ($inc)")
def like(comentario_id: str):
    obtener_o_404("comentarios", comentario_id, {"_id": 1})
    db.comentarios.update_one({"_id": comentario_id}, {"$inc": {"likes": 1}})
    return db.comentarios.find_one({"_id": comentario_id}, {"likes": 1})
