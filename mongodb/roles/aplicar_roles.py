# =====================================================================
# CETIA - Aplicador de los roles personalizados
#
# Crea en MongoDB los roles que estan definidos en roles.py. Si el rol ya
# existe, le deja los permisos que dice el archivo, asi que correrlo dos
# veces no hace dano y es la forma de publicar un cambio de permisos.
#
#   python mongodb/roles/aplicar_roles.py --ver     solo los imprime
#   python mongodb/roles/aplicar_roles.py --local   los crea en el Mongo local
#   python mongodb/roles/aplicar_roles.py --atlas   los crea en Atlas
#
# Por que este aplicador no es una migracion mas
# ----------------------------------------------
# Porque los roles no se crean igual en los dos lados. En el MongoDB
# local se crean con el comando createRole del propio motor, pero en
# Atlas eso esta prohibido: ningun usuario de base de datos puede
# administrar roles por el driver, ni siquiera uno con atlasAdmin. En
# Atlas los roles se crean por la consola o por la API de administracion,
# que es otra puerta, con otras credenciales.
#
# Asi que el aplicador habla los dos idiomas y lee la misma definicion
# para los dos, que es justo lo que evita que el Mongo local y Atlas se
# vayan separando sin que nadie se de cuenta.
#
# Las credenciales de la API de Atlas se sacan en la organizacion, en
# Access Manager, API Keys, y van en .env como ATLAS_PUBLIC_KEY,
# ATLAS_PRIVATE_KEY y ATLAS_GROUP_ID. La llave necesita el permiso
# Project Owner sobre el proyecto.
# =====================================================================

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from roles import ROLES, TODA_LA_BASE, USUARIOS  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent.parent

API = "https://cloud.mongodb.com/api/atlas/v2"
VERSION_API = "application/vnd.atlas.2023-01-01+json"

# Los nombres que la API de Atlas le da a las mismas acciones.
ACCIONES_ATLAS = {
    "find": "FIND",
    "insert": "INSERT",
    "update": "UPDATE",
    "remove": "REMOVE",
    "createCollection": "CREATE_COLLECTION",
    "collMod": "COLL_MOD",
    "createIndex": "CREATE_INDEX",
    "dropIndex": "DROP_INDEX",
    "listCollections": "LIST_COLLECTIONS",
    "listIndexes": "LIST_INDEXES",
}


def cargar_env():
    """Lee .env sin depender de paquetes extra."""
    archivo = RAIZ / ".env"
    if not archivo.exists():
        return
    for linea in archivo.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        os.environ.setdefault(clave.strip(), valor.strip().strip('"').strip("'"))


def exigir(nombre, ayuda):
    valor = os.environ.get(nombre)
    if not valor:
        print(f"Falta {nombre} en .env. {ayuda}")
        sys.exit(1)
    return valor


def base():
    return os.environ.get("MONGODB_BASE", "cetia")


# ---------------------------------------------------------------------
# Imprimir
# ---------------------------------------------------------------------


def ver():
    nombre_base = base()
    print(f"Base: {nombre_base}")
    print(f"Roles definidos: {len(ROLES)}\n")
    for rol in ROLES:
        print(f"{rol['nombre']}  -  {rol['resumen']}")
        for coleccion, acciones in rol["privilegios"].items():
            donde = "toda la base" if coleccion == TODA_LA_BASE else coleccion
            print(f"    {donde:<18} {', '.join(acciones)}")
        print()

    print("Usuarios que deben existir, cada uno con su rol:\n")
    for usuario, rol, para in USUARIOS:
        print(f"    {usuario:<26} {rol:<20} {para}")
    print("\nLas contrasenas se ponen en Atlas, en Database Access, y nunca en el repositorio.")


# ---------------------------------------------------------------------
# El MongoDB local
# ---------------------------------------------------------------------


def privilegios_mongo(rol, nombre_base):
    """La forma que pide el comando createRole del motor."""
    privilegios = []
    for coleccion, acciones in rol["privilegios"].items():
        recurso = {"db": nombre_base, "collection": "" if coleccion == TODA_LA_BASE else coleccion}
        privilegios.append({"resource": recurso, "actions": list(acciones)})
    return privilegios


