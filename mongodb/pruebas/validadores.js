// =====================================================================
// CETIA - Pruebas de los validadores y de los indices unicos
//
// En PostgreSQL las reglas las imponia el motor y no se podian saltar.
// En MongoDB solo conservan esa propiedad la forma de los campos y la
// unicidad, asi que estas pruebas existen para demostrar que esa parte
// de verdad quedo impuesta por la base y no por el codigo que la llama.
//
// Cada prueba escribe en una base aparte que se borra al terminar, asi
// que no tocan los datos de nadie.
//
//   docker compose --profile pruebas run --rm pruebas
// =====================================================================

const path = require('path');
const fs = require('fs');
const { MongoClient, ObjectId } = require('mongodb');

const CARPETA_MIGRACIONES = path.join(__dirname, '..', 'migrations');

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

let pasadas = 0;
let falladas = 0;

function ok(nombre) {
  pasadas += 1;
  console.log(`  ok    ${nombre}`);
}

function falla(nombre, detalle) {
  falladas += 1;
  console.log(`  FALLA ${nombre}`);
  console.log(`        ${detalle}`);
}

// La base debe rechazar la escritura. Si la acepta, la regla no existe.
async function rechaza(nombre, accion) {
  try {
    await accion();
    falla(nombre, 'la base acepto el documento y deberia haberlo rechazado');
  } catch (error) {
    ok(nombre);
  }
}

// La base debe aceptar la escritura.
async function acepta(nombre, accion) {
  try {
    await accion();
    ok(nombre);
  } catch (error) {
    falla(nombre, `la base rechazo un documento valido: ${error.message}`);
  }
}

// ---------------------------------------------------------------------
// Documentos validos de los que parten las pruebas. Cada prueba toma uno
// y le estropea un solo campo, para que quede claro que lo que falla es
// ese campo y no otra cosa.
// ---------------------------------------------------------------------

const idCarrera = new ObjectId();
const idTurno = new ObjectId();
const idPeriodo = new ObjectId();
const idMateria = new ObjectId();

const refCarrera = { _id: idCarrera, clave: 'TI', nombre: 'Tecnologías de la Información' };
const refTurno = { _id: idTurno, nombre: 'Matutino', hora_inicio: '07:00', hora_fin: '14:00' };
const refMateria = { _id: idMateria, clave: 'TC101', nombre: 'Matemáticas I', horas_semana: 4 };

function alumnoValido(extra = {}) {
  return {
    rol: 'alumno',
    nombre: 'Ana',
    apellido_paterno: 'Lopez',
    correo: `ana${Math.random().toString(36).slice(2)}@cetia.edu.mx`,
    activo: true,
    fecha_creacion: new Date(),
    perfil_alumno: {
      matricula: String(Math.floor(1400000000 + Math.random() * 99999999)),
      curp: 'LOPA060101HDFNNA01',
      sexo: 'M',
      fecha_nacimiento: new Date('2006-01-01'),
      carrera: refCarrera,
      turno: refTurno,
      cuatrimestre_actual: 1,
      id_periodo_ingreso: idPeriodo,
      fecha_ingreso: new Date(),
      estatus: 'activo',
      expediente: [
        'acta_nacimiento',
        'curp',
        'certificado_secundaria',
        'comprobante_domicilio',
        'fotografias',
        'nss',
      ].map((tipo) => ({ tipo, estatus: 'pendiente' })),
      ...extra,
    },
  };
}

function grupoValido(extra = {}) {
  return {
    clave: `TI-1A-${Math.random().toString(36).slice(2, 6)}`,
    carrera: refCarrera,
    turno: refTurno,
    id_periodo: idPeriodo,
    cuatrimestre: 1,
    cupo: 35,
    activo: true,
    asignaciones: [
      {
        _id: new ObjectId(),
        materia: refMateria,
        id_docente: null,
        estatus_captura: 'cerrada',
        captura_manual: false,
        horarios: [
          {
            _id: new ObjectId(),
            id_aula: new ObjectId(),
            dia_semana: 1,
            hora_inicio: '07:00',
            hora_fin: '09:00',
          },
        ],
      },
    ],
    ...extra,
  };
}

