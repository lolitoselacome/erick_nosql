# =====================================================================
# CETIA NoSQL - Diagramas del modelo de documentos
#
# Genera los diagramas en SVG, con el mismo formato que los del proyecto
# relacional: colores del logo, Orbitron en los titulos y Arial en el
# texto, para que los dos juegos de diagramas se vean del mismo sistema.
#
# Produce tres cosas:
#   colecciones-1.svg  las colecciones del plantel y de las personas
#   colecciones-2.svg  la oferta del cuatrimestre y la trayectoria
#   comparacion.svg    las veinte tablas contra las doce colecciones,
#                      con una linea por cada tabla que se embebio
#
#   python docs/diagramas/generar_diagramas_bd.py
# =====================================================================

from pathlib import Path

AZUL = "#123b7a"
AZUL_OSCURO = "#0b2a5b"
AZUL_SUAVE = "#e8eef7"
VERDE = "#2f9e5b"
VERDE_SUAVE = "#e7f5ed"
GRIS = "#475569"
BORDE = "#cfd8e6"
BLANCO = "#ffffff"

TITULO = 'font-family="Orbitron, Arial, sans-serif"'
TEXTO = 'font-family="Arial, Helvetica, sans-serif"'

ANCHO = 1000
ANCHO_CAJA = 440
ALTO_TITULO = 34
ALTO_LINEA = 20
MARGEN_X = 40
SEPARACION_X = 40
SEPARACION_Y = 26
INICIO_Y = 132

# Las doce colecciones del modelo, mas contadores.
#
# Marcas de cada campo:
#   #  el identificador del documento
#   >  referencia a otra coleccion
#   [  arreglo embebido: lo que en el relacional era otra tabla
#   -  campo dentro de un arreglo embebido
COLECCIONES = {
    "carreras": [
        "# _id", "clave", "clave_matricula", "nombre", "activa",
    ],
    "turnos": [
        "# _id", "nombre", "hora_inicio", "hora_fin",
    ],
    "periodos": [
        "# _id", "clave", "nombre", "anio", "numero",
        "fecha_inicio", "fecha_fin", "actual",
        "[ calendario            (calendario_escolar)",
        "- tipo_evento", "- descripcion", "- fecha_inicio",
        "- fecha_fin", "- activo",
    ],
    "aulas": [
        "# _id", "clave", "nombre", "tipo", "capacidad", "activa",
    ],
    "materias": [
        "# _id", "clave", "nombre", "creditos", "horas_semana", "activa",
    ],
    "planes_estudio": [
        "# _id", "> id_carrera", "clave_carrera",
        "[ materias               (materia_carrera)",
        "- id_materia", "- clave", "- nombre",
        "- cuatrimestre", "- id_materia_requisito",
    ],
    "usuarios": [
        "# _id", "rol", "nombre", "apellido_paterno", "apellido_materno",
        "correo", "telefono", "> id_carrera", "numero_coordinador",
        "activo", "ultimo_acceso", "fecha_creacion",
        "[ perfil_alumno          (alumnos)",
        "- matricula", "- curp", "- sexo", "- fecha_nacimiento",
        "- carrera", "- turno", "- cuatrimestre_actual",
        "- id_periodo_ingreso", "- estatus",
        "- domicilio", "- secundaria", "- tutor", "- foto",
        "[   expediente           (documentos)",
        "-   tipo", "-   estatus", "-   fecha_recepcion",
        "-   observaciones", "-   recibido_por",
        "[ perfil_docente         (docentes)",
        "- numero_empleado", "- curp", "- rfc", "- grado_academico",
        "- especialidad", "- cedula_profesional",
        "- tipo_contrato", "- fecha_ingreso", "- activo",
    ],
    "grupos": [
        "# _id", "clave", "> id_carrera", "> id_turno", "> id_periodo",
        "carrera", "turno", "cuatrimestre", "cupo", "activo",
        "[ asignaciones           (asignaciones)",
        "- id_materia", "- materia", "- id_docente",
        "- estatus_captura", "- captura_manual",
        "[   horarios             (horarios)",
        "-   id_aula", "-   dia_semana",
        "-   hora_inicio", "-   hora_fin",
    ],
    "inscripciones": [
        "# _id", "> id_alumno", "> id_periodo", "> id_grupo",
        "cuatrimestre", "tipo", "estatus",
        "fecha_solicitud", "fecha_inscripcion",
        "atendida_por", "observaciones",
        "[ carga                  (carga_academica)",
        "- id_asignacion", "- materia", "- tipo_curso", "- estatus",
        "[   calificaciones       (calificaciones)",
        "-   tipo", "-   calificacion",
        "-   fecha_captura", "-   capturada_por",
    ],
    "tramites": [
        "# _id", "> id_alumno", "tipo", "motivo", "estatus",
        "observaciones", "fecha_solicitud", "fecha_resolucion",
        "atendido_por",
    ],
    "avisos": [
        "# _id", "titulo", "contenido", "rol_destino", "> id_grupo",
        "publicado_por", "fecha_publicacion", "fecha_expiracion", "activo",
    ],
    "bitacora": [
        "# _id", "id_usuario", "accion", "tabla_afectada", "id_registro",
        "datos_anteriores", "datos_nuevos", "fecha_hora",
    ],
    "contadores": [
        "# _id", "valor",
    ],
}

