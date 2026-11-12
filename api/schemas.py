"""Modelos de entrada (validación de campos obligatorios, tipos y valores permitidos)."""
from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


class Genero(str, Enum):
    femenino = "Femenino"
    masculino = "Masculino"
    otro = "Otro"


class Dispositivo(str, Enum):
    movil = "Móvil"
    desktop = "Desktop"
    tablet = "Tablet"


class Categoria(str, Enum):
    tecnologia = "Tecnología"
    cultura = "Cultura"
    educacion = "Educación"
    deportes = "Deportes"
    entretenimiento = "Entretenimiento"


class TipoPublicacion(str, Enum):
    imagen = "Imagen"
    video = "Video"
    texto = "Texto"


class TipoReaccion(str, Enum):
    me_gusta = "Me gusta"
    me_encanta = "Me encanta"
    me_entristece = "Me entristece"
    me_enoja = "Me enoja"


class ObjetivoCampana(str, Enum):
    captar = "Captar nuevos usuarios"
    engagement = "Aumentar engagement"
    promover = "Promover contenido"


class UsuarioIn(BaseModel):
    nombre: str = Field(min_length=2, max_length=100)
    correo: EmailStr
    pais: str = Field(min_length=2, max_length=60)
    genero: Genero
    dispositivo: Dispositivo


class UsuarioPatch(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=2, max_length=100)
    pais: Optional[str] = Field(default=None, min_length=2, max_length=60)
    dispositivo: Optional[Dispositivo] = None


class PublicacionIn(BaseModel):
    usuario_id: str = Field(pattern=r"^user_\w+$")
    contenido: str = Field(min_length=1, max_length=2000)
    categoria: Categoria
    tipo: TipoPublicacion
    hashtags: List[str] = Field(default_factory=list, max_length=10)

    @field_validator("hashtags")
    @classmethod
    def hashtags_validos(cls, v):
        for h in v:
            if not h.startswith("#") or len(h) < 2 or " " in h:
                raise ValueError(f"hashtag inválido: {h!r} (debe empezar con # y no tener espacios)")
        return list(dict.fromkeys(h.lower() for h in v))   # sin duplicados


class PublicacionPatch(BaseModel):
    contenido: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    agregar_hashtags: List[str] = Field(default_factory=list)
    quitar_hashtags: List[str] = Field(default_factory=list)


class ReaccionIn(BaseModel):
    usuario_id: str = Field(pattern=r"^user_\w+$")
    publicacion_id: str = Field(pattern=r"^pub_\w+$")
    tipo_reaccion: TipoReaccion


class ComentarioIn(BaseModel):
    usuario_id: str = Field(pattern=r"^user_\w+$")
    publicacion_id: str = Field(pattern=r"^pub_\w+$")
    comentario: str = Field(min_length=1, max_length=1000)


class MetricasObjetivo(BaseModel):
    likes: int = Field(ge=0)
    comentarios: int = Field(ge=0)
    compartidos: int = Field(ge=0)


class CampanaIn(BaseModel):
    nombre: str = Field(min_length=3, max_length=120)
    fecha_inicio: datetime
    fecha_fin: datetime
    objetivo: ObjetivoCampana
    publicaciones_asociadas: List[str] = Field(default_factory=list)
    metricas_objetivo: MetricasObjetivo

    @field_validator("fecha_fin")
    @classmethod
    def fin_despues_de_inicio(cls, v, info):
        if "fecha_inicio" in info.data and v <= info.data["fecha_inicio"]:
            raise ValueError("fecha_fin debe ser posterior a fecha_inicio")
        return v
