# =====================================================================
# CETIA - Roles personalizados de MongoDB
#
# Este archivo es la unica verdad de quien puede hacer que en la base.
# De aqui salen los roles que se crean en el MongoDB local y los que se
# crean en Atlas; no se escriben a mano en ningun lado.
#
# De donde salen
# --------------
# Del cuadro de permisos del proyecto relacional, que esta en
# proyecto_erick/docs/permisos_por_rol.md. Ahi hay cuatro roles de
# PostgreSQL (alumnado, docencia, coordinacion, administracion) con
# permisos tabla por tabla, y esos permisos se traen tal cual, solo que
# traducidos a colecciones.
#
# La traduccion no es uno a uno porque veinte tablas quedaron en doce
# colecciones. Cuando varias tablas con permisos distintos cayeron en la
# misma coleccion, el permiso de la coleccion es el mas amplio de las
# tablas que la forman, y la diferencia la impone la capa de datos. Cada
# caso esta anotado abajo, en el rol donde ocurre.
#
# Hasta donde llega un rol de MongoDB
# -----------------------------------
# Hasta la coleccion y la accion: puede decir "el alumno consulta grupos
# y no los escribe", no puede decir "el alumno consulta su grupo" ni "el
# alumno cambia su domicilio pero no su CURP". Eso, que en PostgreSQL
# hacian la seguridad por filas y los permisos por columna, sigue siendo
# trabajo de la capa de datos en Node.
#
# Entonces el rol no sustituye al filtro de la capa de datos: le pone un
# techo que el codigo no puede levantar. Si manana un error en Node deja
# pasar una escritura de un alumno sobre grupos, MongoDB la rechaza de
# todos modos, porque la conexion con la que entro ese alumno no tiene
# ese permiso.
#
# El detalle y el porque estan en docs/roles-y-permisos.md
# =====================================================================

# Las acciones que se usan, con el nombre que tienen en MongoDB. El
# aplicador las traduce al nombre en mayusculas que pide la API de Atlas.
#
#   find    consultar          createCollection  crear coleccion
#   insert  insertar           collMod           cambiar el validador
#   update  actualizar         createIndex       crear indice
#   remove  borrar             dropIndex         borrar indice
#
# "*" como nombre de coleccion significa toda la base.
TODA_LA_BASE = "*"

CATALOGOS = ("carreras", "turnos", "periodos", "aulas", "materias", "planes_estudio")

SOLO_LEER = ("find",)
TODO = ("find", "insert", "update", "remove")


def _catalogos(acciones):
    return {coleccion: list(acciones) for coleccion in CATALOGOS}


