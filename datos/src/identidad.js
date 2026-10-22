// =====================================================================
// CETIA - El alcance de cada persona: el heredero de la seguridad por
// filas (RLS) de PostgreSQL
//
// En el proyecto relacional, cada una de las veinte tablas tenia sus
// politicas de RLS (sesenta en total) y el motor las aplicaba siempre:
// no habia forma de consultar sin ellas, ni olvidandose ni queriendo.
//
// MongoDB no tiene nada equivalente. Su control de accesos llega hasta
// la coleccion y la accion ("el alumno consulta grupos"), no hasta el
// documento ("el alumno consulta SU grupo"). Asi que el filtro por fila
// pasa a ser trabajo de esta capa.
//
// Lo unico que conserva algo de la propiedad que hacia valioso al RLS
// (que no se podia olvidar) es que sea estructuralmente imposible armar
// una consulta sin identidad. Por eso aqui no hay una funcion que
// "agregue" el filtro a una consulta que ya existe: hay una funcion que
// CONSTRUYE la consulta a partir de la identidad, y sin identidad
// lanza error. No es una convencion que haya que recordar, es la forma
// de la funcion.
//
// Encima de esto siguen los roles de MongoDB, que ponen el techo: si
// manana un error de esta capa dejara pasar una escritura de un alumno
// sobre grupos, el rol cetia_alumno la rechaza de todos modos.
// =====================================================================

export const ROLES = ["administrador", "coordinador", "docente", "alumno"];

export class ErrorDeAcceso extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "ErrorDeAcceso";
    this.codigo = 403;
  }
}

/**
 * La identidad de quien hace la peticion. La arma el backend al validar
 * la sesion y viaja en cada llamada a esta capa.
 *
 * @param {object} usuario documento de la coleccion usuarios
 */
export function identidadDe(usuario) {
  if (!usuario || !usuario._id || !usuario.rol) {
    throw new ErrorDeAcceso("Identidad incompleta: falta el usuario o su rol");
  }
  if (!ROLES.includes(usuario.rol)) {
    throw new ErrorDeAcceso(`Rol desconocido: ${usuario.rol}`);
  }
  if (usuario.activo === false) {
    throw new ErrorDeAcceso("La cuenta esta dada de baja");
  }

  return Object.freeze({
    id: usuario._id,
    rol: usuario.rol,
    // Solo el coordinador tiene carrera, y siempre la tiene.
    id_carrera: usuario.id_carrera || null,
    // Solo si es alumno.
    id_alumno: usuario.perfil_alumno?.id_alumno || null,
    // Solo si es docente.
    id_docente: usuario.perfil_docente?.id_docente || null,
  });
}

// ---------------------------------------------------------------------
// El alcance de lectura, coleccion por coleccion
//
// Devuelve el filtro que hay que mezclar con la consulta. Un objeto
// vacio significa "toda la coleccion"; lanzar error significa "esta
// persona no tiene nada que hacer aqui".
// ---------------------------------------------------------------------

// Los catalogos los lee todo el mundo: son la informacion del plantel.
const CATALOGOS = new Set([
  "carreras",
  "turnos",
  "periodos",
  "aulas",
  "materias",
  "planes_estudio",
]);

const ALCANCES = {
  usuarios(id) {
    switch (id.rol) {
      case "administrador":
        return {};
      // El coordinador ve a las personas de su carrera. Los alumnos
      // llevan la carrera dentro del perfil; los docentes y el resto
      // no tienen carrera, asi que no los alcanza por aqui.
      case "coordinador":
        return { "perfil_alumno.carrera._id": id.id_carrera };
      // El docente ve su propia cuenta y la de los alumnos de sus
      // grupos. Lo segundo necesita saber cuales son sus grupos, asi
      // que se resuelve con alcanceDeAlumnosDelDocente().
      case "docente":
        return { _id: id.id };
      case "alumno":
        return { _id: id.id };
    }
  },

  grupos(id) {
    switch (id.rol) {
      case "administrador":
        return {};
      case "coordinador":
        return { id_carrera: id.id_carrera };
      // Sus grupos son aquellos donde el es el docente de alguna materia.
      case "docente":
        return { "asignaciones.id_docente": id.id_docente };
      // El alumno ve el grupo donde esta inscrito; se resuelve con sus
      // inscripciones, porque el grupo no guarda a sus alumnos.
      case "alumno":
        return null; // lo resuelve alcanceDeGruposDelAlumno()
    }
  },

  inscripciones(id) {
    switch (id.rol) {
      case "administrador":
        return {};
      case "coordinador":
        return {}; // se acota despues por la carrera del grupo
      case "docente":
        return null; // lo resuelve alcanceDeInscripcionesDelDocente()
      case "alumno":
        return { id_alumno: id.id_alumno };
    }
  },

  tramites(id) {
    switch (id.rol) {
      case "administrador":
      case "coordinador":
        return {};
      case "alumno":
        return { id_alumno: id.id_alumno };
      // En el proyecto relacional el docente no tiene permiso sobre
      // tramites, ni de lectura.
      case "docente":
        throw new ErrorDeAcceso("Los tramites no son del docente");
    }
  },

  avisos(id) {
    if (id.rol === "administrador") return {};
    // Cada quien ve los avisos para todos y los de su rol. Los de grupo
    // se acotan despues con los grupos que le tocan.
    return { activo: true, $or: [{ rol_destino: null }, { rol_destino: id.rol }] };
  },

  bitacora(id) {
    if (id.rol !== "administrador") {
      throw new ErrorDeAcceso("La bitacora solo la lee administracion");
    }
    return {};
  },

  contadores(id) {
    if (id.rol !== "administrador") {
      throw new ErrorDeAcceso("Los contadores no se consultan");
    }
    return {};
  },
};

