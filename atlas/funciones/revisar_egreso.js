// =====================================================================
// CETIA - Revisar egreso y seguir el estatus del alumno
//
// Hereda dos disparadores del proyecto relacional:
//   carga_academica_revisar_egreso -> cuando el alumno aprueba la ultima
//                                     materia del plan de su carrera,
//                                     queda egresado
//   alumnos_seguir_estatus         -> un alumno egresado o dado de baja
//                                     definitiva ya no entra al portal
//
// Lo que el rediseno hizo mas facil
// ---------------------------------
// En PostgreSQL contar lo que le faltaba al alumno era una junta de
// tres tablas con un "not exists" por cada materia del plan. Aqui son
// dos lecturas: el plan de su carrera, que es un documento, y sus
// inscripciones, que son una por cuatrimestre.
//
// Se cuelga de un Atlas Trigger sobre inscripciones, en update y
// replace, con "Full Document".
// =====================================================================

exports = async function (evento) {
  const inscripcion = evento.fullDocument;
  if (!inscripcion || !Array.isArray(inscripcion.carga)) return;

  // Solo interesa cuando hay alguna materia recien aprobada.
  if (!inscripcion.carga.some((m) => m.estatus === "aprobada")) return;

  const cetia = context.services.get("cetia").db("cetia");
  const usuarios = cetia.collection("usuarios");
  const inscripciones = cetia.collection("inscripciones");
  const planes = cetia.collection("planes_estudio");

  const alumno = await usuarios.findOne({ "perfil_alumno.id_alumno": inscripcion.id_alumno });
  if (!alumno || !alumno.perfil_alumno) return;

  const perfil = alumno.perfil_alumno;

  // Solo se revisa el egreso de quien sigue activo.
  if (perfil.estatus !== "activo") return;

  const plan = await planes.findOne({ id_carrera: perfil.carrera._id });
  if (!plan || !Array.isArray(plan.materias) || plan.materias.length === 0) return;

  // Todas las materias que el alumno ya aprobo, de todos sus cuatrimestres.
  const todas = await inscripciones
    .find({ id_alumno: inscripcion.id_alumno })
    .toArray();

  const aprobadas = new Set();
  todas.forEach((i) =>
    (i.carga || []).forEach((m) => {
      if (m.estatus === "aprobada" && m.materia) aprobadas.add(m.materia._id);
    })
  );

  const faltan = plan.materias.filter((m) => !aprobadas.has(m.id_materia));
  if (faltan.length > 0) return;

  // Ya no le falta ninguna: queda egresado y su cuenta se cierra, que es
  // lo que hacia el disparador alumnos_seguir_estatus.
  await usuarios.updateOne(
    { _id: alumno._id },
    { $set: { "perfil_alumno.estatus": "egresado", activo: false } }
  );

  console.log(`Alumno ${perfil.matricula} marcado como egresado`);
};
