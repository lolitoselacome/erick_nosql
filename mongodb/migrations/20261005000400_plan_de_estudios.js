// =====================================================================
// CETIA - Plan de estudios, aulas y cuatrimestres
//
// Las mismas materias, el mismo plan, las mismas aulas y el mismo
// calendario del proyecto relacional. El plan es tronco comun en los
// cuatrimestres 1 a 3 y especialidad en 4 a 6.
//
// La diferencia con el modelo relacional esta en la forma: alla el plan
// es la tabla intermedia materia_carrera, con un renglon por materia y
// carrera; aqui es un documento por carrera que trae su lista completa de
// materias. Se consulta completo y por carrera, que es la pantalla de
// coordinacion, y asi revisar el egreso es leer un documento en lugar de
// una junta de tres tablas.
//
// El calendario escolar tambien cambia de forma: alla es su propia tabla
// con una llave al cuatrimestre, aqui va dentro del cuatrimestre, porque
// nunca se consulta sin el y asi saber si la captura esta abierta es leer
// un solo documento.
// =====================================================================

const { ObjectId } = require('mongodb');

const MATERIAS = [
  // Tronco comun
  ['TC101', 'Matemáticas I', 7, 4],
  ['TC102', 'Comunicación y Lenguaje', 5, 3],
  ['TC103', 'Química', 6, 4],
  ['TC104', 'Inglés I', 5, 3],
  ['TC105', 'Informática Básica', 5, 3],
  ['TC201', 'Matemáticas II', 7, 4],
  ['TC202', 'Física I', 6, 4],
  ['TC203', 'Biología', 5, 3],
  ['TC204', 'Inglés II', 5, 3],
  ['TC205', 'Ética y Valores', 4, 3],
  ['TC301', 'Matemáticas III', 7, 4],
  ['TC302', 'Física II', 6, 4],
  ['TC303', 'Metodología de la Investigación', 5, 3],
  ['TC304', 'Inglés III', 5, 3],
  ['TC305', 'Emprendimiento', 4, 3],
  ['TC401', 'Inglés IV', 5, 3],
  ['TC402', 'Probabilidad y Estadística', 6, 4],
  ['TC501', 'Inglés V', 5, 3],
  ['TC502', 'Desarrollo Humano', 4, 3],
  ['TC601', 'Inglés VI', 5, 3],
  ['TC602', 'Prácticas Profesionales', 8, 5],
  // Administracion
  ['AD401', 'Fundamentos de Administración', 6, 4],
  ['AD402', 'Contabilidad I', 6, 4],
  ['AD403', 'Derecho Laboral', 5, 3],
  ['AD501', 'Contabilidad II', 6, 4],
  ['AD502', 'Administración de Recursos Humanos', 6, 4],
  ['AD503', 'Mercadotecnia', 5, 3],
  ['AD601', 'Costos y Presupuestos', 6, 4],
  ['AD602', 'Administración de Pequeñas Empresas', 6, 4],
  ['AD603', 'Proyecto Integrador de Administración', 8, 5],
  // Tecnologias de la Informacion
  ['TI401', 'Programación Básica', 7, 5],
  ['TI402', 'Arquitectura de Computadoras', 5, 3],
  ['TI403', 'Diseño de Páginas Web', 6, 4],
  ['TI501', 'Programación Orientada a Objetos', 7, 5],
  ['TI502', 'Bases de Datos', 7, 5],
  ['TI503', 'Redes de Computadoras', 6, 4],
  ['TI601', 'Desarrollo de Aplicaciones Web', 7, 5],
  ['TI602', 'Seguridad Informática', 6, 4],
  ['TI603', 'Proyecto Integrador de Tecnologías de la Información', 8, 5],
];

