from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..db import cliente, db, nuevo_id
from ..config import MONGODB_DB
from ..schemas import Dispositivo, UsuarioIn, UsuarioPatch
from .comun import ahora, obtener_o_404, paginacion

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


@router.get("", summary="Listar usuarios con filtros")
def listar(pais: Optional[str] = None, dispositivo: Optional[Dispositivo] = None, pag: dict = Depends(paginacion)):
    filtro = {}
    if pais:
        filtro["pais"] = pais
    if dispositivo:
        filtro["dispositivo"] = dispositivo.value
    cursor = db.usuarios.find(filtro).sort("_id", 1).skip(pag["skip"]).limit(pag["limit"])
    return {"total": db.usuarios.count_documents(filtro), "datos": list(cursor)}


@router.get("/{usuario_id}", summary="Perfil de un usuario con su actividad")
def obtener(usuario_id: str):
    u = obtener_o_404("usuarios", usuario_id)
    u["actividad"] = {
        "publicaciones": db.publicaciones.count_documents({"usuario_id": usuario_id}),
        "reacciones": db.reacciones.count_documents({"usuario_id": usuario_id}),
        "comentarios": db.comentarios.count_documents({"usuario_id": usuario_id}),
    }
    return u


@router.post("", status_code=201, summary="Registrar usuario (correo único)")
def crear(datos: UsuarioIn):
    doc = {"_id": nuevo_id("usuarios"), **datos.model_dump(mode="json"), "fecha_registro": ahora()}
    db.usuarios.insert_one(doc)          # DuplicateKeyError (correo) → 409 en el manejador global
    return doc


@router.patch("/{usuario_id}", summary="Actualizar datos del usuario ($set)")
def actualizar(usuario_id: str, cambios: UsuarioPatch):
    set_ = {k: v for k, v in cambios.model_dump(mode="json", exclude_none=True).items()}
    if not set_:
        raise HTTPException(status_code=400, detail="No se enviaron campos para actualizar")
    obtener_o_404("usuarios", usuario_id, {"_id": 1})
    db.usuarios.update_one({"_id": usuario_id}, {"$set": {**set_, "actualizado_en": ahora()}})
    return db.usuarios.find_one({"_id": usuario_id})


@router.delete("/{usuario_id}", status_code=204, summary="Eliminar usuario (cascada=true borra su actividad en una transacción)")
def eliminar(usuario_id: str, cascada: bool = Query(False)):
    obtener_o_404("usuarios", usuario_id, {"_id": 1})
    tiene_actividad = any(db[c].find_one({"usuario_id": usuario_id}, {"_id": 1})
                          for c in ("publicaciones", "reacciones", "comentarios"))
    if tiene_actividad and not cascada:
        raise HTTPException(status_code=409, detail="El usuario tiene actividad; use ?cascada=true para eliminarla también")

    def borrar(sesion):
        s = cliente.get_database(MONGODB_DB)
        pubs = [p["_id"] for p in s.publicaciones.find({"usuario_id": usuario_id}, {"_id": 1}, session=sesion)]
        filtro = {"$or": [{"usuario_id": usuario_id}, {"publicacion_id": {"$in": pubs}}]}
        s.reacciones.delete_many(filtro, session=sesion)
        s.comentarios.delete_many(filtro, session=sesion)
        s.campanas.update_many({"publicaciones_asociadas": {"$in": pubs}},
                               {"$pull": {"publicaciones_asociadas": {"$in": pubs}}}, session=sesion)
        s.publicaciones.delete_many({"_id": {"$in": pubs}}, session=sesion)
        s.usuarios.delete_one({"_id": usuario_id}, session=sesion)

    with cliente.start_session() as sesion:
        sesion.with_transaction(borrar)
    return Response(status_code=204)
