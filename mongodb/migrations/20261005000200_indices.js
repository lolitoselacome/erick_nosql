// =====================================================================
// CETIA - Indices
//
// Dos grupos de indices:
//
// 1. Los unicos, que son los herederos de las restricciones unique de
//    PostgreSQL. Varios van parciales, porque el campo solo existe en
//    los documentos del rol que lo tiene: la matricula solo esta en el
//    perfil del alumno y el numero de empleado solo en el del docente.
//
//    Cuatro restricciones unique del modelo relacional ya no aparecen
//    aqui, y no porque se hayan perdido: lo que protegian quedo dentro
//    de un mismo documento, asi que dejaron de ser una regla que se
//    pueda violar y pasaron a ser imposibles.
//
//      documentos (id_alumno, tipo_documento)      -> forma del arreglo
//      calificaciones (id_carga, tipo)             -> forma del arreglo
//      asignaciones (id_grupo, id_materia)         -> forma del arreglo
//      carga_academica (id_inscripcion, id_asignacion) -> forma del arreglo
//
// 2. Los de consulta, uno por pantalla del sistema.
// =====================================================================

const UNICOS = [
  // Catalogos
  { coleccion: 'carreras', llaves: { clave: 1 }, nombre: 'carreras_clave_unica' },
  { coleccion: 'carreras', llaves: { nombre: 1 }, nombre: 'carreras_nombre_unico' },
  {
    coleccion: 'carreras',
    llaves: { clave_matricula: 1 },
    nombre: 'carreras_clave_matricula_unica',
  },
  { coleccion: 'turnos', llaves: { nombre: 1 }, nombre: 'turnos_nombre_unico' },
  { coleccion: 'periodos', llaves: { clave: 1 }, nombre: 'periodos_clave_unica' },
  { coleccion: 'periodos', llaves: { anio: 1, numero: 1 }, nombre: 'periodos_anio_numero_unico' },
  { coleccion: 'aulas', llaves: { clave: 1 }, nombre: 'aulas_clave_unica' },
  { coleccion: 'materias', llaves: { clave: 1 }, nombre: 'materias_clave_unica' },

  // Solo un cuatrimestre puede estar marcado como actual. Es el
  // equivalente directo del indice unico parcial del modelo relacional.
  {
    coleccion: 'periodos',
    llaves: { actual: 1 },
    nombre: 'periodos_un_solo_actual',
    parcial: { actual: true },
  },

  // Un plan de estudios por carrera
  { coleccion: 'planes_estudio', llaves: { id_carrera: 1 }, nombre: 'planes_carrera_unica' },

  // Personas
  { coleccion: 'usuarios', llaves: { correo: 1 }, nombre: 'usuarios_correo_unico' },
  {
    coleccion: 'usuarios',
    llaves: { 'perfil_alumno.matricula': 1 },
    nombre: 'alumnos_matricula_unica',
    parcial: { 'perfil_alumno.matricula': { $exists: true } },
  },
  {
    coleccion: 'usuarios',
    llaves: { 'perfil_alumno.curp': 1 },
    nombre: 'alumnos_curp_unica',
    parcial: { 'perfil_alumno.curp': { $exists: true } },
  },
  {
    coleccion: 'usuarios',
    llaves: { 'perfil_docente.numero_empleado': 1 },
    nombre: 'docentes_numero_unico',
    parcial: { 'perfil_docente.numero_empleado': { $exists: true } },
  },
  {
    coleccion: 'usuarios',
    llaves: { 'perfil_docente.curp': 1 },
    nombre: 'docentes_curp_unica',
    parcial: { 'perfil_docente.curp': { $type: 'string' } },
  },
  {
    coleccion: 'usuarios',
    llaves: { 'perfil_docente.rfc': 1 },
    nombre: 'docentes_rfc_unico',
    parcial: { 'perfil_docente.rfc': { $type: 'string' } },
  },
  {
    coleccion: 'usuarios',
    llaves: { numero_coordinador: 1 },
    nombre: 'coordinadores_numero_unico',
    parcial: { numero_coordinador: { $type: 'string' } },
  },

  // La clave del grupo es unica dentro de su cuatrimestre, no en general
  {
    coleccion: 'grupos',
    llaves: { clave: 1, id_periodo: 1 },
    nombre: 'grupos_clave_unica_por_periodo',
  },

  // Una sola inscripcion por alumno y cuatrimestre
  {
    coleccion: 'inscripciones',
    llaves: { id_alumno: 1, id_periodo: 1 },
    nombre: 'inscripciones_una_por_periodo',
  },
];

