// =====================================================================
// CETIA - Promediar parciales y mover el estatus de la materia
//
// Hereda dos disparadores del proyecto relacional:
//   calificaciones_promediar        -> con los tres parciales, la final
//                                      es su promedio
//   calificaciones_actualizar_carga -> con la final, la materia queda
//                                      aprobada o reprobada
//
// Lo que el rediseno hizo mas facil
// ---------------------------------
// En PostgreSQL esto cruzaba dos tablas: habia que consultar las otras
// calificaciones de la carga y escribir un renglon nuevo. Aqui los tres
// parciales, la final y el estatus de la materia estan en el mismo
// elemento del arreglo del mismo documento, asi que todo se lee y se
// escribe de una sola pasada.
//
// Se cuelga de un Atlas Trigger sobre inscripciones, en update y
// replace, con "Full Document" activado.
// =====================================================================

const PARCIALES = ["parcial_1", "parcial_2", "parcial_3"];
const APROBATORIA = 6;

exports = async function (evento) {
  const inscripcion = evento.fullDocument;
  if (!inscripcion || !Array.isArray(inscripcion.carga)) return;

  const cetia = context.services.get("cetia").db("cetia");
  const inscripciones = cetia.collection("inscripciones");

  const cambios = {};

  inscripcion.carga.forEach((materia, i) => {
    const califs = materia.calificaciones || [];
    const parciales = califs.filter((c) => PARCIALES.includes(c.tipo));
    const final = califs.find((c) => c.tipo === "final");
    const extra = califs.find((c) => c.tipo === "extraordinario");

    // Con los tres parciales y sin final capturada, la final sale sola.
    // Si el docente ya puso una final a mano, esa se respeta.
    if (parciales.length === 3 && !final) {
      const suma = parciales.reduce((t, c) => t + c.calificacion, 0);
      const promedio = Math.round((suma / 3) * 100) / 100;

      cambios[`carga.${i}.calificaciones`] = califs.concat([
        {
          _id: new BSON.ObjectId().toString(),
          tipo: "final",
          calificacion: promedio,
          fecha_captura: new Date(),
          capturada_por: parciales[parciales.length - 1].capturada_por || null,
        },
      ]);
      cambios[`carga.${i}.estatus`] =
        promedio >= APROBATORIA ? "aprobada" : "reprobada";
      return;
    }

    // El estatus sigue a la final, o al extraordinario si lo hubo.
    const decisiva = extra || final;
    if (decisiva && materia.estatus === "cursando") {
      cambios[`carga.${i}.estatus`] =
        decisiva.calificacion >= APROBATORIA ? "aprobada" : "reprobada";
    }
  });

  if (Object.keys(cambios).length === 0) return;

  await inscripciones.updateOne({ _id: inscripcion._id }, { $set: cambios });
};
