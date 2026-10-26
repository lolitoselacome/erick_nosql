# =====================================================================
# CETIA - Rutas de la API
# =====================================================================

from django.http import JsonResponse
from django.urls import include, path


def salud(peticion):
    """Para saber si la API esta arriba, sin tocar la base."""
    return JsonResponse({"estado": "bien", "servicio": "api"})


urlpatterns = [
    path("", salud),
    path("api/", include("api.urls")),
]