function inscripcionValida(extra = {}) {
  return {
    id_alumno: new ObjectId(),
    id_periodo: idPeriodo,
    id_grupo: new ObjectId(),
    cuatrimestre: 1,
    tipo: 'reinscripcion',
    estatus: 'aprobada',
    fecha_solicitud: new Date(),
    carga: [
      {
        _id: new ObjectId(),
        id_asignacion: new ObjectId(),
        materia: refMateria,
        tipo_curso: 'normal',
        estatus: 'cursando',
        calificaciones: [
          { tipo: 'parcial_1', calificacion: 8, fecha_captura: new Date() },
        ],
      },
    ],
    ...extra,
  };
}

function periodoValido(extra = {}) {
  return {
    clave: `9999-${Math.floor(Math.random() * 3) + 1}`,
    nombre: 'Prueba',
    anio: 2099,
    numero: 1,
    fecha_inicio: new Date('2099-01-01'),
    fecha_fin: new Date('2099-04-30'),
    actual: false,
    calendario: [],
    ...extra,
  };
}

// ---------------------------------------------------------------------
// Las pruebas
// ---------------------------------------------------------------------

async function pruebasCatalogos(db) {
  console.log('\nCatalogos');

  await rechaza('carrera sin clave de matricula', () =>
    db.collection('carreras').insertOne({ clave: 'X', nombre: 'X', activa: true })
  );

  await rechaza('carrera con clave de matricula mal formada', () =>
    db
      .collection('carreras')
      .insertOne({ clave: 'X', clave_matricula: '99', nombre: 'X', activa: true })
  );

  await rechaza('turno que termina antes de empezar', () =>
    db.collection('turnos').insertOne({ nombre: 'Raro', hora_inicio: '14:00', hora_fin: '07:00' })
  );

  await rechaza('turno con hora inventada', () =>
    db.collection('turnos').insertOne({ nombre: 'Raro2', hora_inicio: '25:00', hora_fin: '26:00' })
  );

  await rechaza('cuatrimestre que termina antes de empezar', () =>
    db.collection('periodos').insertOne(
      periodoValido({ fecha_inicio: new Date('2099-05-01'), fecha_fin: new Date('2099-01-01') })
    )
  );

  await rechaza('cuatrimestre con numero fuera de 1 a 3', () =>
    db.collection('periodos').insertOne(periodoValido({ numero: 4 }))
  );

  await rechaza('evento del calendario que termina antes de empezar', () =>
    db.collection('periodos').insertOne(
      periodoValido({
        calendario: [
          {
            _id: new ObjectId(),
            tipo_evento: 'captura_final',
            fecha_inicio: new Date('2099-03-01'),
            fecha_fin: new Date('2099-02-01'),
            activo: true,
          },
        ],
      })
    )
  );

  await rechaza('evento del calendario con tipo inventado', () =>
    db.collection('periodos').insertOne(
      periodoValido({
        calendario: [
          {
            _id: new ObjectId(),
            tipo_evento: 'captura_parcial_9',
            fecha_inicio: new Date('2099-02-01'),
            fecha_fin: new Date('2099-03-01'),
            activo: true,
          },
        ],
      })
    )
  );

  await rechaza('aula con capacidad cero', () =>
    db
      .collection('aulas')
      .insertOne({ clave: 'Z-1', nombre: 'Z', tipo: 'aula', capacidad: 0, activa: true })
  );

  await rechaza('aula con tipo inventado', () =>
    db
      .collection('aulas')
      .insertOne({ clave: 'Z-2', nombre: 'Z', tipo: 'gimnasio', capacidad: 10, activa: true })
  );

  await acepta('cuatrimestre valido', () =>
    db.collection('periodos').insertOne(periodoValido({ clave: '9999-9' }))
  );
}

