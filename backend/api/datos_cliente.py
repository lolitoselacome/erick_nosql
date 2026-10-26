# =====================================================================
# CETIA - Cliente de la capa de datos
#
# Django no habla con MongoDB. Todo lo que necesita se lo pide a la capa
# de datos en Node, y siempre le dice quien es la persona que lo pide.
#
# Por que la identidad va en cada llamada
# ---------------------------------------
# Porque el filtro por fila, que es el heredero de la seguridad por
# filas de PostgreSQL, lo aplica la capa de datos a partir de esa
# identidad. Si Django pudiera pedir datos sin decir quien pregunta, ese
# filtro se podria saltar, y entonces no serviria de nada.
#
# Por eso esta clase no tiene un metodo para "pedir cualquier cosa": el
# constructor exige la identidad y todas las llamadas la arrastran.
# =====================================================================

import requests
from django.conf import settings

from .errores import ErrorDeAcceso, ErrorDeCapaDeDatos, ErrorDeEntrada, ErrorDeRegla

TIEMPO_LIMITE = 20

# Lo que responde la capa de datos segun lo que paso, y en que error
# nuestro se convierte.
ERRORES = {
    400: ErrorDeEntrada,
    403: ErrorDeAcceso,
    404: ErrorDeEntrada,
    409: ErrorDeRegla,
}


class CapaDeDatos:
    def __init__(self, identidad):
        if not identidad or not identidad.get("rol"):
            raise ErrorDeAcceso(
                "No se puede consultar sin identidad: toda llamada a la capa de "
                "datos lleva quien la hace."
            )
        self.identidad = identidad

    def _cabeceras(self):
        cabeceras = {
            "Content-Type": "application/json",
            # La identidad viaja aparte del cuerpo, para que no se
            # confunda nunca con los datos de la peticion.
            "X-Identidad-Id": str(self.identidad["id"]),
            "X-Identidad-Rol": self.identidad["rol"],
        }
        for clave, cabecera in (
            ("id_carrera", "X-Identidad-Carrera"),
            ("id_alumno", "X-Identidad-Alumno"),
            ("id_docente", "X-Identidad-Docente"),
        ):
            if self.identidad.get(clave):
                cabeceras[cabecera] = str(self.identidad[clave])

        if settings.SECRETO_CAPA_DATOS:
            cabeceras["X-Secreto"] = settings.SECRETO_CAPA_DATOS
        return cabeceras

    def _llamar(self, metodo, ruta, cuerpo=None, parametros=None):
        url = f"{settings.URL_CAPA_DATOS.rstrip('/')}{ruta}"
        try:
            respuesta = requests.request(
                metodo,
                url,
                json=cuerpo,
                params=parametros,
                headers=self._cabeceras(),
                timeout=TIEMPO_LIMITE,
            )
        except requests.RequestException as error:
            raise ErrorDeCapaDeDatos(
                "No se pudo hablar con la capa de datos"
            ) from error

        if respuesta.status_code in ERRORES:
            try:
                mensaje = respuesta.json().get("error", "")
            except ValueError:
                mensaje = ""
            raise ERRORES[respuesta.status_code](mensaje or "No se pudo completar")

        if respuesta.status_code >= 500:
            raise ErrorDeCapaDeDatos("La capa de datos respondio con un error")

        if respuesta.status_code == 204:
            return None

        try:
            return respuesta.json()
        except ValueError as error:
            raise ErrorDeCapaDeDatos("La capa de datos respondio algo ilegible") from error

    # --- Lo que usa la API -------------------------------------------

    def listar(self, coleccion, filtro=None, pagina=1, por_pagina=25):
        return self._llamar(
            "GET",
            f"/{coleccion}",
            parametros={
                "filtro": filtro or "",
                "pagina": pagina,
                "por_pagina": por_pagina,
            },
        )

    def obtener(self, coleccion, id_documento):
        return self._llamar("GET", f"/{coleccion}/{id_documento}")

    def crear(self, coleccion, documento):
        return self._llamar("POST", f"/{coleccion}", cuerpo=documento)

    def actualizar(self, coleccion, id_documento, cambios):
        return self._llamar("PATCH", f"/{coleccion}/{id_documento}", cuerpo=cambios)

    def borrar(self, coleccion, id_documento):
        return self._llamar("DELETE", f"/{coleccion}/{id_documento}")


def buscar_cuenta(acceso):
    """Busca la cuenta al iniciar sesion.

    Es la unica llamada que no lleva identidad, porque todavia no hay:
    es justo la que la averigua. Por eso va por su propia ruta y la capa
    de datos la atiende con el rol de acceso, que solo alcanza a leer la
    cuenta y nada mas.
    """
    url = f"{settings.URL_CAPA_DATOS.rstrip('/')}/acceso/buscar"
    cabeceras = {"Content-Type": "application/json"}
    if settings.SECRETO_CAPA_DATOS:
        cabeceras["X-Secreto"] = settings.SECRETO_CAPA_DATOS

    try:
        respuesta = requests.post(
            url, json={"acceso": acceso}, headers=cabeceras, timeout=TIEMPO_LIMITE
        )
    except requests.RequestException as error:
        raise ErrorDeCapaDeDatos("No se pudo hablar con la capa de datos") from error

    if respuesta.status_code == 404:
        return None
    if respuesta.status_code >= 500:
        raise ErrorDeCapaDeDatos("La capa de datos respondio con un error")

    try:
        return respuesta.json()
    except ValueError:
        return None
