"""Configuración leída SOLO desde variables de entorno (.env). Nunca se escribe el string de conexión en el código."""
import os
from pathlib import Path

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent
load_dotenv(RAIZ / ".env")

# Para la API se prefiere un usuario con rol readWrite@contentflow (MONGODB_URI_APP);
# si no está definido se usa MONGODB_URI.
MONGODB_URI = os.getenv("MONGODB_URI_APP") or os.getenv("MONGODB_URI")
MONGODB_DB = os.getenv("MONGODB_DB", "contentflow")
LOG_FILE = Path(os.getenv("LOG_FILE", RAIZ / "api" / "logs" / "api.log"))
TIMEOUT_MS = int(os.getenv("MONGODB_TIMEOUT_MS", "5000"))

if not MONGODB_URI:
    raise RuntimeError("Falta la variable de entorno MONGODB_URI (ver .env.example)")


def uri_enmascarada(uri: str = MONGODB_URI) -> str:
    """mongodb+srv://usuario:clave@host → mongodb+srv://***:***@host (para logs)."""
    if "@" in uri and "://" in uri:
        esquema, resto = uri.split("://", 1)
        return f"{esquema}://***:***@{resto.split('@', 1)[1]}"
    return uri