# Las que no son del sistema escolar sino de su operacion, en verde,
# igual que en el proyecto relacional.
VERDES = {"avisos", "bitacora", "tramites", "contadores"}


def alto_de(campos):
    return ALTO_TITULO + len(campos) * ALTO_LINEA + 12


def caja(x, y, nombre, campos):
    color = VERDE if nombre in VERDES else AZUL
    relleno = VERDE_SUAVE if nombre in VERDES else BLANCO
    alto = alto_de(campos)
    partes = [
        f'  <rect x="{x}" y="{y}" width="{ANCHO_CAJA}" height="{alto}" rx="10" '
        f'fill="{relleno}" stroke="{BORDE}" stroke-width="1.5" />',
        f'  <path d="M{x} {y + ALTO_TITULO} h{ANCHO_CAJA} v-{ALTO_TITULO - 10} '
        f'a10 10 0 0 0 -10 -10 h-{ANCHO_CAJA - 20} a10 10 0 0 0 -10 10 z" fill="{color}" />',
        f'  <text x="{x + 14}" y="{y + 23}" {TEXTO} font-size="15" font-weight="700" '
        f'fill="#ffffff">{nombre}</text>',
    ]
    for indice, campo in enumerate(campos):
        sangria = 0
        if campo.startswith("#"):
            color_campo, peso = AZUL_OSCURO, "700"
        elif campo.startswith(">"):
            color_campo, peso = AZUL, "700"
        elif campo.startswith("["):
            color_campo, peso = VERDE, "700"
            sangria = 10 if campo.startswith("[   ") else 0
        elif campo.startswith("-"):
            color_campo, peso = "#64748b", "400"
            sangria = 24 if campo.startswith("-   ") else 14
        else:
            color_campo, peso = "#0f172a", "400"
        partes.append(
            f'  <text x="{x + 14 + sangria}" y="{y + ALTO_TITULO + 17 + indice * ALTO_LINEA}" '
            f'{TEXTO} font-size="12.5" font-weight="{peso}" fill="{color_campo}">{campo}</text>'
        )
    return "\n".join(partes)


def diagrama_colecciones(nombres, titulo, subtitulo):
    columnas = [[], []]
    altos = [INICIO_Y, INICIO_Y]
    for nombre in nombres:
        indice = 0 if altos[0] <= altos[1] else 1
        columnas[indice].append((nombre, altos[indice]))
        altos[indice] += alto_de(COLECCIONES[nombre]) + SEPARACION_Y

    alto_total = max(altos) + 60
    partes = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ANCHO} {alto_total}" '
        f'width="{ANCHO}" height="{alto_total}" role="img" aria-label="{titulo}">',
        f'  <rect width="{ANCHO}" height="{alto_total}" fill="{BLANCO}" />',
        f'  <text x="{MARGEN_X}" y="46" {TITULO} font-size="19" font-weight="700" '
        f'fill="{AZUL_OSCURO}">{titulo}</text>',
        f'  <text x="{MARGEN_X}" y="72" {TEXTO} font-size="13" fill="{GRIS}">{subtitulo}</text>',
        f'  <text x="{MARGEN_X}" y="96" {TEXTO} font-size="12.5" fill="{GRIS}">'
        f'# identificador &#160;&#160; &gt; referencia a otra colección &#160;&#160; '
        f'[ arreglo embebido</text>',
        f'  <text x="{MARGEN_X}" y="116" {TEXTO} font-size="12.5" fill="{GRIS}">'
        f'Entre paréntesis, la tabla del modelo relacional de la que viene cada arreglo.</text>',
    ]
    for indice, columna in enumerate(columnas):
        x = MARGEN_X + indice * (ANCHO_CAJA + SEPARACION_X)
        for nombre, y in columna:
            partes.append(caja(x, y, nombre, COLECCIONES[nombre]))
    partes.append("</svg>")
    return "\n".join(partes)