def aplicar_local():
    try:
        from pymongo import MongoClient
    except ImportError:
        print("Falta pymongo. Instalalo con: pip install pymongo")
        sys.exit(1)

    # El Mongo de Docker queda en el puerto de siempre, y hay que pedirle
    # conexion directa porque el miembro del conjunto se llama mongo y ese
    # nombre solo existe dentro de la red de Docker.
    uri = os.environ.get("MONGODB_URI_LOCAL", "mongodb://localhost:27017/?directConnection=true")
    nombre_base = base()

    cliente = MongoClient(uri, serverSelectionTimeoutMS=15000)
    try:
        db = cliente[nombre_base]
        existentes = {
            r["role"] for r in db.command("rolesInfo", 1, showBuiltinRoles=False).get("roles", [])
        }

        for rol in ROLES:
            privilegios = privilegios_mongo(rol, nombre_base)
            if rol["nombre"] in existentes:
                db.command("updateRole", rol["nombre"], privileges=privilegios, roles=[])
                print(f"  actualizado  {rol['nombre']}")
            else:
                db.command("createRole", rol["nombre"], privileges=privilegios, roles=[])
                print(f"  creado       {rol['nombre']}")
    finally:
        cliente.close()

    print(f"\nLos {len(ROLES)} roles quedaron aplicados en la base {nombre_base} del Mongo local.")


# ---------------------------------------------------------------------
# Atlas, por la API de administracion
# ---------------------------------------------------------------------


def privilegios_atlas(rol, nombre_base):
    """La API de Atlas agrupa al reves: una accion con sus recursos."""
    por_accion = {}
    for coleccion, acciones in rol["privilegios"].items():
        recurso = {"db": nombre_base, "collection": "" if coleccion == TODA_LA_BASE else coleccion}
        for accion in acciones:
            if accion not in ACCIONES_ATLAS:
                raise ValueError(f"La accion {accion} no tiene nombre conocido en la API de Atlas")
            por_accion.setdefault(ACCIONES_ATLAS[accion], []).append(recurso)

    return [{"action": accion, "resources": recursos} for accion, recursos in sorted(por_accion.items())]


def llamar(opener, metodo, ruta, cuerpo=None):
    datos = json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None
    peticion = urllib.request.Request(f"{API}{ruta}", data=datos, method=metodo)
    peticion.add_header("Accept", VERSION_API)
    if datos is not None:
        peticion.add_header("Content-Type", VERSION_API)

    try:
        with opener.open(peticion, timeout=60) as respuesta:
            texto = respuesta.read().decode("utf-8")
            return json.loads(texto) if texto else None
    except urllib.error.HTTPError as error:
        detalle = error.read().decode("utf-8", "replace")
        print(f"\nLa API de Atlas respondio {error.code} a {metodo} {ruta}:\n{detalle}")
        sys.exit(1)


def aplicar_atlas():
    publica = exigir("ATLAS_PUBLIC_KEY", "Se saca en la organizacion, en Access Manager, API Keys.")
    privada = exigir("ATLAS_PRIVATE_KEY", "Es la mitad secreta de la misma llave.")
    grupo = exigir("ATLAS_GROUP_ID", "Es el identificador del proyecto, el que sale en la direccion de Atlas.")
    nombre_base = base()

    gestor = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    gestor.add_password(None, API, publica, privada)
    opener = urllib.request.build_opener(urllib.request.HTTPDigestAuthHandler(gestor))

    actuales = llamar(opener, "GET", f"/groups/{grupo}/customDBRoles/roles") or []
    existentes = {rol["roleName"] for rol in actuales}

    for rol in ROLES:
        cuerpo = {
            "roleName": rol["nombre"],
            "actions": privilegios_atlas(rol, nombre_base),
            "inheritedRoles": [],
        }
        if rol["nombre"] in existentes:
            llamar(opener, "PATCH", f"/groups/{grupo}/customDBRoles/roles/{rol['nombre']}", cuerpo)
            print(f"  actualizado  {rol['nombre']}")
        else:
            llamar(opener, "POST", f"/groups/{grupo}/customDBRoles/roles", cuerpo)
            print(f"  creado       {rol['nombre']}")

    print(f"\nLos {len(ROLES)} roles quedaron aplicados en el proyecto {grupo} de Atlas.")
    print("Falta crear los usuarios que los usan, en Database Access:")
    for usuario, rol, _ in USUARIOS:
        print(f"    {usuario:<26} {rol}")


# ---------------------------------------------------------------------


def main():
    cargar_env()

    if "--ver" in sys.argv:
        ver()
    elif "--local" in sys.argv:
        aplicar_local()
    elif "--atlas" in sys.argv:
        aplicar_atlas()
    else:
        print(__doc__ or "")
        print("Hay que decir a donde: --ver, --local o --atlas.")
        sys.exit(1)


if __name__ == "__main__":
    main()
