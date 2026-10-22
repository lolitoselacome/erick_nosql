# =====================================================================
# CETIA - Migracion de Supabase (PostgreSQL) a MongoDB Atlas
#
# Lee las veinte tablas del proyecto relacional y las escribe como doce
# colecciones de documentos. Las ocho tablas que no aparecen como
# coleccion no se pierden: se vuelven arreglos dentro del documento al
# que pertenecen.
#
#   calendario_escolar  ->  dentro de periodos
#   materia_carrera     ->  se vuelve planes_estudio, uno por carrera
#   alumnos, docentes   ->  dentro de usuarios, como perfil del rol
#   documentos          ->  dentro del perfil del alumno, como expediente
#   asignaciones        ->  dentro de grupos
#   horarios            ->  dentro de cada asignacion del grupo
#   carga_academica     ->  dentro de inscripciones
#   calificaciones      ->  dentro de cada materia de la carga
#
# Los identificadores no se regeneran: el UUID que ya tiene cada registro
# en Supabase se conserva como _id, asi que todas las relaciones siguen
# apuntando a lo mismo y no hay nada que remapear.
#
# Las dos cadenas de conexion se leen de .env y nunca se escriben aqui.
#
#   python mongodb/migrar.py              migra todo
#   python mongodb/migrar.py --revisar    solo compara los conteos
#   python mongodb/migrar.py --sin-datos  crea el modelo vacio, sin migrar
# =====================================================================

import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, time, timezone
from decimal import Decimal
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import OperationFailure

RAIZ = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------
# Configuracion
# ---------------------------------------------------------------------


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
    if not valor or valor.startswith(("mongodb+srv://USUARIO", "postgresql://USUARIO")):
        raise SystemExit(f"Falta {nombre} en .env\n  {ayuda}")
    return valor


# ---------------------------------------------------------------------
# Utilidades de conversion
#
# PostgreSQL devuelve tipos que BSON no guarda tal cual: Decimal, date
# sin hora y time. Se convierten antes de escribir.
# ---------------------------------------------------------------------