# --- diagrama de comparacion -------------------------------------------------
#
# Las veinte tablas a la izquierda y las doce colecciones a la derecha.
# Una linea por tabla: verde si la tabla desaparecio dentro de otro
# documento, azul si se quedo como coleccion propia.

TABLAS = [
    "carreras", "turnos", "periodos", "calendario_escolar", "aulas",
    "materias", "materia_carrera", "usuarios", "alumnos", "docentes",
    "documentos", "grupos", "asignaciones", "horarios", "inscripciones",
    "carga_academica", "calificaciones", "tramites", "avisos", "bitacora",
]

# tabla -> (coleccion destino, se embebio)
DESTINO = {
    "carreras": ("carreras", False),
    "turnos": ("turnos", False),
    "periodos": ("periodos", False),
    "calendario_escolar": ("periodos", True),
    "aulas": ("aulas", False),
    "materias": ("materias", False),
    "materia_carrera": ("planes_estudio", True),
    "usuarios": ("usuarios", False),
    "alumnos": ("usuarios", True),
    "docentes": ("usuarios", True),
    "documentos": ("usuarios", True),
    "grupos": ("grupos", False),
    "asignaciones": ("grupos", True),
    "horarios": ("grupos", True),
    "inscripciones": ("inscripciones", False),
    "carga_academica": ("inscripciones", True),
    "calificaciones": ("inscripciones", True),
    "tramites": ("tramites", False),
    "avisos": ("avisos", False),
    "bitacora": ("bitacora", False),
}

ORDEN_COLECCIONES = [
    "carreras", "turnos", "periodos", "aulas", "materias", "planes_estudio",
    "usuarios", "grupos", "inscripciones", "tramites", "avisos", "bitacora",
]