async function pruebasUsuarios(db) {
  console.log('\nUsuarios: el rol y su perfil');

  await acepta('alumno valido', () => db.collection('usuarios').insertOne(alumnoValido()));

  await rechaza('alumno sin perfil de alumno', () => {
    const u = alumnoValido();
    delete u.perfil_alumno;
    return db.collection('usuarios').insertOne(u);
  });

  await rechaza('administrador con perfil de alumno', () =>
    db.collection('usuarios').insertOne({ ...alumnoValido(), rol: 'administrador' })
  );

  await rechaza('coordinador sin carrera asignada', () =>
    db.collection('usuarios').insertOne({
      rol: 'coordinador',
      nombre: 'Luis',
      apellido_paterno: 'Perez',
      correo: 'coord1@cetia.edu.mx',
      activo: true,
      fecha_creacion: new Date(),
    })
  );

  await rechaza('docente con carrera asignada', () =>
    db.collection('usuarios').insertOne({
      rol: 'docente',
      nombre: 'Luis',
      apellido_paterno: 'Perez',
      correo: 'doc1@cetia.edu.mx',
      activo: true,
      fecha_creacion: new Date(),
      id_carrera: idCarrera,
      perfil_docente: { numero_empleado: '90260001', activo: true },
    })
  );

  await acepta('coordinador con su carrera', () =>
    db.collection('usuarios').insertOne({
      rol: 'coordinador',
      nombre: 'Luis',
      apellido_paterno: 'Perez',
      correo: 'coord2@cetia.edu.mx',
      activo: true,
      fecha_creacion: new Date(),
      id_carrera: idCarrera,
      numero_coordinador: '91260001',
    })
  );

  await rechaza('matricula que no son diez digitos', () =>
    db.collection('usuarios').insertOne(alumnoValido({ matricula: '123' }))
  );

  await rechaza('matricula que empieza en nueve', () =>
    db.collection('usuarios').insertOne(alumnoValido({ matricula: '9426010001' }))
  );

  await rechaza('CURP que no tiene dieciocho caracteres', () =>
    db.collection('usuarios').insertOne(alumnoValido({ curp: 'CORTA' }))
  );

  await rechaza('sexo distinto de H o M', () =>
    db.collection('usuarios').insertOne(alumnoValido({ sexo: 'X' }))
  );

  await rechaza('cuatrimestre fuera de 1 a 12', () =>
    db.collection('usuarios').insertOne(alumnoValido({ cuatrimestre_actual: 13 }))
  );

  await rechaza('estatus de alumno inventado', () =>
    db.collection('usuarios').insertOne(alumnoValido({ estatus: 'suspendido' }))
  );

  await rechaza('promedio de secundaria mayor que diez', () =>
    db
      .collection('usuarios')
      .insertOne(alumnoValido({ secundaria: { escuela_procedencia: 'X', promedio: 11 } }))
  );

  await rechaza('codigo postal que no son cinco digitos', () =>
    db.collection('usuarios').insertOne(alumnoValido({ domicilio: { codigo_postal: '123' } }))
  );

  await rechaza('correo sin forma de correo', () =>
    db.collection('usuarios').insertOne({ ...alumnoValido(), correo: 'no-es-correo' })
  );

  await rechaza('campo que no existe en el modelo', () =>
    db.collection('usuarios').insertOne({ ...alumnoValido(), apodo: 'Anita' })
  );

  console.log('\nUsuarios: el expediente dentro del alumno');

  await rechaza('expediente con menos de seis documentos', () =>
    db.collection('usuarios').insertOne(
      alumnoValido({ expediente: [{ tipo: 'curp', estatus: 'pendiente' }] })
    )
  );

  await rechaza('expediente con un tipo de documento inventado', () => {
    const u = alumnoValido();
    u.perfil_alumno.expediente[0].tipo = 'pasaporte';
    return db.collection('usuarios').insertOne(u);
  });

  await rechaza('documento del expediente con estatus inventado', () => {
    const u = alumnoValido();
    u.perfil_alumno.expediente[0].estatus = 'extraviado';
    return db.collection('usuarios').insertOne(u);
  });
}

async function pruebasGrupos(db) {
  console.log('\nGrupos con sus materias y su horario dentro');

  await acepta('grupo valido', () => db.collection('grupos').insertOne(grupoValido()));

  await rechaza('grupo con cupo cero', () =>
    db.collection('grupos').insertOne(grupoValido({ cupo: 0 }))
  );

  await rechaza('grupo con cuatrimestre fuera de 1 a 12', () =>
    db.collection('grupos').insertOne(grupoValido({ cuatrimestre: 0 }))
  );

  await rechaza('dia de la semana fuera de 1 a 6', () => {
    const g = grupoValido();
    g.asignaciones[0].horarios[0].dia_semana = 7;
    return db.collection('grupos').insertOne(g);
  });

  await rechaza('hora de clase mal formada', () => {
    const g = grupoValido();
    g.asignaciones[0].horarios[0].hora_inicio = '7am';
    return db.collection('grupos').insertOne(g);
  });

  await rechaza('estatus de captura inventado', () => {
    const g = grupoValido();
    g.asignaciones[0].estatus_captura = 'pendiente';
    return db.collection('grupos').insertOne(g);
  });

  await rechaza('asignacion sin la marca de captura manual', () => {
    const g = grupoValido();
    delete g.asignaciones[0].captura_manual;
    return db.collection('grupos').insertOne(g);
  });
}

