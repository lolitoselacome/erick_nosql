// =====================================================================
// CETIA - Que campos puede escribir cada rol: el heredero de los
// permisos por columna de PostgreSQL
//
// En el proyecto relacional esto eran los GRANT por columna, y encima
// los disparadores proteger_usuarios, proteger_alumnos y
// proteger_docentes, que rechazaban el cambio si alguien tocaba un
// campo que no le tocaba. El alumno puede cambiar su domicilio pero no
// su CURP ni su matricula; el coordinador asigna docentes pero no abre
// la captura de calificaciones.
//
// Los roles de MongoDB no llegan a este nivel: dicen "puede escribir en
// usuarios", no "puede escribir el telefono de usuarios". Asi que la
// lista vive aqui y se aplica filtrando la actualizacion ANTES de que
// llegue a MongoDB.
//
// Se filtra en lugar de rechazar porque es lo que hacia el disparador
// del proyecto relacional en la practica: si la peticion trae un campo
// que la persona no puede tocar, ese campo se cae y el resto sigue.
// La unica excepcion son los campos sellados, que si rechazan, porque
// intentar cambiarlos siempre es un error de programacion o un intento.
// =====================================================================

import { ErrorDeAcceso } from "./identidad.js";

// Campos que nadie cambia nunca, por ningun camino: los pone la base al
// dar de alta y no se tocan. Son los disparadores alumnos_bloquear_matricula
// y docentes_bloquear_numero.
const SELLADOS = new Set([
  "_id",
  "perfil_alumno.matricula",
  "perfil_alumno.id_alumno",
  "perfil_docente.numero_empleado",
  "perfil_docente.id_docente",
  "numero_coordinador",
  "fecha_creacion",
]);

// Campos que un rol NO puede escribir aunque tenga permiso sobre el
// campo del que cuelgan. Esta lista gana sobre la de permitidos.
//
// Hace falta porque los permisos se heredan hacia abajo: quien puede
// escribir "asignaciones" puede escribir todo lo que vaya dentro. Pero
// en el proyecto relacional coordinacion tiene permiso sobre la tabla
// asignaciones y NO sobre su columna estatus_captura: abrir y cerrar la
// captura de calificaciones es de administracion. Sin esta lista, esa
// distincion se perderia.
const PROHIBIDOS = {
  coordinador: {
    grupos: ["asignaciones.$[].estatus_captura", "asignaciones.$[].captura_manual"],
  },
};

function estaProhibido(rol, coleccion, campo) {
  const lista = PROHIBIDOS[rol]?.[coleccion] || [];
  return lista.some((p) => {
    if (campo === p) return true;
    // El ultimo tramo del campo, para atrapar la misma columna escrita
    // de otra forma (asignaciones.0.estatus_captura, por ejemplo).
    const columna = p.split(".").pop();
    return campo.startsWith("asignaciones") && campo.endsWith("." + columna);
  });
}

// Lo que cada rol puede escribir en cada coleccion.
// "*" significa todos los campos de esa coleccion.
const ESCRITURA = {
  alumno: {
    usuarios: [
      "telefono",
      "perfil_alumno.telefono_casa",
      "perfil_alumno.domicilio.calle",
      "perfil_alumno.domicilio.numero_exterior",
      "perfil_alumno.domicilio.colonia",
      "perfil_alumno.domicilio.codigo_postal",
      "perfil_alumno.domicilio.municipio",
      "perfil_alumno.domicilio.estado",
      "perfil_alumno.secundaria.escuela_procedencia",
      "perfil_alumno.secundaria.promedio",
      "perfil_alumno.tutor.nombre",
      "perfil_alumno.tutor.parentesco",
      "perfil_alumno.tutor.telefono",
      "perfil_alumno.foto",
    ],
    // Solo solicita: el estatus, las fechas y quien atiende los pone
    // administracion. Eso lo impone reglas/inscripcion.js al crearla.
    inscripciones: [],
    tramites: [],
  },

  docente: {
    usuarios: [
      "telefono",
      "perfil_docente.grado_academico",
      "perfil_docente.especialidad",
      "perfil_docente.cedula_profesional",
    ],
    // Captura calificaciones de sus materias. Que sean las suyas y que
    // la captura este abierta lo revisa reglas/calificacion.js.
    inscripciones: ["carga.$[].calificaciones"],
    avisos: "*",
  },

  coordinador: {
    usuarios: ["telefono"],
    // Arma grupos y horarios y asigna docentes, pero no abre ni cierra
    // la captura: estatus_captura y captura_manual no estan en la lista.
    grupos: [
      "clave",
      "cupo",
      "activo",
      "asignaciones",
      "asignaciones.$[].id_docente",
      "asignaciones.$[].horarios",
    ],
    avisos: "*",
    contadores: "*",
  },

  administrador: {
    usuarios: "*",
    carreras: "*",
    turnos: "*",
    periodos: "*",
    aulas: "*",
    materias: "*",
    planes_estudio: "*",
    grupos: "*",
    inscripciones: "*",
    tramites: "*",
    avisos: "*",
    contadores: "*",
    // La bitacora no se modifica: solo se lee y se agrega.
  },
};

/**
 * Deja de una actualizacion solo los campos que el rol puede escribir.
 *
 * @returns {{cambios: object, descartados: string[]}}
 */
export function filtrarEscritura(identidad, coleccion, cambios) {
  if (!identidad || !identidad.rol) {
    throw new ErrorDeAcceso("No se puede escribir sin identidad");
  }

  // Lo sellado rechaza, no se filtra en silencio.
  for (const campo of Object.keys(cambios)) {
    if (SELLADOS.has(campo)) {
      throw new ErrorDeAcceso(`El campo ${campo} no se puede cambiar`);
    }
  }

  const permitidos = ESCRITURA[identidad.rol]?.[coleccion];

  if (permitidos === undefined) {
    throw new ErrorDeAcceso(
      `El rol ${identidad.rol} no puede escribir en ${coleccion}`
    );
  }

  if (permitidos === "*") {
    return { cambios, descartados: [] };
  }

  const lista = new Set(permitidos);
  const salida = {};
  const descartados = [];

  for (const [campo, valor] of Object.entries(cambios)) {
    // Un campo esta permitido si esta en la lista, o si cuelga de uno
    // que lo esta (domicilio.calle cuando se permite domicilio), salvo
    // que este prohibido expresamente: eso gana siempre.
    const permitido =
      !estaProhibido(identidad.rol, coleccion, campo) &&
      (lista.has(campo) || [...lista].some((p) => campo.startsWith(p + ".")));

    if (permitido) salida[campo] = valor;
    else descartados.push(campo);
  }

  return { cambios: salida, descartados };
}

/** Si el rol puede borrar documentos de esa coleccion. */
export function puedeBorrar(identidad, coleccion) {
  if (identidad.rol === "administrador") return coleccion !== "bitacora";
  if (identidad.rol === "coordinador") return ["grupos", "avisos"].includes(coleccion);
  if (identidad.rol === "docente") return coleccion === "avisos";
  return false;
}

/** Si el rol puede crear documentos en esa coleccion. */
export function puedeCrear(identidad, coleccion) {
  const permitidos = {
    alumno: ["inscripciones", "tramites"],
    docente: ["avisos"],
    coordinador: ["grupos", "avisos"],
    administrador: [
      "usuarios", "carreras", "turnos", "periodos", "aulas", "materias",
      "planes_estudio", "grupos", "inscripciones", "tramites", "avisos",
      "contadores", "bitacora",
    ],
  };
  return (permitidos[identidad.rol] || []).includes(coleccion);
}