def diagrama_comparacion():
    alto_fila = 34
    alto_col = 56
    inicio = 150
    x_izq, ancho_izq = 40, 250
    x_der, ancho_der = 660, 250
    alto_total = inicio + len(TABLAS) * alto_fila + 70

    y_tabla = {t: inicio + i * alto_fila for i, t in enumerate(TABLAS)}
    y_col = {c: inicio + i * alto_col + 20 for i, c in enumerate(ORDEN_COLECCIONES)}

    partes = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ANCHO} {alto_total}" '
        f'width="{ANCHO}" height="{alto_total}" role="img" '
        f'aria-label="De veinte tablas a doce colecciones">',
        f'  <rect width="{ANCHO}" height="{alto_total}" fill="{BLANCO}" />',
        f'  <text x="{MARGEN_X}" y="46" {TITULO} font-size="19" font-weight="700" '
        f'fill="{AZUL_OSCURO}">De veinte tablas a doce colecciones</text>',
        f'  <text x="{MARGEN_X}" y="72" {TEXTO} font-size="13" fill="{GRIS}">'
        f'Qué pasó con cada tabla del modelo relacional al rediseñarlo a documentos.</text>',
        f'  <text x="{MARGEN_X}" y="96" {TEXTO} font-size="12.5" fill="{VERDE}" '
        f'font-weight="700">Línea verde: la tabla desapareció y quedó como arreglo dentro de '
        f'otro documento.</text>',
        f'  <text x="{MARGEN_X}" y="116" {TEXTO} font-size="12.5" fill="{AZUL}" '
        f'font-weight="700">Línea azul: la tabla se quedó como colección propia.</text>',
        f'  <text x="{x_izq}" y="{inicio - 16}" {TEXTO} font-size="13" font-weight="700" '
        f'fill="{GRIS}">PostgreSQL · 20 tablas</text>',
        f'  <text x="{x_der}" y="{inicio - 16}" {TEXTO} font-size="13" font-weight="700" '
        f'fill="{GRIS}">MongoDB · 12 colecciones</text>',
    ]

    # Las lineas van primero, para que las cajas queden encima.
    for tabla in TABLAS:
        destino, embebida = DESTINO[tabla]
        color = VERDE if embebida else AZUL
        y1 = y_tabla[tabla] + 13
        y2 = y_col[destino] + 17
        x1 = x_izq + ancho_izq
        x2 = x_der
        medio = (x1 + x2) / 2
        partes.append(
            f'  <path d="M{x1} {y1} C{medio} {y1}, {medio} {y2}, {x2} {y2}" '
            f'fill="none" stroke="{color}" stroke-width="1.4" opacity="0.55" />'
        )

    for tabla in TABLAS:
        _, embebida = DESTINO[tabla]
        y = y_tabla[tabla]
        relleno = VERDE_SUAVE if embebida else AZUL_SUAVE
        borde = VERDE if embebida else AZUL
        partes.append(
            f'  <rect x="{x_izq}" y="{y}" width="{ancho_izq}" height="26" rx="6" '
            f'fill="{relleno}" stroke="{borde}" stroke-width="1.2" />'
        )
        partes.append(
            f'  <text x="{x_izq + 10}" y="{y + 18}" {TEXTO} font-size="12.5" '
            f'fill="#0f172a">{tabla}</text>'
        )

    for coleccion in ORDEN_COLECCIONES:
        y = y_col[coleccion]
        dentro = [t for t, (d, e) in DESTINO.items() if d == coleccion and e]
        color = VERDE if coleccion in VERDES else AZUL
        partes.append(
            f'  <rect x="{x_der}" y="{y}" width="{ancho_der}" height="34" rx="8" '
            f'fill="{BLANCO}" stroke="{color}" stroke-width="1.6" />'
        )
        partes.append(
            f'  <text x="{x_der + 12}" y="{y + 15}" {TEXTO} font-size="12.5" '
            f'font-weight="700" fill="{color}">{coleccion}</text>'
        )
        detalle = ("lleva dentro: " + ", ".join(dentro)) if dentro else "sin nada embebido"
        partes.append(
            f'  <text x="{x_der + 12}" y="{y + 28}" {TEXTO} font-size="10.5" '
            f'fill="{GRIS}">{detalle}</text>'
        )

    partes.append(
        f'  <text x="{MARGEN_X}" y="{alto_total - 30}" {TEXTO} font-size="12.5" fill="{GRIS}">'
        f'Las ocho tablas con línea verde no se perdieron: viven como arreglos dentro del '
        f'documento al que pertenecen.</text>'
    )
    partes.append("</svg>")
    return "\n".join(partes)


def main():
    carpeta = Path(__file__).parent
    carpeta.mkdir(parents=True, exist_ok=True)

    repartos = [
        ("colecciones-1.svg",
         ["carreras", "turnos", "periodos", "aulas", "materias", "planes_estudio", "usuarios"],
         "Colecciones del plantel, del plan de estudios y de las personas",
         "Los catálogos, el plan de cada carrera y la cuenta con el perfil del rol dentro."),
        ("colecciones-2.svg",
         ["grupos", "inscripciones", "tramites", "avisos", "bitacora", "contadores"],
         "Colecciones de la oferta del cuatrimestre y de la trayectoria",
         "El grupo con sus materias y horarios, y el cuatrimestre del alumno con sus "
         "calificaciones."),
    ]
    escritos = []
    for archivo, nombres, titulo, subtitulo in repartos:
        (carpeta / archivo).write_text(
            diagrama_colecciones(nombres, titulo, subtitulo), encoding="utf-8"
        )
        escritos.append(archivo)

    (carpeta / "comparacion.svg").write_text(diagrama_comparacion(), encoding="utf-8")
    escritos.append("comparacion.svg")

    print("escritos: " + ", ".join(escritos))


if __name__ == "__main__":
    main()
