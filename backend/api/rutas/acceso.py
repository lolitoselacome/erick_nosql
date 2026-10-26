# =====================================================================
# CETIA - Entrar y salir
#
# El portal y el panel usan la misma ruta, pero dicen por cual de las dos
# aplicaciones entran, y la API rechaza a quien se equivoque de puerta.
# =====================================================================

from django.conf import settings
from rest_framework.decorators import api_view
from rest_framework.response import Response

from ..autenticacion import (
    clasificar_acceso,
    contrasena_correcta,
    crear_token,
    identidad_de,
    puede_entrar_por,
)
from ..datos_cliente import buscar_cuenta
from ..errores import ErrorDeAcceso, ErrorDeEntrada

# Al fallar el acceso siempre se responde lo mismo, sin decir si la
# cuenta existe: quien prueba datos al azar no aprende nada de la
# respuesta.
MENSAJE_GENERICO = "El dato de acceso o la contrasena no son correctos"


@api_view(["POST"])
def entrar(peticion):
    datos = peticion.data or {}
    aplicacion = (datos.get("aplicacion") or "").strip()

    if aplicacion not in settings.ROLES_POR_APLICACION:
        raise ErrorDeEntrada("Falta decir por cual aplicacion se entra")

    campo, valor = clasificar_acceso(datos.get("acceso"))

    cuenta = buscar_cuenta({"campo": campo, "valor": valor})

    # Las tres razones de rechazo responden igual, a proposito.
    if not cuenta:
        raise ErrorDeAcceso(MENSAJE_GENERICO)
    if not contrasena_correcta(datos.get("contrasena"), cuenta.get("contrasena")):
        raise ErrorDeAcceso(MENSAJE_GENERICO)
    if not cuenta.get("activo", False):
        raise ErrorDeAcceso(MENSAJE_GENERICO)

    # Esta si dice la razon, porque no es un dato que ayude a nadie a
    # adivinar: quien ya probo su contrasena sabe que su cuenta existe.
    if not puede_entrar_por(cuenta["rol"], aplicacion):
        raise ErrorDeAcceso("Esa cuenta no entra por esta aplicacion")

    return Response(
        {
            "token": crear_token(cuenta, aplicacion),
            "minutos_de_sesion": settings.MINUTOS_DE_SESION,
            "usuario": perfil_publico(cuenta),
        }
    )


@api_view(["GET"])
def yo(peticion):
    """Quien soy, segun la sesion. Lo usa el frontend al cargar."""
    identidad = identidad_de(peticion)
    return Response({"identidad": identidad})


def perfil_publico(cuenta):
    """Lo que se le puede mandar al navegador de una cuenta.

    La contrasena cifrada nunca sale, ni siquiera cifrada.
    """
    perfil = {
        "id": str(cuenta["_id"]),
        "rol": cuenta["rol"],
        "nombre": cuenta.get("nombre"),
        "apellido_paterno": cuenta.get("apellido_paterno"),
        "apellido_materno": cuenta.get("apellido_materno"),
        "correo": cuenta.get("correo"),
    }
    alumno = cuenta.get("perfil_alumno") or {}
    if alumno:
        perfil["matricula"] = alumno.get("matricula")
        perfil["carrera"] = (alumno.get("carrera") or {}).get("nombre")
        perfil["cuatrimestre"] = alumno.get("cuatrimestre_actual")
    docente = cuenta.get("perfil_docente") or {}
    if docente:
        perfil["numero_empleado"] = docente.get("numero_empleado")
    if cuenta.get("numero_coordinador"):
        perfil["numero_coordinador"] = cuenta["numero_coordinador"]
    return perfil
