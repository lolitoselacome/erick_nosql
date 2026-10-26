# =====================================================================
# CETIA - Errores
#
# Los errores internos nunca se le muestran a la persona: se registran
# y se responde algo generico. Lo que si se muestra es lo que la persona
# puede corregir, como una fecha invalida o un empalme de horario.
# =====================================================================

import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

registro = logging.getLogger("cetia")


class ErrorDeAcceso(Exception):
    """La persona no alcanza eso, o no por esa puerta."""

    codigo = status.HTTP_403_FORBIDDEN


class ErrorDeEntrada(Exception):
    """Lo que mando la persona no se puede aceptar, y puede corregirlo."""

    codigo = status.HTTP_400_BAD_REQUEST


class ErrorDeRegla(Exception):
    """Una regla del sistema escolar lo impide: cupo, empalme, seriacion."""

    codigo = status.HTTP_409_CONFLICT


class ErrorDeCapaDeDatos(Exception):
    """La capa de datos no respondio o respondio mal."""

    codigo = status.HTTP_503_SERVICE_UNAVAILABLE


PROPIOS = (ErrorDeAcceso, ErrorDeEntrada, ErrorDeRegla, ErrorDeCapaDeDatos)


def manejar_error(excepcion, contexto):
    if isinstance(excepcion, PROPIOS):
        # Estos si llevan mensaje: describen algo que la persona puede
        # entender y, en varios casos, corregir.
        return Response({"error": str(excepcion)}, status=excepcion.codigo)

    respuesta = exception_handler(excepcion, contexto)
    if respuesta is not None:
        return respuesta

    # Cualquier otra cosa es un error nuestro: se registra completo y se
    # responde sin detalles.
    registro.exception("Error no controlado", exc_info=excepcion)
    return Response(
        {"error": "Ocurrio un error. Intentalo de nuevo mas tarde."},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
