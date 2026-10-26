# =====================================================================
# CETIA - Configuracion del backend
#
# El backend es la API. Atiende al portal y al panel, autentica a la
# persona, sostiene la frontera entre las dos aplicaciones y le pide los
# datos a la capa de Node.
#
# Django va aqui sin su ORM y sin base de datos propia
# ----------------------------------------------------
# Los datos viven en MongoDB, detras de la capa de Node, y Django no
# habla con MongoDB: no tiene credenciales de la base. Por eso no estan
# puestas las aplicaciones que traen modelos (admin, auth, sessions,
# contenttypes): sin base de datos no servirian, y dejarlas obligaria a
# levantar un PostgreSQL o un SQLite solo para que arranquen.
#
# La autenticacion tampoco es la de Django: la persona entra con su
# matricula o su numero, que viven en MongoDB, y la sesion viaja como
# token firmado. Eso esta en api/autenticacion.py.
# =====================================================================

import os
from pathlib import Path

from dotenv import load_dotenv

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
RAIZ_PROYECTO = RAIZ_BACKEND.parent

load_dotenv(RAIZ_PROYECTO / ".env")

# ---------------------------------------------------------------------
# Seguridad
# ---------------------------------------------------------------------

# La llave con la que se firman los tokens de sesion. En desarrollo se
# genera una al vuelo; en produccion tiene que venir de .env, porque si
# cambia cada vez que arranca el servidor, todas las sesiones se caen.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    from django.core.management.utils import get_random_secret_key

    SECRET_KEY = get_random_secret_key()

DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"

ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("DJANGO_HOSTS", "localhost,127.0.0.1").split(",")
    if h.strip()
]

# ---------------------------------------------------------------------
# Aplicaciones
# ---------------------------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "api",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "api.middleware.CabecerasDeSeguridad",
]

ROOT_URLCONF = "cetia.urls"
WSGI_APPLICATION = "cetia.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

# Sin base de datos propia: los datos estan en MongoDB, detras de la
# capa de Node.
DATABASES = {}

# ---------------------------------------------------------------------
# API
# ---------------------------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "api.errores.manejar_error",
}

# ---------------------------------------------------------------------
# El portal y el panel son dos aplicaciones en direcciones distintas, y
# la API esta en otra, asi que el navegador necesita permiso.
# ---------------------------------------------------------------------

CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ORIGENES_PERMITIDOS", "http://localhost:5173,http://localhost:5174"
    ).split(",")
    if o.strip()
]
CORS_ALLOW_CREDENTIALS = True

# ---------------------------------------------------------------------
# La capa de datos en Node: la unica puerta a MongoDB
# ---------------------------------------------------------------------

URL_CAPA_DATOS = os.environ.get("URL_CAPA_DATOS", "http://localhost:4000")

# Lo que comparten el backend y la capa de datos para reconocerse entre
# ellos. Evita que cualquiera que alcance la capa de datos pueda pedirle
# cosas haciendose pasar por el backend.
SECRETO_CAPA_DATOS = os.environ.get("SECRETO_CAPA_DATOS", "")

# ---------------------------------------------------------------------
# Sesion
# ---------------------------------------------------------------------

# La sesion se cierra sola despues de diez minutos sin actividad,
# avisando un minuto antes, igual que en el proyecto relacional.
MINUTOS_DE_SESION = int(os.environ.get("MINUTOS_DE_SESION", "10"))

# Las dos aplicaciones y por cual puede entrar cada rol. El portal no
# enlaza al panel y la API rechaza a quien se equivoque de puerta.
ROLES_POR_APLICACION = {
    "portal": {"alumno", "docente"},
    "panel": {"administrador", "coordinador"},
}

# ---------------------------------------------------------------------
# Idioma, zona y archivos
# ---------------------------------------------------------------------

LANGUAGE_CODE = "es-mx"
TIME_ZONE = "America/Mexico_City"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
