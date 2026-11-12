"""Utilidades compartidas por los endpoints: verificación de referencias y paginación."""
from datetime import datetime, timezone

from fastapi import HTTPException, Query

from ..db import db


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def obtener_o_404(col: str, _id: str, proyeccion: dict | None = None) -> dict:
    doc = db[col].find_one({"_id": _id}, proyeccion)
    if not doc:
        raise HTTPException(status_code=404, detail=f"{col[:-1] if col != 'campanas' else 'campaña'} '{_id}' no existe")
    return doc


def verificar_referencia(col: str, _id: str, campo: str) -> None:
    """Referencia existente: si el documento referenciado no existe se responde 422."""
    if not db[col].find_one({"_id": _id}, {"_id": 1}):
        raise HTTPException(status_code=422, detail=f"Referencia inválida: {campo}='{_id}' no existe en {col}")


def paginacion(limit: int = Query(20, ge=1, le=100), skip: int = Query(0, ge=0)) -> dict:
    return {"limit": limit, "skip": skip}