const CONSULTA = [
  // El coordinador consulta por su carrera; las altas filtran por rol
  { coleccion: 'usuarios', llaves: { rol: 1, activo: 1 }, nombre: 'usuarios_rol_idx' },
  { coleccion: 'usuarios', llaves: { id_carrera: 1 }, nombre: 'usuarios_carrera_idx' },
  {
    coleccion: 'usuarios',
    llaves: { 'perfil_alumno.carrera._id': 1, 'perfil_alumno.turno._id': 1 },
    nombre: 'alumnos_carrera_turno_idx',
  },

  // La oferta del cuatrimestre
  {
    coleccion: 'grupos',
    llaves: { id_periodo: 1, 'carrera._id': 1, 'turno._id': 1, cuatrimestre: 1 },
    nombre: 'grupos_periodo_idx',
  },
  // Los grupos del docente: multiclave sobre el arreglo de asignaciones
  {
    coleccion: 'grupos',
    llaves: { 'asignaciones.id_docente': 1 },
    nombre: 'grupos_docente_idx',
  },
  // La ocupacion del aula y la revision de empalmes
  {
    coleccion: 'grupos',
    llaves: { 'asignaciones.horarios.id_aula': 1, 'asignaciones.horarios.dia_semana': 1 },
    nombre: 'grupos_aula_dia_idx',
  },
  { coleccion: 'grupos', llaves: { 'asignaciones._id': 1 }, nombre: 'grupos_asignacion_idx' },

  // El historial y la boleta del alumno
  { coleccion: 'inscripciones', llaves: { id_grupo: 1 }, nombre: 'inscripciones_grupo_idx' },
  { coleccion: 'inscripciones', llaves: { id_periodo: 1, estatus: 1 }, nombre: 'inscripciones_periodo_idx' },
  // La lista de captura del docente, por materia del grupo
  {
    coleccion: 'inscripciones',
    llaves: { 'carga.id_asignacion': 1 },
    nombre: 'inscripciones_asignacion_idx',
  },

  // La cola de administracion y los tramites del alumno
  { coleccion: 'tramites', llaves: { estatus: 1, fecha_solicitud: -1 }, nombre: 'tramites_estatus_idx' },
  { coleccion: 'tramites', llaves: { id_alumno: 1 }, nombre: 'tramites_alumno_idx' },

  // El tablero de avisos
  {
    coleccion: 'avisos',
    llaves: { rol_destino: 1, activo: 1, fecha_publicacion: -1 },
    nombre: 'avisos_rol_idx',
  },
  { coleccion: 'avisos', llaves: { id_grupo: 1 }, nombre: 'avisos_grupo_idx' },

  // La bitacora, que solo lee administracion
  { coleccion: 'bitacora', llaves: { id_usuario: 1, fecha_hora: -1 }, nombre: 'bitacora_usuario_idx' },
  { coleccion: 'bitacora', llaves: { coleccion: 1, fecha_hora: -1 }, nombre: 'bitacora_coleccion_idx' },
];

module.exports = {
  descripcion: 'Indices unicos (herederos de unique) e indices de consulta por pantalla',

  async aplicar(db) {
    for (const idx of UNICOS) {
      const opciones = { name: idx.nombre, unique: true };
      if (idx.parcial) opciones.partialFilterExpression = idx.parcial;
      await db.collection(idx.coleccion).createIndex(idx.llaves, opciones);
    }

    for (const idx of CONSULTA) {
      await db.collection(idx.coleccion).createIndex(idx.llaves, { name: idx.nombre });
    }
  },
};