async function pruebasInscripciones(db) {
  console.log('\nInscripciones con su carga y sus calificaciones dentro');

  await acepta('inscripcion valida', () =>
    db.collection('inscripciones').insertOne(inscripcionValida())
  );

  await rechaza('calificacion mayor que diez', () => {
    const i = inscripcionValida();
    i.carga[0].calificaciones[0].calificacion = 11;
    return db.collection('inscripciones').insertOne(i);
  });

  await rechaza('calificacion negativa', () => {
    const i = inscripcionValida();
    i.carga[0].calificaciones[0].calificacion = -1;
    return db.collection('inscripciones').insertOne(i);
  });

  await rechaza('tipo de calificacion inventado', () => {
    const i = inscripcionValida();
    i.carga[0].calificaciones[0].tipo = 'parcial_4';
    return db.collection('inscripciones').insertOne(i);
  });

  await rechaza('mas de cinco calificaciones en una materia', () => {
    const i = inscripcionValida();
    i.carga[0].calificaciones = [
      'parcial_1',
      'parcial_2',
      'parcial_3',
      'final',
      'extraordinario',
      'parcial_1',
    ].map((tipo) => ({ tipo, calificacion: 8, fecha_captura: new Date() }));
    return db.collection('inscripciones').insertOne(i);
  });

  await rechaza('estatus de inscripcion inventado', () =>
    db.collection('inscripciones').insertOne(inscripcionValida({ estatus: 'en_tramite' }))
  );

  await rechaza('tipo de curso inventado', () => {
    const i = inscripcionValida();
    i.carga[0].tipo_curso = 'nivelacion';
    return db.collection('inscripciones').insertOne(i);
  });
}

async function pruebasTramitesYAvisos(db) {
  console.log('\nTramites, avisos y bitacora');

  await rechaza('tramite con tipo inventado', () =>
    db.collection('tramites').insertOne({
      id_alumno: new ObjectId(),
      tipo: 'titulo',
      estatus: 'solicitado',
      fecha_solicitud: new Date(),
    })
  );

  await rechaza('tramite con estatus inventado', () =>
    db.collection('tramites').insertOne({
      id_alumno: new ObjectId(),
      tipo: 'kardex',
      estatus: 'perdido',
      fecha_solicitud: new Date(),
    })
  );

  await rechaza('aviso dirigido a un rol que no existe', () =>
    db.collection('avisos').insertOne({
      titulo: 'X',
      contenido: 'X',
      rol_destino: 'director',
      publicado_por: new ObjectId(),
      fecha_publicacion: new Date(),
      activo: true,
    })
  );

  await acepta('aviso para todos, sin rol destino', () =>
    db.collection('avisos').insertOne({
      titulo: 'X',
      contenido: 'X',
      rol_destino: null,
      publicado_por: new ObjectId(),
      fecha_publicacion: new Date(),
      activo: true,
    })
  );

  await rechaza('movimiento de bitacora con accion inventada', () =>
    db.collection('bitacora').insertOne({
      accion: 'TRUNCATE',
      coleccion: 'usuarios',
      fecha_hora: new Date(),
    })
  );
}