// [clave de materia, clave de carrera, cuatrimestre, clave de la materia requisito]
const PLAN = [
  // Tronco comun, cuatrimestres 1 a 3: igual en las dos carreras
  ['TC101', 'ADM', 1, null], ['TC102', 'ADM', 1, null], ['TC103', 'ADM', 1, null],
  ['TC104', 'ADM', 1, null], ['TC105', 'ADM', 1, null],
  ['TC101', 'TI', 1, null], ['TC102', 'TI', 1, null], ['TC103', 'TI', 1, null],
  ['TC104', 'TI', 1, null], ['TC105', 'TI', 1, null],

  ['TC201', 'ADM', 2, 'TC101'], ['TC202', 'ADM', 2, null], ['TC203', 'ADM', 2, null],
  ['TC204', 'ADM', 2, 'TC104'], ['TC205', 'ADM', 2, null],
  ['TC201', 'TI', 2, 'TC101'], ['TC202', 'TI', 2, null], ['TC203', 'TI', 2, null],
  ['TC204', 'TI', 2, 'TC104'], ['TC205', 'TI', 2, null],

  ['TC301', 'ADM', 3, 'TC201'], ['TC302', 'ADM', 3, 'TC202'], ['TC303', 'ADM', 3, null],
  ['TC304', 'ADM', 3, 'TC204'], ['TC305', 'ADM', 3, null],
  ['TC301', 'TI', 3, 'TC201'], ['TC302', 'TI', 3, 'TC202'], ['TC303', 'TI', 3, null],
  ['TC304', 'TI', 3, 'TC204'], ['TC305', 'TI', 3, null],

  // Cuatrimestres 4 a 6: dos materias comunes y tres de la especialidad
  ['TC401', 'ADM', 4, 'TC304'], ['TC402', 'ADM', 4, 'TC301'],
  ['AD401', 'ADM', 4, null], ['AD402', 'ADM', 4, null], ['AD403', 'ADM', 4, null],
  ['TC501', 'ADM', 5, 'TC401'], ['TC502', 'ADM', 5, null],
  ['AD501', 'ADM', 5, 'AD402'], ['AD502', 'ADM', 5, 'AD401'], ['AD503', 'ADM', 5, null],
  ['TC601', 'ADM', 6, 'TC501'], ['TC602', 'ADM', 6, null],
  ['AD601', 'ADM', 6, 'AD501'], ['AD602', 'ADM', 6, 'AD502'], ['AD603', 'ADM', 6, 'AD501'],

  ['TC401', 'TI', 4, 'TC304'], ['TC402', 'TI', 4, 'TC301'],
  ['TI401', 'TI', 4, 'TC105'], ['TI402', 'TI', 4, null], ['TI403', 'TI', 4, null],
  ['TC501', 'TI', 5, 'TC401'], ['TC502', 'TI', 5, null],
  ['TI501', 'TI', 5, 'TI401'], ['TI502', 'TI', 5, 'TI401'], ['TI503', 'TI', 5, 'TI402'],
  ['TC601', 'TI', 6, 'TC501'], ['TC602', 'TI', 6, null],
  ['TI601', 'TI', 6, 'TI501'], ['TI602', 'TI', 6, 'TI503'], ['TI603', 'TI', 6, 'TI502'],
];

const AULAS = [
  ['A-101', 'Aula 101', 'aula', 40],
  ['A-102', 'Aula 102', 'aula', 40],
  ['A-103', 'Aula 103', 'aula', 40],
  ['A-104', 'Aula 104', 'aula', 40],
  ['A-105', 'Aula 105', 'aula', 35],
  ['A-106', 'Aula 106', 'aula', 35],
  ['LAB-1', 'Laboratorio de Cómputo 1', 'laboratorio', 30],
  ['LAB-2', 'Laboratorio de Cómputo 2', 'laboratorio', 30],
  ['LAB-3', 'Laboratorio de Ciencias', 'laboratorio', 30],
  ['TAL-1', 'Taller de Emprendimiento', 'taller', 30],
];