/**
 * El filtro de lectura para una persona sobre una coleccion.
 * Sin identidad no devuelve nada: lanza.
 */
export function alcance(identidad, coleccion) {
  if (!identidad || !identidad.rol) {
    throw new ErrorDeAcceso(
      "No se puede consultar sin identidad. " +
        "Toda lectura pasa por aqui con quien la hace."
    );
  }

  if (CATALOGOS.has(coleccion)) return {};

  const regla = ALCANCES[coleccion];
  if (!regla) {
    throw new ErrorDeAcceso(`Coleccion desconocida: ${coleccion}`);
  }

  const filtro = regla(identidad);
  if (filtro === undefined) {
    throw new ErrorDeAcceso(
      `El rol ${identidad.rol} no tiene alcance definido sobre ${coleccion}`
    );
  }
  return filtro;
}

/**
 * Mezcla el alcance de la persona con la consulta que pide el programa.
 * El alcance manda: si la consulta pide algo fuera de su alcance, no lo
 * encuentra, porque las dos condiciones van unidas con $and.
 */
export function consultaCon(identidad, coleccion, consulta = {}) {
  const filtro = alcance(identidad, coleccion);
  if (filtro === null) {
    throw new ErrorDeAcceso(
      `El alcance de ${identidad.rol} sobre ${coleccion} necesita resolverse ` +
        `con la funcion especifica de esa combinacion`
    );
  }
  if (Object.keys(filtro).length === 0) return consulta;
  if (Object.keys(consulta).length === 0) return filtro;
  return { $and: [filtro, consulta] };
}

// ---------------------------------------------------------------------
// Los alcances que necesitan una consulta previa
//
// Tres casos no se pueden expresar como un filtro suelto porque
// dependen de datos de otra coleccion. En PostgreSQL los resolvian
// funciones como docente_ve_inscripcion(); aqui son estas.
// ---------------------------------------------------------------------

/** Los grupos donde el alumno esta o estuvo inscrito. */
export async function alcanceDeGruposDelAlumno(bd, identidad) {
  if (identidad.rol !== "alumno") {
    throw new ErrorDeAcceso("Esta funcion es solo para el alumno");
  }
  const ids = await bd
    .collection("inscripciones")
    .distinct("id_grupo", { id_alumno: identidad.id_alumno });
  return { _id: { $in: ids } };
}

/** Las inscripciones de los alumnos de los grupos del docente. */
export async function alcanceDeInscripcionesDelDocente(bd, identidad) {
  if (identidad.rol !== "docente") {
    throw new ErrorDeAcceso("Esta funcion es solo para el docente");
  }
  const grupos = await bd
    .collection("grupos")
    .find({ "asignaciones.id_docente": identidad.id_docente })
    .project({ _id: 1, "asignaciones._id": 1, "asignaciones.id_docente": 1 })
    .toArray();

  // Solo las materias que el imparte, no todo el grupo.
  const asignaciones = [];
  grupos.forEach((g) =>
    (g.asignaciones || []).forEach((a) => {
      if (a.id_docente === identidad.id_docente) asignaciones.push(a._id);
    })
  );

  return { "carga.id_asignacion": { $in: asignaciones } };
}

/** Los alumnos de los grupos del docente. */
export async function alcanceDeAlumnosDelDocente(bd, identidad) {
  const filtro = await alcanceDeInscripcionesDelDocente(bd, identidad);
  const ids = await bd.collection("inscripciones").distinct("id_alumno", filtro);
  return { $or: [{ _id: identidad.id }, { "perfil_alumno.id_alumno": { $in: ids } }] };
}
