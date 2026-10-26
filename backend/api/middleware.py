# =====================================================================
# CETIA - Cabeceras de seguridad en todas las respuestas
#
# Las mismas que pone el proyecto relacional.
# =====================================================================


class CabecerasDeSeguridad:
    def __init__(self, siguiente):
        self.siguiente = siguiente

    def __call__(self, peticion):
        respuesta = self.siguiente(peticion)
        respuesta["X-Content-Type-Options"] = "nosniff"
        respuesta["X-Frame-Options"] = "DENY"
        respuesta["Referrer-Policy"] = "no-referrer"
        respuesta["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        respuesta["Cache-Control"] = "no-store"
        return respuesta