ROLES = [
    # -----------------------------------------------------------------
    # Los cuatro roles del sistema escolar
    # -----------------------------------------------------------------
    {
        "nombre": "cetia_alumno",
        "resumen": "El alumno en el portal publico",
        "privilegios": {
            **_catalogos(SOLO_LEER),
            # Lee su cuenta y su expediente, y cambia sus datos de
            # contacto. Que solo alcance su propio documento y que no
            # pueda tocar su matricula ni su CURP lo impone la capa de
            # datos: el rol solo dice que puede escribir en usuarios.
            "usuarios": ["find", "update"],
            # El horario es el de su grupo, y nunca lo escribe.
            "grupos": ["find"],
            # Solicita su reinscripcion, que nace con estatus solicitada.
            # El estatus, las fechas y quien la atendio los pone
            # administracion, no el alumno.
            "inscripciones": ["find", "insert"],
            # Solicita constancias y las consulta.
            "tramites": ["find", "insert"],
            "avisos": ["find"],
            # Escribe en la bitacora sin poder leerla ni corregirla.
            # Ver la nota sobre la bitacora al final del archivo.
            "bitacora": ["insert"],
        },
    },
    {
        "nombre": "cetia_docente",
        "resumen": "El docente en el portal publico",
        "privilegios": {
            **_catalogos(SOLO_LEER),
            # Lee a sus alumnos y cambia su propio grado, especialidad y
            # cedula.
            #
            # Aqui esta la primera perdida de la traduccion: en el modelo
            # relacional el docente no tenia ningun permiso sobre la
            # tabla documentos, y el expediente ahora vive dentro del
            # alumno, asi que el permiso de coleccion ya no lo puede
            # esconder. Lo esconde la capa de datos, que no devuelve el
            # expediente cuando quien pregunta es un docente.
            "usuarios": ["find", "update"],
            # Ve sus grupos, su horario y sus materias; no los programa.
            "grupos": ["find"],
            # Captura calificaciones, que viven dentro de la inscripcion
            # del alumno. Por eso necesita update sobre inscripciones,
            # aunque de la inscripcion solo le toque el arreglo de
            # calificaciones de su materia.
            "inscripciones": ["find", "update"],
            # Publica avisos para sus grupos y corrige o quita los suyos.
            # Que sean los suyos lo impone la capa de datos.
            "avisos": list(TODO),
            "bitacora": ["insert"],
        },
    },
    {
        "nombre": "cetia_coordinador",
        "resumen": "El coordinador en el panel administrativo",
        "privilegios": {
            **_catalogos(SOLO_LEER),
            # Consulta a la gente de su carrera y cambia telefonos.
            "usuarios": ["find", "update"],
            # Lo suyo: arma los grupos, les asigna docente y les programa
            # el horario. Las tres cosas viven en el mismo documento.
            #
            # Lo que no puede es abrir y cerrar la captura de
            # calificaciones, que en el modelo relacional era una columna
            # que no tenia permitida. Como ahora es un campo dentro del
            # grupo, quien lo impide es la capa de datos.
            "grupos": list(TODO),
            "inscripciones": ["find"],
            "tramites": ["find"],
            "avisos": list(TODO),
            # Saca el consecutivo con el que se arma la clave del grupo.
            "contadores": ["find", "update"],
            "bitacora": ["insert"],
        },
    },
    {
        "nombre": "cetia_administrador",
        "resumen": "El administrador en el panel administrativo",
        "privilegios": {
            **_catalogos(TODO),
            "usuarios": list(TODO),
            "grupos": list(TODO),
            "inscripciones": list(TODO),
            "tramites": list(TODO),
            "avisos": list(TODO),
            # Matricula, numero de docente y de coordinador.
            "contadores": ["find", "insert", "update"],
            # El unico que lee la bitacora, y nadie la corrige ni la
            # borra: no hay update ni remove para ningun rol.
            "bitacora": ["find", "insert"],
        },
    },
    # -----------------------------------------------------------------
    # Los roles de servicio: no son personas, son piezas del sistema
    # -----------------------------------------------------------------
    {
        "nombre": "cetia_acceso",
        "resumen": "La busqueda de la cuenta al iniciar sesion",
        # Cuando alguien entra todavia no se sabe que rol tiene, asi que
        # la busqueda de la cuenta por matricula, numero o correo no
        # puede hacerse con ninguno de los cuatro roles de arriba. Se
        # hace con este, que no alcanza nada mas que usuarios, y que solo
        # existe para sellar el ultimo acceso.
        "privilegios": {
            "usuarios": ["find", "update"],
            "bitacora": ["insert"],
        },
    },
    {
        "nombre": "cetia_tareas",
        "resumen": "La tarea programada que corre sola cada hora",
        # Abre y cierra la captura de calificaciones segun el calendario
        # del cuatrimestre, y apaga los avisos vencidos. Es el heredero
        # de pg_cron del proyecto relacional, y no necesita mas que esto.
        "privilegios": {
            "periodos": ["find"],
            "grupos": ["find", "update"],
            "avisos": ["find", "update"],
            "bitacora": ["insert"],
        },
    },
    {
        "nombre": "cetia_migraciones",
        "resumen": "El aplicador de migraciones",
        # Crea colecciones, cambia validadores y crea indices. Puede
        # escribir los datos base, pero no borrar nada: una migracion que
        # ya se aplico no se edita, y un error se corrige con otra
        # migracion, nunca tirando lo que hay.
        "privilegios": {
            TODA_LA_BASE: [
                "find",
                "insert",
                "update",
                "createCollection",
                "collMod",
                "createIndex",
                "dropIndex",
                "listCollections",
                "listIndexes",
            ],
        },
    },
    {
        "nombre": "cetia_auditoria",
        "resumen": "Lectura para reportes y revision, sin escribir nada",
        "privilegios": {
            TODA_LA_BASE: ["find", "listCollections", "listIndexes"],
        },
    },
]


# ---------------------------------------------------------------------
# Los usuarios de MongoDB que usan estos roles
#
# El rol no sirve solo: alguien tiene que entrar con el. La capa de datos
# en Node abre una conexion por rol y elige cual usar segun el rol que
# trae el token de la persona. Por eso son varios usuarios y no uno.
#
# Las contrasenas no estan aqui ni en ningun archivo del repositorio: se
# crean en Atlas, en Database Access, y van a parar al .env de la capa de
# datos, que no se sube a GitHub.
# ---------------------------------------------------------------------
USUARIOS = [
    ("cetia_app_alumno", "cetia_alumno", "La conexion con la que la capa de datos atiende a un alumno"),
    ("cetia_app_docente", "cetia_docente", "La conexion con la que atiende a un docente"),
    ("cetia_app_coordinador", "cetia_coordinador", "La conexion con la que atiende a un coordinador"),
    ("cetia_app_administrador", "cetia_administrador", "La conexion con la que atiende a administracion"),
    ("cetia_app_acceso", "cetia_acceso", "La conexion con la que se busca la cuenta al iniciar sesion"),
    ("cetia_app_tareas", "cetia_tareas", "La conexion de la tarea programada"),
    ("cetia_migrador", "cetia_migraciones", "La conexion con la que se aplican las migraciones"),
    ("cetia_lector", "cetia_auditoria", "La conexion de solo lectura para reportes"),
]


# ---------------------------------------------------------------------
# Nota sobre la bitacora
#
# En PostgreSQL la bitacora la llenaban disparadores que corrian como
# dueno de la tabla, asi que ningun rol necesitaba permiso de escritura
# sobre ella. En MongoDB no hay disparadores dentro de la transaccion: la
# escribe la capa de datos, con la misma conexion y en la misma
# transaccion que el cambio que esta auditando, porque si se escribiera
# con otra conexion dejaria de ser atomica.
#
# De ahi que los cuatro roles tengan insert sobre bitacora. Lo que no
# tiene ninguno es update ni remove, y leerla sigue siendo solo de
# administracion. Se puede escribir, no se puede corregir, y casi nadie
# la ve.
# ---------------------------------------------------------------------
