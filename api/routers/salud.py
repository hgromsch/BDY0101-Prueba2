from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..db import ping

router = APIRouter(tags=["salud"])


@router.get("/salud", summary="Prueba de conectividad con MongoDB Atlas")
def salud():
    try:
        return {"estado": "ok", **ping()}
    except Exception as e:  # noqa: BLE001 - se informa cualquier fallo de conexión
        return JSONResponse(status_code=503, content={"estado": "sin conexión a la base de datos",
                                                      "error": type(e).__name__})
