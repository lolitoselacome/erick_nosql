// =====================================================================
// CETIA - Validacion del horario
//
// Heredera directa del disparador validar_horario del proyecto
// relacional. Revisa, en este orden:
//
//   1. la clase cae dentro del turno del grupo
//   2. el aula esta activa y le cabe el grupo
//   3. no se programan mas horas de las que trae la materia
//   4. el aula no esta ocupada a esa hora
//   5. el grupo no tiene otra clase a esa hora
//   6. el docente no tiene otra clase a esa hora
//
// Por que esta es la regla cara
// -----------------------------
// En PostgreSQL las tres revisiones de empalme eran UNA consulta, y el
// motor garantizaba que entre la revision y la escritura no se colaba
// nadie. Aqui hay que leer los grupos del cuatrimestre y comparar en
// memoria, y hay que hacerlo DENTRO de la misma transaccion que la
// escritura: si no, dos coordinadores programando a la vez pueden meter
// un empalme, porque los dos leerian un estado sin conflicto.
//
// El costo esta acotado: se leen los grupos de un cuatrimestre, que son
// decenas, no miles, y solo los campos del horario.
// =====================================================================

export class ErrorDeRegla extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "ErrorDeRegla";
    this.codigo = 409;
  }
}

/** "07:00" -> 420 minutos. Asi comparar horas es comparar numeros. */
function aMinutos(hora) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

/** Dos rangos se cruzan si cada uno empieza antes de que el otro acabe. */
function seCruzan(a, b) {
  return aMinutos(a.hora_inicio) < aMinutos(b.hora_fin) &&
         aMinutos(b.hora_inicio) < aMinutos(a.hora_fin);
}

const DIAS = ["", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

/**
 * Revisa un bloque de horario antes de guardarlo.
 *
 * @param {object} bd        la base
 * @param {object} datos     { idGrupo, idAsignacion, bloque, idHorario? }
 * @param {object} sesion    la sesion de la transaccion; obligatoria
 */
export async function validarHorario(bd, datos, sesion) {
  if (!sesion) {
    throw new Error(
      "validarHorario necesita la sesion de la transaccion: revisar y escribir " +
        "fuera de una transaccion deja una ventana para que se cuele un empalme"
    );
  }

  const { idGrupo, idAsignacion, bloque, idHorario = null } = datos;
  const opc = { session: sesion };

  if (aMinutos(bloque.hora_fin) <= aMinutos(bloque.hora_inicio)) {
    throw new ErrorDeRegla("La clase no puede terminar antes de empezar");
  }

  const grupo = await bd.collection("grupos").findOne({ _id: idGrupo }, opc);
  if (!grupo) throw new ErrorDeRegla("El grupo no existe");

  const asignacion = (grupo.asignaciones || []).find((a) => a._id === idAsignacion);
  if (!asignacion) throw new ErrorDeRegla("La materia no esta asignada a ese grupo");

  // ----- 1. Dentro del turno -----
  const turno = grupo.turno || {};
  if (turno.hora_inicio && turno.hora_fin) {
    if (
      aMinutos(bloque.hora_inicio) < aMinutos(turno.hora_inicio) ||
      aMinutos(bloque.hora_fin) > aMinutos(turno.hora_fin)
    ) {
      throw new ErrorDeRegla(
        `La clase debe quedar dentro del turno del grupo ` +
          `(${turno.hora_inicio} a ${turno.hora_fin})`
      );
    }
  }

  // ----- 2. El aula -----
  const aula = await bd.collection("aulas").findOne({ _id: bloque.id_aula }, opc);
  if (!aula) throw new ErrorDeRegla("El aula no existe");
  if (!aula.activa) throw new ErrorDeRegla("El aula esta dada de baja");
  if (aula.capacidad < grupo.cupo) {
    throw new ErrorDeRegla(
      `El aula tiene lugar para ${aula.capacidad} y el grupo es de ${grupo.cupo}`
    );
  }

  // ----- 3. Las horas de la materia -----
  const horasMateria = asignacion.materia?.horas_semana;
  if (horasMateria) {
    const yaProgramadas = (asignacion.horarios || [])
      .filter((h) => h._id !== idHorario)
      .reduce((t, h) => t + (aMinutos(h.hora_fin) - aMinutos(h.hora_inicio)) / 60, 0);

    const total =
      yaProgramadas + (aMinutos(bloque.hora_fin) - aMinutos(bloque.hora_inicio)) / 60;

    if (total > horasMateria) {
      throw new ErrorDeRegla(
        `La materia lleva ${horasMateria} horas a la semana y con esta ya llevas ${total}`
      );
    }
  }

  // ----- 4, 5 y 6. Los empalmes del cuatrimestre -----
  //
  // Solo los grupos del mismo cuatrimestre pueden chocar: dos clases en
  // cuatrimestres distintos nunca coinciden en el tiempo real.
  const delPeriodo = await bd
    .collection("grupos")
    .find(
      { id_periodo: grupo.id_periodo, activo: true },
      {
        ...opc,
        projection: {
          _id: 1, clave: 1,
          "asignaciones._id": 1,
          "asignaciones.id_docente": 1,
          "asignaciones.materia.nombre": 1,
          "asignaciones.horarios": 1,
        },
      }
    )
    .toArray();

  for (const g of delPeriodo) {
    for (const a of g.asignaciones || []) {
      for (const h of a.horarios || []) {
        // El bloque que se esta editando no choca consigo mismo.
        if (h._id === idHorario) continue;
        if (h.dia_semana !== bloque.dia_semana) continue;
        if (!seCruzan(h, bloque)) continue;

        const cuando = `${DIAS[bloque.dia_semana]} de ${bloque.hora_inicio} a ${bloque.hora_fin}`;

        if (h.id_aula === bloque.id_aula) {
          throw new ErrorDeRegla(
            `El aula ${aula.clave} ya esta ocupada el ${cuando} por el grupo ${g.clave}`
          );
        }
        if (g._id === idGrupo) {
          throw new ErrorDeRegla(
            `El grupo ${grupo.clave} ya tiene ${a.materia?.nombre || "otra clase"} el ${cuando}`
          );
        }
        if (asignacion.id_docente && a.id_docente === asignacion.id_docente) {
          throw new ErrorDeRegla(
            `El docente ya tiene clase el ${cuando} con el grupo ${g.clave}`
          );
        }
      }
    }
  }

  return true;
}
