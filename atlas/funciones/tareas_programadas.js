// =====================================================================
// CETIA - Tareas programadas (Atlas Scheduled Trigger, cada hora)
//
// Hereda las dos funciones que en el proyecto relacional corria pg_cron:
//   sincronizar_captura -> mientras el calendario tenga abierta una
//                          ventana de captura del cuatrimestre actual,
//                          las materias quedan abiertas; al cerrarse la
//                          ventana, se cierran
//   depurar_avisos      -> los avisos vencidos se desactivan
//
// Si administracion abrio o cerro la captura de una materia a mano, esa
// materia queda marcada con captura_manual y esta tarea ya no la toca,
// igual que en el proyecto relacional.
//
// Lo que el rediseno hizo mas facil
// ---------------------------------
// Saber si hay una ventana de captura abierta era una junta entre
// periodos y calendario_escolar. Aqui el calendario vive dentro del
// cuatrimestre, asi que es leer el documento que tiene actual: true.
//
// Se cuelga de un Atlas Scheduled Trigger con cron: 0 * * * *
// =====================================================================

const VENTANAS_DE_CAPTURA = [
  "captura_parcial_1",
  "captura_parcial_2",
  "captura_parcial_3",
  "captura_final",
  "extraordinario",
];

exports = async function () {
  const cetia = context.services.get("cetia").db("cetia");
  const periodos = cetia.collection("periodos");
  const grupos = cetia.collection("grupos");
  const avisos = cetia.collection("avisos");

  const ahora = new Date();

  // ----- 1. La captura sigue al calendario -----
  const periodo = await periodos.findOne({ actual: true });
  let materiasMovidas = 0;

  if (periodo) {
    const abierta = (periodo.calendario || []).some(
      (e) =>
        e.activo &&
        VENTANAS_DE_CAPTURA.includes(e.tipo_evento) &&
        e.fecha_inicio <= ahora &&
        ahora <= e.fecha_fin
    );

    const destino = abierta ? "abierta" : "cerrada";

    const resultado = await grupos.updateMany(
      {
        id_periodo: periodo._id,
        asignaciones: {
          $elemMatch: { captura_manual: { $ne: true }, estatus_captura: { $ne: destino } },
        },
      },
      { $set: { "asignaciones.$[a].estatus_captura": destino } },
      {
        arrayFilters: [
          { "a.captura_manual": { $ne: true }, "a.estatus_captura": { $ne: destino } },
        ],
      }
    );

    materiasMovidas = resultado.modifiedCount || 0;
    console.log(
      `Captura ${destino} para el cuatrimestre ${periodo.clave}: ${materiasMovidas} grupos movidos`
    );
  } else {
    console.log("No hay cuatrimestre actual; la captura no se mueve");
  }

  // ----- 2. Avisos vencidos -----
  const vencidos = await avisos.updateMany(
    { activo: true, fecha_expiracion: { $ne: null, $lt: ahora } },
    { $set: { activo: false } }
  );

  console.log(`Avisos vencidos desactivados: ${vencidos.modifiedCount || 0}`);

  return {
    cuatrimestre: periodo ? periodo.clave : null,
    grupos_movidos: materiasMovidas,
    avisos_desactivados: vencidos.modifiedCount || 0,
  };
};