// El cuatrimestre en curso y el que sigue, con su calendario dentro.
// La reinscripcion al que sigue se abre antes de que empiece, por eso su
// ventana cae dentro del cuatrimestre anterior.
const PERIODOS = [
  {
    clave: '2026-3',
    nombre: 'Septiembre - Diciembre 2026',
    anio: 2026,
    numero: 3,
    fecha_inicio: new Date('2026-09-07T00:00:00-06:00'),
    fecha_fin: new Date('2026-12-19T00:00:00-06:00'),
    actual: true,
    calendario: [
      ['captura_parcial_1', 'Captura del primer parcial', '2026-09-28T08:00:00-06:00', '2026-10-09T22:00:00-06:00'],
      ['captura_parcial_2', 'Captura del segundo parcial', '2026-10-26T08:00:00-06:00', '2026-11-06T22:00:00-06:00'],
      ['captura_parcial_3', 'Captura del tercer parcial', '2026-11-23T08:00:00-06:00', '2026-12-04T22:00:00-06:00'],
      ['captura_final', 'Captura de calificación final', '2026-12-07T08:00:00-06:00', '2026-12-11T22:00:00-06:00'],
      ['extraordinario', 'Exámenes extraordinarios', '2026-12-14T08:00:00-06:00', '2026-12-18T22:00:00-06:00'],
    ],
  },
  {
    clave: '2027-1',
    nombre: 'Enero - Abril 2027',
    anio: 2027,
    numero: 1,
    fecha_inicio: new Date('2027-01-11T00:00:00-06:00'),
    fecha_fin: new Date('2027-04-30T00:00:00-06:00'),
    actual: false,
    calendario: [
      ['reinscripcion', 'Reinscripción al cuatrimestre Enero - Abril 2027', '2026-09-01T08:00:00-06:00', '2026-12-20T22:00:00-06:00'],
    ],
  },
];

module.exports = {
  descripcion: 'Materias, el plan de estudios de las dos carreras, las aulas y los cuatrimestres',

  async aplicar(db) {
    // ----- Materias -----
    for (const [clave, nombre, creditos, horas_semana] of MATERIAS) {
      await db.collection('materias').updateOne(
        { clave },
        { $set: { clave, nombre, creditos, horas_semana, activa: true } },
        { upsert: true }
      );
    }

    // ----- Aulas -----
    for (const [clave, nombre, tipo, capacidad] of AULAS) {
      await db.collection('aulas').updateOne(
        { clave },
        { $set: { clave, nombre, tipo, capacidad, activa: true } },
        { upsert: true }
      );
    }

    // ----- Cuatrimestres con su calendario dentro -----
    for (const p of PERIODOS) {
      const calendario = p.calendario.map(([tipo_evento, descripcion, inicio, fin]) => ({
        _id: new ObjectId(),
        tipo_evento,
        descripcion,
        fecha_inicio: new Date(inicio),
        fecha_fin: new Date(fin),
        activo: true,
      }));

      await db.collection('periodos').updateOne(
        { clave: p.clave },
        {
          $set: {
            clave: p.clave,
            nombre: p.nombre,
            anio: p.anio,
            numero: p.numero,
            fecha_inicio: p.fecha_inicio,
            fecha_fin: p.fecha_fin,
            actual: p.actual,
            calendario,
          },
        },
        { upsert: true }
      );
    }

    // ----- El plan de estudios: un documento por carrera -----
    const materias = await db.collection('materias').find({}).toArray();
    const porClave = new Map(materias.map((m) => [m.clave, m]));

    const carreras = await db.collection('carreras').find({}).toArray();

    for (const carrera of carreras) {
      const renglones = PLAN.filter(([, claveCarrera]) => claveCarrera === carrera.clave);

      const lista = renglones.map(([claveMateria, , cuatrimestre, claveRequisito]) => {
        const materia = porClave.get(claveMateria);
        if (!materia) {
          throw new Error(`El plan de ${carrera.clave} usa la materia ${claveMateria}, que no existe`);
        }

        let id_materia_requisito = null;
        if (claveRequisito) {
          const requisito = porClave.get(claveRequisito);
          if (!requisito) {
            throw new Error(`La materia ${claveMateria} pide el requisito ${claveRequisito}, que no existe`);
          }
          id_materia_requisito = requisito._id;
        }

        return {
          id_materia: materia._id,
          clave: materia.clave,
          nombre: materia.nombre,
          cuatrimestre,
          id_materia_requisito,
        };
      });

      // Ordenado por cuatrimestre y clave, que es como se muestra el plan
      lista.sort((a, b) => a.cuatrimestre - b.cuatrimestre || a.clave.localeCompare(b.clave));

      await db.collection('planes_estudio').updateOne(
        { id_carrera: carrera._id },
        { $set: { id_carrera: carrera._id, materias: lista } },
        { upsert: true }
      );
    }
  },
};