async function pruebasUnicidad(db) {
  console.log('\nUnicidad');

  const a = alumnoValido();
  await db.collection('usuarios').insertOne(a);

  await rechaza('dos alumnos con la misma matricula', () => {
    const otro = alumnoValido({ matricula: a.perfil_alumno.matricula });
    return db.collection('usuarios').insertOne(otro);
  });

  await rechaza('dos alumnos con la misma CURP', () => {
    const otro = alumnoValido({ curp: a.perfil_alumno.curp });
    return db.collection('usuarios').insertOne(otro);
  });

  await rechaza('dos cuentas con el mismo correo', () =>
    db.collection('usuarios').insertOne({ ...alumnoValido(), correo: a.correo })
  );

  await acepta('dos docentes sin CURP capturada', async () => {
    for (const n of ['90260101', '90260102']) {
      await db.collection('usuarios').insertOne({
        rol: 'docente',
        nombre: 'D',
        apellido_paterno: 'D',
        correo: `d${n}@cetia.edu.mx`,
        activo: true,
        fecha_creacion: new Date(),
        perfil_docente: { numero_empleado: n, curp: null, rfc: null, activo: true },
      });
    }
  });

  const g = grupoValido();
  await db.collection('grupos').insertOne(g);

  await rechaza('dos grupos con la misma clave en el mismo cuatrimestre', () =>
    db.collection('grupos').insertOne(grupoValido({ clave: g.clave }))
  );

  await acepta('la misma clave de grupo en otro cuatrimestre', () =>
    db.collection('grupos').insertOne(grupoValido({ clave: g.clave, id_periodo: new ObjectId() }))
  );

  const i = inscripcionValida();
  await db.collection('inscripciones').insertOne(i);

  await rechaza('dos inscripciones del mismo alumno en el mismo cuatrimestre', () =>
    db.collection('inscripciones').insertOne(
      inscripcionValida({ id_alumno: i.id_alumno, id_periodo: i.id_periodo })
    )
  );

  await db.collection('periodos').insertOne(periodoValido({ clave: 'U-1', actual: true }));

  await rechaza('dos cuatrimestres marcados como actual', () =>
    db.collection('periodos').insertOne(periodoValido({ clave: 'U-2', actual: true }))
  );

  await acepta('varios cuatrimestres no actuales', async () => {
    await db.collection('periodos').insertOne(periodoValido({ clave: 'U-3', actual: false }));
    await db.collection('periodos').insertOne(periodoValido({ clave: 'U-4', actual: false }));
  });
}

async function pruebaTransacciones(cliente, db) {
  console.log('\nTransacciones');

  // Varias reglas de este modelo necesitan leer y escribir en la misma
  // transaccion, asi que conviene comprobar que la base las acepta.
  const sesion = cliente.startSession();
  try {
    await sesion.withTransaction(async () => {
      await db.collection('avisos').insertOne(
        {
          titulo: 'En transaccion',
          contenido: 'X',
          rol_destino: null,
          publicado_por: new ObjectId(),
          fecha_publicacion: new Date(),
          activo: true,
        },
        { session: sesion }
      );
      throw new Error('deshacer a proposito');
    });
    falla('la transaccion se deshace', 'no se deshizo');
  } catch (error) {
    if (error.message === 'deshacer a proposito') {
      const quedo = await db.collection('avisos').countDocuments({ titulo: 'En transaccion' });
      if (quedo === 0) ok('la transaccion se deshace y no deja rastro');
      else falla('la transaccion se deshace', `quedaron ${quedo} documentos`);
    } else {
      falla('la transaccion se deshace', error.message);
    }
  } finally {
    await sesion.endSession();
  }
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Falta MONGODB_URI');

  // Base aparte para las pruebas: se crea, se usa y se borra.
  const nombreBase = `cetia_pruebas_${Date.now()}`;
  const cliente = new MongoClient(uri);
  await cliente.connect();

  try {
    const db = cliente.db(nombreBase);

    console.log(`Base de pruebas: ${nombreBase}`);
    console.log('Aplicando el modelo...');

    const archivos = fs
      .readdirSync(CARPETA_MIGRACIONES)
      .filter((n) => n.endsWith('.js'))
      .sort();

    for (const archivo of archivos) {
      const migracion = require(path.join(CARPETA_MIGRACIONES, archivo));
      await migracion.aplicar(db);
    }

    console.log(`Modelo aplicado (${archivos.length} migraciones)`);

    await pruebasCatalogos(db);
    await pruebasUsuarios(db);
    await pruebasGrupos(db);
    await pruebasInscripciones(db);
    await pruebasTramitesYAvisos(db);
    await pruebasUnicidad(db);
    await pruebaTransacciones(cliente, db);

    console.log(`\n${pasadas + falladas} pruebas: ${pasadas} pasaron, ${falladas} fallaron`);

    await cliente.db(nombreBase).dropDatabase();
    console.log(`Base de pruebas ${nombreBase} borrada`);

    if (falladas > 0) process.exitCode = 1;
  } finally {
    await cliente.close();
  }
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});
