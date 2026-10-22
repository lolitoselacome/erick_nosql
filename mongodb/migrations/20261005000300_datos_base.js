// =====================================================================
// CETIA - Datos base
//
// Las dos carreras y los dos turnos de la preparatoria, iguales a los del
// proyecto relacional. La clave de matricula son los dos digitos con los
// que empieza la matricula del alumno: 13 Administracion y 14 Tecnologias
// de la Informacion.
//
// Se aplica con upsert sobre la clave, asi que correrla dos veces no
// duplica nada.
// =====================================================================

const CARRERAS = [
  { clave: 'ADM', clave_matricula: '13', nombre: 'Administración', activa: true },
  { clave: 'TI', clave_matricula: '14', nombre: 'Tecnologías de la Información', activa: true },
];

const TURNOS = [
  { nombre: 'Matutino', hora_inicio: '07:00', hora_fin: '14:00' },
  { nombre: 'Vespertino', hora_inicio: '14:00', hora_fin: '21:00' },
];

module.exports = {
  descripcion: 'Las dos carreras y los dos turnos',

  async aplicar(db) {
    for (const carrera of CARRERAS) {
      await db
        .collection('carreras')
        .updateOne({ clave: carrera.clave }, { $set: carrera }, { upsert: true });
    }

    for (const turno of TURNOS) {
      await db
        .collection('turnos')
        .updateOne({ nombre: turno.nombre }, { $set: turno }, { upsert: true });
    }
  },
};
