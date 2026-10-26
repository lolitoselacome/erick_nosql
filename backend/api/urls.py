# =====================================================================
# CETIA - Rutas de la aplicacion
# =====================================================================

from django.urls import path

from .rutas import acceso

urlpatterns = [
    path("acceso/entrar", acceso.entrar, name="entrar"),
    path("acceso/yo", acceso.yo, name="yo"),
]
