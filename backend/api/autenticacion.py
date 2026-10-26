# =====================================================================
# CETIA - Quien entra, por donde y con que
#
# Esto es lo que se queda en Django del reparto que decidimos: Django
# tiene la sesion, asi que le toca saber quien es la persona, con que rol
# entra y por cual de las dos aplicaciones puede entrar. El filtro de
# que datos alcanza no es de aqui: ese es de la capa de datos.
#
# Formas de acceso, iguales a las del proyecto relacional:
#   Alumno        matricula de 10 digitos    1426010001
#   Docente       numero de 8 digitos        90260001
#   Coordinador   numero de 8 digitos        91260001
#   Administrador correo
#
# Las contrasenas
# ---------------
# En el proyecto relacional las guardaba Supabase Auth, cifradas, y
# nunca tocaban las tablas del sistema. Aqui no hay Supabase, asi que se
# guardan en el documento de la persona, cifradas con los hashers de
# Django, que es lo que ya trae probado el framework. El campo se llama
# contrasena y nunca sale de aqui: ninguna respuesta de la API lo lleva.
# =====================================================================

import re
from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password

from .errores import ErrorDeAcceso, ErrorDeEntrada

MATRICULA = re.compile(r"^[1-8][0-9]{9}$")
NUMERO_DOCENTE = re.compile(r"^90[0-9]{6}$")
NUMERO_COORDINADOR = re.compile(r"^91[0-9]{6}$")
CORREO = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clasificar_acceso(acceso):
    """Dice con que esta intentando entrar la persona, sin tocar la base.

    Sirve para dos cosas: para que la capa de datos busque por el campo
    correcto, y para rechazar desde aqui lo que ni siquiera tiene forma
    de acceso valido, sin gastar una consulta.
    """
    acceso = (acceso or "").strip()
    if not acceso:
        raise ErrorDeEntrada("Falta el dato de acceso")

    if MATRICULA.match(acceso):
        return "matricula", acceso
    if NUMERO_DOCENTE.match(acceso):
        return "numero_empleado", acceso
    if NUMERO_COORDINADOR.match(acceso):
        return "numero_coordinador", acceso
    if CORREO.match(acceso):
        return "correo", acceso.lower()

    raise ErrorDeEntrada("El dato de acceso no tiene un formato valido")


def cifrar_contrasena(texto):
    if len(texto or "") < 8:
        raise ErrorDeEntrada("La contrasena debe tener al menos 8 caracteres")
    if not re.search(r"[A-Za-z]", texto) or not re.search(r"[0-9]", texto):
        raise ErrorDeEntrada("La contrasena debe llevar al menos una letra y un numero")
    return make_password(texto)


def contrasena_correcta(texto, cifrada):
    if not cifrada:
        return False
    return check_password(texto or "", cifrada)


def puede_entrar_por(rol, aplicacion):
    """La frontera entre el portal y el panel administrativo.

    El portal solo muestra el acceso de alumnos y docentes, y el panel es
    otra aplicacion en otra direccion que no se enlaza desde el portal.
    Pero que no se enlace no basta: la API tiene que rechazar a quien se
    equivoque de puerta, porque la direccion se puede escribir a mano.
    """
    permitidos = settings.ROLES_POR_APLICACION.get(aplicacion)
    if permitidos is None:
        raise ErrorDeEntrada("Aplicacion desconocida")
    return rol in permitidos


def crear_token(usuario, aplicacion):
    ahora = datetime.now(timezone.utc)
    carga = {
        "sub": str(usuario["_id"]),
        "rol": usuario["rol"],
        "app": aplicacion,
        "iat": ahora,
        "exp": ahora + timedelta(minutes=settings.MINUTOS_DE_SESION),
    }
    for clave, destino in (
        ("id_carrera", "id_carrera"),
        ("perfil_alumno.id_alumno", "id_alumno"),
        ("perfil_docente.id_docente", "id_docente"),
    ):
        valor = usuario
        for tramo in clave.split("."):
            valor = (valor or {}).get(tramo) if isinstance(valor, dict) else None
        if valor:
            carga[destino] = str(valor)

    return jwt.encode(carga, settings.SECRET_KEY, algorithm="HS256")


def leer_token(token):
    """Devuelve la identidad que lleva el token, o lanza si no sirve."""
    if not token:
        raise ErrorDeAcceso("Falta la sesion")
    try:
        carga = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise ErrorDeAcceso("La sesion expiro") from None
    except jwt.InvalidTokenError:
        raise ErrorDeAcceso("La sesion no es valida") from None

    return {
        "id": carga["sub"],
        "rol": carga["rol"],
        "app": carga.get("app"),
        "id_carrera": carga.get("id_carrera"),
        "id_alumno": carga.get("id_alumno"),
        "id_docente": carga.get("id_docente"),
    }


def identidad_de(peticion):
    """Saca la identidad de la cabecera Authorization de la peticion."""
    cabecera = peticion.headers.get("Authorization", "")
    if not cabecera.startswith("Bearer "):
        raise ErrorDeAcceso("Falta la sesion")

    identidad = leer_token(cabecera[7:])

    # Que el token sea valido no basta: tiene que venir por la puerta que
    # le toca a ese rol. Un token de alumno usado contra el panel se
    # rechaza aunque este perfectamente firmado.
    if identidad["app"] and not puede_entrar_por(identidad["rol"], identidad["app"]):
        raise ErrorDeAcceso("Esa cuenta no entra por esta aplicacion")

    return identidad