def limpiar(valor):
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, datetime):
        return valor if valor.tzinfo else valor.replace(tzinfo=timezone.utc)
    if isinstance(valor, date):
        return datetime(valor.year, valor.month, valor.day, tzinfo=timezone.utc)
    if isinstance(valor, time):
        # Las horas de clase y de turno van como texto "07:00": BSON no
        # tiene tipo hora, y asi se comparan y se ordenan igual de bien.
        return valor.strftime("%H:%M")
    if isinstance(valor, dict):
        return {k: limpiar(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [limpiar(v) for v in valor]
    return valor


def fila(registro, quitar=()):
    """Convierte una fila de PostgreSQL en un documento limpio."""
    return {k: limpiar(v) for k, v in registro.items() if k not in quitar and v is not None}


def sin_nulos(documento):
    return {k: v for k, v in documento.items() if v is not None}


# ---------------------------------------------------------------------
# El esquema: validadores e indices
#
# Los validadores son los herederos de los not null, los check y los
# tipos de PostgreSQL. Van en modo estricto porque son la unica capa que
# nada puede esquivar. Los identificadores son los UUID de Supabase, asi
# que van como texto con formato de UUID.
# ---------------------------------------------------------------------

UUID = {"bsonType": "string", "pattern": "^[0-9a-fA-F-]{36}$"}
UUID_NULO = {"bsonType": ["string", "null"], "pattern": "^([0-9a-fA-F-]{36})?$"}
HORA = {"bsonType": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"}
CUATRIMESTRE = {"bsonType": "int", "minimum": 1, "maximum": 12}

ROLES = ["administrador", "coordinador", "docente", "alumno"]
TIPOS_DOCUMENTO = [
    "acta_nacimiento", "curp", "certificado_secundaria",
    "comprobante_domicilio", "fotografias", "nss",
]
TIPOS_EVENTO = [
    "reinscripcion", "captura_parcial_1", "captura_parcial_2",
    "captura_parcial_3", "captura_final", "extraordinario",
]
TIPOS_CALIFICACION = ["parcial_1", "parcial_2", "parcial_3", "final", "extraordinario"]
TIPOS_TRAMITE = [
    "constancia_estudios", "constancia_calificaciones", "kardex",
    "historial_academico", "credencial", "carta_pasante",
]


def objeto(requeridos, propiedades, extra=True):
    esquema = {"bsonType": "object", "properties": propiedades}
    if requeridos:
        esquema["required"] = requeridos
    if not extra:
        esquema["additionalProperties"] = False
    return esquema


ESQUEMA = {
    "carreras": objeto(
        ["clave", "nombre", "activa"],
        {
            "_id": UUID,
            "clave": {"bsonType": "string"},
            "clave_matricula": {"bsonType": "string", "pattern": "^[1-8][0-9]$"},
            "nombre": {"bsonType": "string"},
            "activa": {"bsonType": "bool"},
        },
    ),
    "turnos": objeto(
        ["nombre", "hora_inicio", "hora_fin"],
        {"_id": UUID, "nombre": {"bsonType": "string"}, "hora_inicio": HORA, "hora_fin": HORA},
    ),
    # El calendario escolar vive dentro de su cuatrimestre: nunca se
    # consulta sin el, y asi saber si la captura esta abierta es leer un
    # solo documento.
    "periodos": objeto(
        ["clave", "nombre", "fecha_inicio", "fecha_fin", "actual"],
        {
            "_id": UUID,
            "clave": {"bsonType": "string"},
            "nombre": {"bsonType": "string"},
            "anio": {"bsonType": "int", "minimum": 2000, "maximum": 2099},
            "numero": {"bsonType": "int", "minimum": 1, "maximum": 3},
            "fecha_inicio": {"bsonType": "date"},
            "fecha_fin": {"bsonType": "date"},
            "actual": {"bsonType": "bool"},
            "calendario": {
                "bsonType": "array",
                "items": objeto(
                    ["_id", "tipo_evento", "fecha_inicio", "fecha_fin", "activo"],
                    {
                        "_id": UUID,
                        "tipo_evento": {"enum": TIPOS_EVENTO},
                        "descripcion": {"bsonType": ["string", "null"]},
                        "fecha_inicio": {"bsonType": "date"},
                        "fecha_fin": {"bsonType": "date"},
                        "activo": {"bsonType": "bool"},
                    },
                ),
            },
        },
    ),
    "aulas": objeto(
        ["clave", "nombre", "tipo", "capacidad", "activa"],
        {
            "_id": UUID,
            "clave": {"bsonType": "string"},
            "nombre": {"bsonType": "string"},
            "tipo": {"enum": ["aula", "laboratorio", "taller"]},
            "capacidad": {"bsonType": "int", "minimum": 1},
            "activa": {"bsonType": "bool"},
        },
    ),
    "materias": objeto(
        ["clave", "nombre", "creditos", "horas_semana", "activa"],
        {
            "_id": UUID,
            "clave": {"bsonType": "string"},
            "nombre": {"bsonType": "string"},
            "creditos": {"bsonType": "number", "minimum": 0},
            "horas_semana": {"bsonType": "int", "minimum": 1},
            "activa": {"bsonType": "bool"},
        },
    ),
    # materia_carrera deja de ser tabla intermedia: un documento por
    # carrera con su lista completa de materias. Asi revisar el egreso es
    # leer un documento en vez de una junta de tres tablas.
    "planes_estudio": objeto(
        ["id_carrera", "materias"],
        {
            "_id": UUID,
            "id_carrera": UUID,
            "clave_carrera": {"bsonType": "string"},
            "materias": {
                "bsonType": "array",
                "items": objeto(
                    ["id_materia", "clave", "nombre", "cuatrimestre"],
                    {
                        "id_materia": UUID,
                        "clave": {"bsonType": "string"},
                        "nombre": {"bsonType": "string"},
                        "cuatrimestre": CUATRIMESTRE,
                        "id_materia_requisito": UUID_NULO,
                    },
                ),
            },
        },
    ),
    # usuarios, alumnos y docentes en una sola coleccion: la relacion es
    # uno a uno y cada peticion necesita saber quien es la persona y que
    # rol tiene, asi que juntarlas quita una junta de todas.
    "usuarios": objeto(
        ["rol", "nombre", "apellido_paterno", "correo", "activo"],
        {
            "_id": UUID,
            "rol": {"enum": ROLES},
            "nombre": {"bsonType": "string"},
            "apellido_paterno": {"bsonType": "string"},
            "apellido_materno": {"bsonType": ["string", "null"]},
            "correo": {"bsonType": "string"},
            "telefono": {"bsonType": ["string", "null"]},
            "id_carrera": UUID_NULO,
            "numero_coordinador": {"bsonType": ["string", "null"]},
            "activo": {"bsonType": "bool"},
            "ultimo_acceso": {"bsonType": ["date", "null"]},
            "fecha_creacion": {"bsonType": ["date", "null"]},
            "perfil_alumno": objeto(
                ["matricula", "curp", "sexo", "estatus", "expediente"],
                {
                    "id_alumno": UUID,
                    "matricula": {"bsonType": "string", "pattern": "^[1-8][0-9]{9}$"},
                    "curp": {"bsonType": "string", "minLength": 18, "maxLength": 18},
                    "sexo": {"enum": ["H", "M"]},
                    "fecha_nacimiento": {"bsonType": ["date", "null"]},
                    "telefono_casa": {"bsonType": ["string", "null"]},
                    "foto_url": {"bsonType": ["string", "null"]},
                    "carrera": {"bsonType": "object"},
                    "turno": {"bsonType": "object"},
                    "cuatrimestre_actual": CUATRIMESTRE,
                    "id_periodo_ingreso": UUID_NULO,
                    "fecha_ingreso": {"bsonType": ["date", "null"]},
                    "estatus": {
                        "enum": ["activo", "baja_temporal", "baja_definitiva", "egresado"]
                    },
                    "domicilio": {"bsonType": "object"},
                    "secundaria": {"bsonType": "object"},
                    "tutor": {"bsonType": "object"},
                    # Seis tipos exactos, uno por tipo: la unicidad la
                    # impone el arreglo, ya no un indice.
                    "expediente": {
                        "bsonType": "array",
                        "maxItems": 6,
                        "items": objeto(
                            ["tipo", "estatus"],
                            {
                                "_id": UUID,
                                "tipo": {"enum": TIPOS_DOCUMENTO},
                                "estatus": {
                                    "enum": ["pendiente", "recibido", "validado", "rechazado"]
                                },
                                "fecha_recepcion": {"bsonType": ["date", "null"]},
                                "observaciones": {"bsonType": ["string", "null"]},
                                "recibido_por": UUID_NULO,
                            },
                        ),
                    },
                },
            ),
            "perfil_docente": objeto(
                ["numero_empleado"],
                {
                    "id_docente": UUID,
                    "numero_empleado": {"bsonType": "string", "pattern": "^[0-9]{8}$"},
                    "curp": {"bsonType": ["string", "null"]},
                    "rfc": {"bsonType": ["string", "null"]},
                    "grado_academico": {"bsonType": ["string", "null"]},
                    "especialidad": {"bsonType": ["string", "null"]},
                    "cedula_profesional": {"bsonType": ["string", "null"]},
                    "tipo_contrato": {"bsonType": ["string", "null"]},
                    "fecha_ingreso": {"bsonType": ["date", "null"]},
                    "activo": {"bsonType": "bool"},
                },
            ),
        },
    ),
    # El grupo se lleva sus materias y el horario de cada una: es la
    # unidad de lectura de coordinacion y del horario del alumno, y crear
    # un grupo con sus materias deja de necesitar transaccion.
    "grupos": objeto(
        ["clave", "id_carrera", "id_turno", "id_periodo", "cuatrimestre", "cupo", "activo"],
        {
            "_id": UUID,
            "clave": {"bsonType": "string"},
            "id_carrera": UUID,
            "id_turno": UUID,
            "id_periodo": UUID,
            "carrera": {"bsonType": "object"},
            "turno": {"bsonType": "object"},
            "cuatrimestre": CUATRIMESTRE,
            "cupo": {"bsonType": "int", "minimum": 1},
            "activo": {"bsonType": "bool"},
            "asignaciones": {
                "bsonType": "array",
                "items": objeto(
                    ["_id", "id_materia", "estatus_captura"],
                    {
                        "_id": UUID,
                        "id_materia": UUID,
                        "materia": {"bsonType": "object"},
                        "id_docente": UUID_NULO,
                        "estatus_captura": {"enum": ["abierta", "cerrada"]},
                        "captura_manual": {"bsonType": "bool"},
                        "horarios": {
                            "bsonType": "array",
                            "items": objeto(
                                ["_id", "id_aula", "dia_semana", "hora_inicio", "hora_fin"],
                                {
                                    "_id": UUID,
                                    "id_aula": UUID,
                                    # 1 = lunes ... 6 = sabado
                                    "dia_semana": {"bsonType": "int", "minimum": 1, "maximum": 6},
                                    "hora_inicio": HORA,
                                    "hora_fin": HORA,
                                },
                            ),
                        },
                    },
                ),
            },
        },
    ),
    # Un documento es un alumno en un cuatrimestre, con sus materias y
    # las calificaciones de cada una. Es lo que mas logica elimina:
    # promediar parciales y dar de baja la carga quedan en un documento.
    "inscripciones": objeto(
        ["id_alumno", "id_periodo", "id_grupo", "cuatrimestre", "tipo", "estatus"],
        {
            "_id": UUID,
            "id_alumno": UUID,
            "id_periodo": UUID,
            "id_grupo": UUID,
            "cuatrimestre": CUATRIMESTRE,
            "tipo": {"enum": ["nuevo_ingreso", "reinscripcion"]},
            "estatus": {"enum": ["solicitada", "aprobada", "rechazada", "cancelada", "baja"]},
            "fecha_solicitud": {"bsonType": ["date", "null"]},
            "fecha_inscripcion": {"bsonType": ["date", "null"]},
            "atendida_por": UUID_NULO,
            "observaciones": {"bsonType": ["string", "null"]},
            "carga": {
                "bsonType": "array",
                "items": objeto(
                    ["_id", "id_asignacion", "tipo_curso", "estatus"],
                    {
                        "_id": UUID,
                        "id_asignacion": UUID,
                        "materia": {"bsonType": "object"},
                        "tipo_curso": {"enum": ["normal", "recursamiento"]},
                        "estatus": {"enum": ["cursando", "aprobada", "reprobada", "baja"]},
                        "calificaciones": {
                            "bsonType": "array",
                            "maxItems": 5,
                            "items": objeto(
                                ["tipo", "calificacion"],
                                {
                                    "_id": UUID,
                                    "tipo": {"enum": TIPOS_CALIFICACION},
                                    "calificacion": {
                                        "bsonType": "number", "minimum": 0, "maximum": 10
                                    },
                                    "fecha_captura": {"bsonType": ["date", "null"]},
                                    "capturada_por": UUID_NULO,
                                },
                            ),
                        },
                    },
                ),
            },
        },
    ),
    "tramites": objeto(
        ["id_alumno", "tipo", "estatus"],
        {
            "_id": UUID,
            "id_alumno": UUID,
            "tipo": {"enum": TIPOS_TRAMITE},
            "motivo": {"bsonType": ["string", "null"]},
            "estatus": {"enum": ["solicitado", "en_proceso", "listo", "entregado", "rechazado"]},
            "observaciones": {"bsonType": ["string", "null"]},
            "fecha_solicitud": {"bsonType": ["date", "null"]},
            "fecha_resolucion": {"bsonType": ["date", "null"]},
            "atendido_por": UUID_NULO,
        },
    ),
    "avisos": objeto(
        ["titulo", "contenido", "publicado_por", "activo"],
        {
            "_id": UUID,
            "titulo": {"bsonType": "string"},
            "contenido": {"bsonType": "string"},
            "rol_destino": {"bsonType": ["string", "null"]},
            "id_grupo": UUID_NULO,
            "publicado_por": UUID,
            "fecha_publicacion": {"bsonType": ["date", "null"]},
            "fecha_expiracion": {"bsonType": ["date", "null"]},
            "activo": {"bsonType": "bool"},
        },
    ),
    "bitacora": objeto(
        ["accion", "tabla_afectada"],
        {
            "_id": UUID,
            "id_usuario": UUID_NULO,
            "accion": {"enum": ["INSERT", "UPDATE", "DELETE"]},
            "tabla_afectada": {"bsonType": "string"},
            "id_registro": UUID_NULO,
            "datos_anteriores": {"bsonType": ["object", "null"]},
            "datos_nuevos": {"bsonType": ["object", "null"]},
            "fecha_hora": {"bsonType": ["date", "null"]},
        },
    ),
    # MongoDB no tiene secuencias: de aqui saca la capa de datos los
    # consecutivos de la matricula, el numero de docente y la clave de grupo.
    "contadores": objeto(
        ["valor"], {"_id": {"bsonType": "string"}, "valor": {"bsonType": "int", "minimum": 0}}
    ),
}

INDICES = {
    "carreras": [(("clave", ASCENDING),), (("nombre", ASCENDING),)],
    "turnos": [(("nombre", ASCENDING),)],
    "periodos": [(("clave", ASCENDING),)],
    "aulas": [(("clave", ASCENDING),)],
    "materias": [(("clave", ASCENDING),)],
    "planes_estudio": [(("id_carrera", ASCENDING),)],
    "usuarios": [
        (("correo", ASCENDING),),
        (("rol", ASCENDING), ("activo", ASCENDING)),
        (("perfil_alumno.matricula", ASCENDING),),
        (("perfil_docente.numero_empleado", ASCENDING),),
        (("perfil_alumno.carrera._id", ASCENDING), ("perfil_alumno.turno._id", ASCENDING)),
    ],
    "grupos": [
        (("id_periodo", ASCENDING), ("id_carrera", ASCENDING), ("cuatrimestre", ASCENDING)),
        (("asignaciones.id_docente", ASCENDING),),
        (("asignaciones._id", ASCENDING),),
        (("asignaciones.horarios.id_aula", ASCENDING),),
    ],
    "inscripciones": [
        (("id_alumno", ASCENDING), ("id_periodo", ASCENDING)),
        (("id_grupo", ASCENDING),),
        (("carga.id_asignacion", ASCENDING),),
    ],
    "tramites": [(("estatus", ASCENDING),), (("id_alumno", ASCENDING),)],
    "avisos": [(("rol_destino", ASCENDING), ("activo", ASCENDING)), (("id_grupo", ASCENDING),)],
    "bitacora": [(("id_usuario", ASCENDING), ("fecha_hora", DESCENDING)),
                 (("tabla_afectada", ASCENDING), ("fecha_hora", DESCENDING))],
}

# Indices unicos: los herederos directos de las restricciones unique.
UNICOS = {
    ("carreras", "clave_1"),
    ("carreras", "nombre_1"),
    ("turnos", "nombre_1"),
    ("periodos", "clave_1"),
    ("aulas", "clave_1"),
    ("materias", "clave_1"),
    ("planes_estudio", "id_carrera_1"),
    ("usuarios", "correo_1"),
    ("usuarios", "perfil_alumno.matricula_1"),
    ("usuarios", "perfil_docente.numero_empleado_1"),
    ("inscripciones", "id_alumno_1_id_periodo_1"),
}

# Indices unicos que solo valen para parte de la coleccion.
#
# La matricula solo existe en el perfil del alumno y el numero de
# empleado solo en el del docente. Sin este filtro, MongoDB trata como
# duplicados todos los documentos donde el campo no esta, y el indice
# no se puede crear: 493 usuarios sin perfil de docente son 493 nulos
# repetidos.
PARCIALES = {
    ("usuarios", "perfil_alumno.matricula_1"): {"perfil_alumno.matricula": {"$exists": True}},
    ("usuarios", "perfil_docente.numero_empleado_1"): {
        "perfil_docente.numero_empleado": {"$exists": True}
    },
}

TABLAS = [
    "carreras", "turnos", "periodos", "calendario_escolar", "aulas", "materias",
    "materia_carrera", "usuarios", "alumnos", "docentes", "documentos", "grupos",
    "asignaciones", "horarios", "inscripciones", "carga_academica", "calificaciones",
    "tramites", "avisos", "bitacora",
]


# ---------------------------------------------------------------------
# Lectura de Supabase
# ---------------------------------------------------------------------


def leer_supabase(uri):
    datos = {}
    with psycopg.connect(uri, row_factory=dict_row) as conexion:
        with conexion.cursor() as cur:
            for tabla in TABLAS:
                cur.execute(f'select * from public."{tabla}"')
                datos[tabla] = cur.fetchall()
                print(f"  {tabla:<20} {len(datos[tabla]):>6} filas")
    return datos


# --- Lectura por la API REST -----------------------------------------
#
# Alternativa a conectarse a PostgreSQL: con la llave de servicio se lee
# todo por HTTP, sin necesitar la contrasena de la base. La API devuelve
# JSON, asi que las fechas y las horas llegan como texto y hay que
# volverlas al tipo que les toca antes de escribirlas en MongoDB.

FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MARCA_TIEMPO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
HORA_TEXTO = re.compile(r"^\d{2}:\d{2}(:\d{2})?$")


def desde_json(valor):
    if isinstance(valor, str):
        if MARCA_TIEMPO.match(valor):
            texto = valor.replace("Z", "+00:00")
            try:
                d = datetime.fromisoformat(texto)
                return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
            except ValueError:
                return valor
        if FECHA.match(valor):
            a, m, d = (int(x) for x in valor.split("-"))
            return datetime(a, m, d, tzinfo=timezone.utc)
        if HORA_TEXTO.match(valor):
            # Las horas van como "07:00": BSON no tiene tipo hora.
            return valor[:5]
        return valor
    if isinstance(valor, dict):
        return {k: desde_json(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [desde_json(v) for v in valor]
    return valor


def leer_supabase_rest(url, llave):
    cabeceras = {
        "apikey": llave,
        "Authorization": f"Bearer {llave}",
        "Accept": "application/json",
    }
    datos = {}
    for tabla in TABLAS:
        filas, desde, paso = [], 0, 1000
        while True:
            # La API entrega como mucho mil filas por llamada, asi que se
            # pide por tramos hasta que ya no devuelve nada.
            peticion = urllib.request.Request(
                f"{url}/rest/v1/{tabla}?select=*",
                headers={**cabeceras, "Range": f"{desde}-{desde + paso - 1}"},
            )
            with urllib.request.urlopen(peticion, timeout=60) as respuesta:
                tramo = json.loads(respuesta.read())
            filas.extend(tramo)
            if len(tramo) < paso:
                break
            desde += paso
        datos[tabla] = [desde_json(f) for f in filas]
        print(f"  {tabla:<20} {len(datos[tabla]):>6} filas")
    return datos


# ---------------------------------------------------------------------
# Transformacion: de tablas a documentos
# ---------------------------------------------------------------------


def agrupar(filas, clave):
    salida = {}
    for f in filas:
        salida.setdefault(f[clave], []).append(f)
    return salida


def construir(datos):
    col = {}

    # --- Catalogos que pasan tal cual ---
    col["carreras"] = [
        {**fila(c, {"id_carrera"}), "_id": str(c["id_carrera"])} for c in datos["carreras"]
    ]
    col["turnos"] = [
        {**fila(t, {"id_turno"}), "_id": str(t["id_turno"])} for t in datos["turnos"]
    ]
    col["aulas"] = [
        {**fila(a, {"id_aula"}), "_id": str(a["id_aula"])} for a in datos["aulas"]
    ]
    col["materias"] = [
        {**fila(m, {"id_materia"}), "_id": str(m["id_materia"])} for m in datos["materias"]
    ]

    # --- periodos se lleva dentro su calendario escolar ---
    eventos = agrupar(datos["calendario_escolar"], "id_periodo")
    col["periodos"] = []
    for p in datos["periodos"]:
        doc = {**fila(p, {"id_periodo"}), "_id": str(p["id_periodo"])}
        doc["calendario"] = [
            {**fila(e, {"id_evento", "id_periodo"}), "_id": str(e["id_evento"])}
            for e in eventos.get(p["id_periodo"], [])
        ]
        col["periodos"].append(doc)

    # --- materia_carrera se vuelve un plan por carrera ---
    materias = {m["id_materia"]: m for m in datos["materias"]}
    por_carrera = agrupar(datos["materia_carrera"], "id_carrera")
    col["planes_estudio"] = []
    for c in datos["carreras"]:
        lista = []
        for mc in por_carrera.get(c["id_carrera"], []):
            m = materias.get(mc["id_materia"])
            if not m:
                continue
            lista.append(
                sin_nulos({
                    "id_materia": str(m["id_materia"]),
                    "clave": m["clave"],
                    "nombre": m["nombre"],
                    "cuatrimestre": mc["cuatrimestre"],
                    "id_materia_requisito": (
                        str(mc["id_materia_requisito"]) if mc["id_materia_requisito"] else None
                    ),
                })
            )
        lista.sort(key=lambda x: (x["cuatrimestre"], x["clave"]))
        col["planes_estudio"].append({
            "_id": str(c["id_carrera"]),
            "id_carrera": str(c["id_carrera"]),
            "clave_carrera": c["clave"],
            "materias": lista,
        })

    # --- usuarios se lleva dentro el perfil del rol y el expediente ---
    carreras = {c["id_carrera"]: c for c in datos["carreras"]}
    turnos = {t["id_turno"]: t for t in datos["turnos"]}
    alumnos = {a["id_usuario"]: a for a in datos["alumnos"]}
    docentes = {d["id_usuario"]: d for d in datos["docentes"]}
    expedientes = agrupar(datos["documentos"], "id_alumno")

    col["usuarios"] = []
    for u in datos["usuarios"]:
        doc = {**fila(u, {"id_usuario"}), "_id": str(u["id_usuario"])}
        if u.get("id_carrera"):
            doc["id_carrera"] = str(u["id_carrera"])

        a = alumnos.get(u["id_usuario"])
        if a:
            ca, tu = carreras.get(a["id_carrera"]), turnos.get(a["id_turno"])
            perfil = fila(a, {
                "id_alumno", "id_usuario", "id_carrera", "id_turno",
                "calle", "numero_exterior", "colonia", "codigo_postal", "municipio", "estado",
                "escuela_procedencia", "promedio_secundaria",
                "tutor_nombre", "tutor_parentesco", "tutor_telefono",
                "id_periodo_ingreso",
            })
            perfil["id_alumno"] = str(a["id_alumno"])
            if a.get("id_periodo_ingreso"):
                perfil["id_periodo_ingreso"] = str(a["id_periodo_ingreso"])
            if ca:
                perfil["carrera"] = {
                    "_id": str(ca["id_carrera"]), "clave": ca["clave"], "nombre": ca["nombre"]
                }
            if tu:
                perfil["turno"] = {
                    "_id": str(tu["id_turno"]), "nombre": tu["nombre"],
                    "hora_inicio": limpiar(tu["hora_inicio"]), "hora_fin": limpiar(tu["hora_fin"]),
                }
            domicilio = sin_nulos({
                k: a.get(k) for k in
                ("calle", "numero_exterior", "colonia", "codigo_postal", "municipio", "estado")
            })
            if domicilio:
                perfil["domicilio"] = domicilio
            secundaria = sin_nulos({
                "escuela_procedencia": a.get("escuela_procedencia"),
                "promedio": limpiar(a.get("promedio_secundaria")),
            })
            if secundaria:
                perfil["secundaria"] = secundaria
            tutor = sin_nulos({
                "nombre": a.get("tutor_nombre"),
                "parentesco": a.get("tutor_parentesco"),
                "telefono": a.get("tutor_telefono"),
            })
            if tutor:
                perfil["tutor"] = tutor
            # En PostgreSQL la columna se llama tipo_documento; dentro del
            # expediente ya no hace falta repetir "documento", asi que va
            # como tipo.
            perfil["expediente"] = [
                {
                    **fila(d, {"id_documento", "id_alumno", "recibido_por", "tipo_documento"}),
                    "_id": str(d["id_documento"]),
                    "tipo": d["tipo_documento"],
                    **({"recibido_por": str(d["recibido_por"])} if d.get("recibido_por") else {}),
                }
                for d in expedientes.get(a["id_alumno"], [])
            ]
            doc["perfil_alumno"] = perfil

        d = docentes.get(u["id_usuario"])
        if d:
            perfil = fila(d, {"id_docente", "id_usuario"})
            perfil["id_docente"] = str(d["id_docente"])
            doc["perfil_docente"] = perfil

        col["usuarios"].append(doc)

    # --- grupos se lleva sus asignaciones y el horario de cada una ---
    horarios = agrupar(datos["horarios"], "id_asignacion")
    asignaciones = agrupar(datos["asignaciones"], "id_grupo")
    col["grupos"] = []
    for g in datos["grupos"]:
        doc = {**fila(g, {"id_grupo"}), "_id": str(g["id_grupo"])}
        doc["id_carrera"] = str(g["id_carrera"])
        doc["id_turno"] = str(g["id_turno"])
        doc["id_periodo"] = str(g["id_periodo"])
        ca, tu = carreras.get(g["id_carrera"]), turnos.get(g["id_turno"])
        if ca:
            doc["carrera"] = {
                "_id": str(ca["id_carrera"]), "clave": ca["clave"], "nombre": ca["nombre"]
            }
        if tu:
            doc["turno"] = {
                "_id": str(tu["id_turno"]), "nombre": tu["nombre"],
                "hora_inicio": limpiar(tu["hora_inicio"]), "hora_fin": limpiar(tu["hora_fin"]),
            }
        lista = []
        for a in asignaciones.get(g["id_grupo"], []):
            sub = {**fila(a, {"id_asignacion", "id_grupo", "id_materia", "id_docente"}),
                   "_id": str(a["id_asignacion"]), "id_materia": str(a["id_materia"])}
            if a.get("id_docente"):
                sub["id_docente"] = str(a["id_docente"])
            m = materias.get(a["id_materia"])
            if m:
                sub["materia"] = {
                    "_id": str(m["id_materia"]), "clave": m["clave"],
                    "nombre": m["nombre"], "horas_semana": m["horas_semana"],
                }
            sub["horarios"] = [
                {**fila(h, {"id_horario", "id_asignacion", "id_aula"}),
                 "_id": str(h["id_horario"]), "id_aula": str(h["id_aula"])}
                for h in horarios.get(a["id_asignacion"], [])
            ]
            lista.append(sub)
        doc["asignaciones"] = lista
        col["grupos"].append(doc)

    # --- inscripciones se lleva su carga y las calificaciones ---
    asig_materia = {a["id_asignacion"]: a["id_materia"] for a in datos["asignaciones"]}
    califs = agrupar(datos["calificaciones"], "id_carga")
    cargas = agrupar(datos["carga_academica"], "id_inscripcion")
    col["inscripciones"] = []
    for i in datos["inscripciones"]:
        doc = {**fila(i, {"id_inscripcion", "id_alumno", "id_periodo", "id_grupo", "atendida_por"}),
               "_id": str(i["id_inscripcion"]), "id_alumno": str(i["id_alumno"]),
               "id_periodo": str(i["id_periodo"]), "id_grupo": str(i["id_grupo"])}
        if i.get("atendida_por"):
            doc["atendida_por"] = str(i["atendida_por"])
        lista = []
        for c in cargas.get(i["id_inscripcion"], []):
            sub = {**fila(c, {"id_carga", "id_inscripcion", "id_asignacion"}),
                   "_id": str(c["id_carga"]), "id_asignacion": str(c["id_asignacion"])}
            m = materias.get(asig_materia.get(c["id_asignacion"]))
            if m:
                sub["materia"] = {
                    "_id": str(m["id_materia"]), "clave": m["clave"], "nombre": m["nombre"]
                }
            sub["calificaciones"] = [
                {**fila(k, {"id_calificacion", "id_carga", "capturada_por"}),
                 "_id": str(k["id_calificacion"]),
                 **({"capturada_por": str(k["capturada_por"])} if k.get("capturada_por") else {})}
                for k in califs.get(c["id_carga"], [])
            ]
            lista.append(sub)
        doc["carga"] = lista
        col["inscripciones"].append(doc)

    # --- Las que se quedan sueltas ---
    col["tramites"] = [
        {**fila(t, {"id_tramite"}), "_id": str(t["id_tramite"])} for t in datos["tramites"]
    ]
    col["avisos"] = [
        {**fila(a, {"id_aviso"}), "_id": str(a["id_aviso"])} for a in datos["avisos"]
    ]
    col["bitacora"] = [
        {**fila(b, {"id_bitacora"}), "_id": str(b["id_bitacora"])} for b in datos["bitacora"]
    ]

    return col


# ---------------------------------------------------------------------
# Escritura en MongoDB
# ---------------------------------------------------------------------


def crear_modelo(db):
    existentes = set(db.list_collection_names())
    for nombre, esquema in ESQUEMA.items():
        opciones = {
            "validator": {"$jsonSchema": esquema},
            "validationLevel": "strict",
            "validationAction": "error",
        }
        if nombre in existentes:
            db.command({"collMod": nombre, **opciones})
        else:
            db.create_collection(nombre, **opciones)
    print(f"  {len(ESQUEMA)} colecciones con su validador")


def crear_indices(db):
    total = 0
    for coleccion, llaves in INDICES.items():
        for llave in llaves:
            nombre = "_".join(f"{c}_{1 if d == ASCENDING else -1}" for c, d in llave)
            es_unico = (coleccion, nombre) in UNICOS
            opciones = {"name": nombre, "unique": es_unico}
            filtro = PARCIALES.get((coleccion, nombre))
            if filtro:
                opciones["partialFilterExpression"] = filtro
            try:
                db[coleccion].create_index(list(llave), **opciones)
            except OperationFailure as error:
                # Si ya existe uno con el mismo nombre pero distinta
                # definicion, se rehace. Pasa al cambiar un indice de
                # normal a parcial.
                if error.code != 86:
                    raise
                db[coleccion].drop_index(nombre)
                db[coleccion].create_index(list(llave), **opciones)
            total += 1
    print(f"  {total} indices")


def escribir(db, col):
    for nombre, documentos in col.items():
        db[nombre].delete_many({})
        if documentos:
            # En lotes, porque bitacora trae miles de documentos.
            for i in range(0, len(documentos), 500):
                db[nombre].insert_many(documentos[i:i + 500], ordered=False)
        print(f"  {nombre:<20} {len(documentos):>6} documentos")


def comprobar_embebidos(datos, col):
    """Comprueba que lo que se metio dentro de otro documento esta completo.

    Es la parte que mas facil se rompe: si una tabla se embebe mal, no
    falla nada, simplemente faltan datos. Por eso se cuenta uno por uno.
    """
    print("\nLo que quedo embebido")
    print(f"  {'tabla':<20} {'en supabase':>12} {'embebidos':>10}")
    problemas = 0
    comprobaciones = [
        ("calendario_escolar", len(datos["calendario_escolar"]),
         sum(len(p.get("calendario", [])) for p in col["periodos"])),
        ("materia_carrera", len(datos["materia_carrera"]),
         sum(len(p["materias"]) for p in col["planes_estudio"])),
        ("alumnos", len(datos["alumnos"]),
         sum(1 for u in col["usuarios"] if "perfil_alumno" in u)),
        ("docentes", len(datos["docentes"]),
         sum(1 for u in col["usuarios"] if "perfil_docente" in u)),
        ("documentos", len(datos["documentos"]),
         sum(len(u.get("perfil_alumno", {}).get("expediente", [])) for u in col["usuarios"])),
        ("asignaciones", len(datos["asignaciones"]),
         sum(len(g.get("asignaciones", [])) for g in col["grupos"])),
        ("horarios", len(datos["horarios"]),
         sum(len(a.get("horarios", [])) for g in col["grupos"] for a in g.get("asignaciones", []))),
        ("carga_academica", len(datos["carga_academica"]),
         sum(len(i.get("carga", [])) for i in col["inscripciones"])),
        ("calificaciones", len(datos["calificaciones"]),
         sum(len(c.get("calificaciones", [])) for i in col["inscripciones"]
             for c in i.get("carga", []))),
    ]
    for tabla, esperado, real in comprobaciones:
        marca = "ok" if esperado == real else "NO COINCIDE"
        if esperado != real:
            problemas += 1
        print(f"  {tabla:<20} {esperado:>12} {real:>10}  {marca}")

    if problemas:
        print(f"\n  {problemas} diferencias en lo embebido.")
    else:
        print("\n  Todo lo embebido cuadra.")
    return problemas


def revisar(db, datos, col):
    print("\nRevision: lo armado contra lo que quedo en MongoDB")
    print(f"  {'coleccion':<20} {'armado':>9} {'en mongo':>9}")
    problemas = 0
    for nombre in col:
        esperado = len(col[nombre])
        real = db[nombre].count_documents({})
        marca = "ok" if esperado == real else "NO COINCIDE"
        if esperado != real:
            problemas += 1
        print(f"  {nombre:<20} {esperado:>9} {real:>9}  {marca}")

    return problemas + comprobar_embebidos(datos, col)


# ---------------------------------------------------------------------


def obtener_datos():
    """Lee Supabase: por la API REST si hay llave, si no por PostgreSQL."""
    url = os.environ.get("SUPABASE_URL")
    llave = os.environ.get("SUPABASE_SECRET_KEY")
    if url and llave and not llave.startswith("eyJ...") :
        print("\nLeyendo Supabase por la API REST")
        return leer_supabase_rest(url.rstrip("/"), llave)

    pg_uri = exigir(
        "SUPABASE_DB_URI",
        "Se saca del proyecto en Supabase, en Connect, Direct connection. "
        "O pon SUPABASE_URL y SUPABASE_SECRET_KEY para leer por la API REST.",
    )
    print("\nLeyendo Supabase por PostgreSQL")
    return leer_supabase(pg_uri)


def resumen(col):
    for nombre, documentos in col.items():
        print(f"  {nombre:<20} {len(documentos):>6} documentos")


def main():
    cargar_env()
    solo_revisar = "--revisar" in sys.argv
    sin_datos = "--sin-datos" in sys.argv
    solo_armar = "--solo-armar" in sys.argv

    # Modo de prueba: lee Supabase y arma los documentos sin tocar Atlas.
    # Sirve para comprobar la transformacion sin conexion a MongoDB.
    if solo_armar:
        datos = obtener_datos()
        print("\nArmando los documentos")
        col = construir(datos)
        resumen(col)
        comprobar_embebidos(datos, col)
        return

    mongo_uri = exigir(
        "MONGODB_URI",
        "Se saca del cluster en Atlas, en Connect, Drivers.",
    )
    base = os.environ.get("MONGODB_BASE", "cetia")

    cliente = MongoClient(mongo_uri, serverSelectionTimeoutMS=20000)
    cliente.admin.command("ping")
    db = cliente[base]
    print(f"Conectado a MongoDB Atlas, base {base}")

    if sin_datos:
        print("\nCreando el modelo vacio")
        crear_modelo(db)
        crear_indices(db)
        print("\nListo: el modelo esta creado, sin datos.")
        return

    datos = obtener_datos()

    print("\nArmando los documentos")
    col = construir(datos)
    resumen(col)

    if not solo_revisar:
        print("\nCreando el modelo en Atlas")
        crear_modelo(db)
        print("\nEscribiendo los documentos")
        escribir(db, col)
        print("\nCreando los indices")
        crear_indices(db)

    problemas = revisar(db, datos, col)
    print()
    if problemas:
        print(f"Terminado con {problemas} diferencias. Revisa las marcadas arriba.")
        sys.exit(1)
    print("Terminado: todo coincide.")


if __name__ == "__main__":
    main()
