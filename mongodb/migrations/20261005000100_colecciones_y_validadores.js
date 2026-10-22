// =====================================================================
// CETIA - Colecciones y validadores de esquema
//
// Las veinte tablas del modelo relacional quedan en doce colecciones.
// Las ocho que desaparecen se vuelven arreglos dentro del documento al
// que pertenecen:
//
//   calendario_escolar  ->  dentro de periodos
//   materia_carrera     ->  se vuelve planes_estudio, uno por carrera
//   alumnos, docentes   ->  dentro de usuarios, como perfil del rol
//   documentos          ->  dentro del perfil del alumno
//   asignaciones        ->  dentro de grupos
//   horarios            ->  dentro de cada asignacion del grupo
//   carga_academica     ->  dentro de inscripciones
//   calificaciones      ->  dentro de cada materia de la carga
//
// Los validadores son los herederos de los not null, los check y los
// tipos de PostgreSQL. Van en modo estricto y rechazando la escritura,
// porque son la unica capa que nada puede esquivar. Los mensajes que ve
// la persona los da la capa de datos, que valida antes; el validador es
// la red por si algo pasa de largo.
//
// El detalle de por que se embebe cada cosa esta en
// docs/modelo-de-documentos.md
// =====================================================================

const ROLES = ['administrador', 'coordinador', 'docente', 'alumno'];

const TIPOS_DOCUMENTO = [
  'acta_nacimiento',
  'curp',
  'certificado_secundaria',
  'comprobante_domicilio',
  'fotografias',
  'nss',
];

const TIPOS_EVENTO = [
  'reinscripcion',
  'captura_parcial_1',
  'captura_parcial_2',
  'captura_parcial_3',
  'captura_final',
  'extraordinario',
];

const TIPOS_CALIFICACION = ['parcial_1', 'parcial_2', 'parcial_3', 'final', 'extraordinario'];

const TIPOS_TRAMITE = [
  'constancia_estudios',
  'constancia_calificaciones',
  'kardex',
  'historial_academico',
  'credencial',
  'carta_pasante',
];

// Una hora del dia como "07:00". BSON no tiene tipo hora, asi que va como
// texto con formato fijo, que ademas se compara y se ordena bien.
const HORA = { bsonType: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' };

const CUATRIMESTRE = { bsonType: 'int', minimum: 1, maximum: 12 };
const CALIFICACION = { bsonType: 'number', minimum: 0, maximum: 10 };

// Copia de lectura de la carrera y del turno. La verdad sigue en su
// coleccion; esto evita ir a buscarla en cada lectura.
const REF_CARRERA = {
  bsonType: 'object',
  required: ['_id', 'clave', 'nombre'],
  additionalProperties: false,
  properties: {
    _id: { bsonType: 'objectId' },
    clave: { bsonType: 'string' },
    nombre: { bsonType: 'string' },
  },
};

const REF_TURNO = {
  bsonType: 'object',
  required: ['_id', 'nombre'],
  additionalProperties: false,
  properties: {
    _id: { bsonType: 'objectId' },
    nombre: { bsonType: 'string' },
    hora_inicio: HORA,
    hora_fin: HORA,
  },
};

const REF_MATERIA = {
  bsonType: 'object',
  required: ['_id', 'clave', 'nombre'],
  additionalProperties: false,
  properties: {
    _id: { bsonType: 'objectId' },
    clave: { bsonType: 'string' },
    nombre: { bsonType: 'string' },
    horas_semana: { bsonType: 'int', minimum: 1 },
  },
};

// ---------------------------------------------------------------------
// Catalogos
// ---------------------------------------------------------------------

const carreras = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['clave', 'clave_matricula', 'nombre', 'activa'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      clave: { bsonType: 'string', minLength: 1 },
      // Los dos digitos con los que empieza la matricula del alumno:
      // 13 Administracion, 14 Tecnologias de la Informacion.
      clave_matricula: { bsonType: 'string', pattern: '^[1-8][0-9]$' },
      nombre: { bsonType: 'string', minLength: 1 },
      activa: { bsonType: 'bool' },
    },
  },
};

const turnos = {
  $and: [
    {
      $jsonSchema: {
        bsonType: 'object',
        required: ['nombre', 'hora_inicio', 'hora_fin'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'objectId' },
          nombre: { bsonType: 'string', minLength: 1 },
          hora_inicio: HORA,
          hora_fin: HORA,
        },
      },
    },
    // turnos_horas_validas: hora_fin > hora_inicio
    { $expr: { $gt: ['$hora_fin', '$hora_inicio'] } },
  ],
};

// periodos se lleva dentro su calendario escolar: son seis tipos de evento
// por cuatrimestre, nunca se consultan sin su cuatrimestre y hoy ya se
// borran con el. Asi, saber si la captura esta abierta es leer un documento.
const periodos = {
  $and: [
    {
      $jsonSchema: {
        bsonType: 'object',
        required: ['clave', 'nombre', 'anio', 'numero', 'fecha_inicio', 'fecha_fin', 'actual'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'objectId' },
          clave: { bsonType: 'string', minLength: 1 },
          nombre: { bsonType: 'string', minLength: 1 },
          anio: { bsonType: 'int', minimum: 2000, maximum: 2099 },
          // 1 enero-abril, 2 mayo-agosto, 3 septiembre-diciembre
          numero: { bsonType: 'int', minimum: 1, maximum: 3 },
          fecha_inicio: { bsonType: 'date' },
          fecha_fin: { bsonType: 'date' },
          actual: { bsonType: 'bool' },
          calendario: {
            bsonType: 'array',
            items: {
              bsonType: 'object',
              required: ['_id', 'tipo_evento', 'fecha_inicio', 'fecha_fin', 'activo'],
              additionalProperties: false,
              properties: {
                _id: { bsonType: 'objectId' },
                tipo_evento: { enum: TIPOS_EVENTO },
                descripcion: { bsonType: ['string', 'null'] },
                fecha_inicio: { bsonType: 'date' },
                fecha_fin: { bsonType: 'date' },
                activo: { bsonType: 'bool' },
              },
            },
          },
        },
      },
    },
    // periodos_fechas_validas: fecha_fin > fecha_inicio
    { $expr: { $gt: ['$fecha_fin', '$fecha_inicio'] } },
    // las fechas de cada evento del calendario van dentro del cuatrimestre
    {
      $expr: {
        $allElementsTrue: {
          $map: {
            input: { $ifNull: ['$calendario', []] },
            as: 'e',
            in: { $gt: ['$$e.fecha_fin', '$$e.fecha_inicio'] },
          },
        },
      },
    },
  ],
};

const aulas = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['clave', 'nombre', 'tipo', 'capacidad', 'activa'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      clave: { bsonType: 'string', minLength: 1 },
      nombre: { bsonType: 'string', minLength: 1 },
      tipo: { enum: ['aula', 'laboratorio', 'taller'] },
      capacidad: { bsonType: 'int', minimum: 1 },
      activa: { bsonType: 'bool' },
    },
  },
};

const materias = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['clave', 'nombre', 'creditos', 'horas_semana', 'activa'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      clave: { bsonType: 'string', minLength: 1 },
      nombre: { bsonType: 'string', minLength: 1 },
      creditos: { bsonType: 'number', minimum: 0 },
      horas_semana: { bsonType: 'int', minimum: 1 },
      activa: { bsonType: 'bool' },
    },
  },
};

// El plan de estudios deja de ser una tabla intermedia y se vuelve un
// documento por carrera: nunca se consulta de a una materia, siempre
// completo y por carrera, y asi revisar el egreso es leer un documento.
const planes_estudio = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['id_carrera', 'materias'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      id_carrera: { bsonType: 'objectId' },
      materias: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['id_materia', 'clave', 'nombre', 'cuatrimestre'],
          additionalProperties: false,
          properties: {
            id_materia: { bsonType: 'objectId' },
            clave: { bsonType: 'string' },
            nombre: { bsonType: 'string' },
            cuatrimestre: CUATRIMESTRE,
            // materia_carrera_requisito_distinto: el requisito nunca es ella misma
            id_materia_requisito: { bsonType: ['objectId', 'null'] },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------
// Personas y acceso
//
// usuarios, alumnos y docentes quedan en una sola coleccion: la relacion
// es uno a uno y cada peticion necesita saber quien es la persona y que
// rol tiene, asi que juntarlas quita una junta de todas las peticiones.
// Los campos propios del rol van en perfil_alumno o perfil_docente.
// ---------------------------------------------------------------------

const perfil_alumno = {
  bsonType: 'object',
  required: [
    'matricula',
    'curp',
    'sexo',
    'fecha_nacimiento',
    'carrera',
    'turno',
    'cuatrimestre_actual',
    'id_periodo_ingreso',
    'fecha_ingreso',
    'estatus',
    'expediente',
  ],
  additionalProperties: false,
  properties: {
    // carrera + año de ingreso + cuatrimestre de ingreso + consecutivo
    matricula: { bsonType: 'string', pattern: '^[1-8][0-9]{9}$' },
    curp: { bsonType: 'string', minLength: 18, maxLength: 18 },
    sexo: { enum: ['H', 'M'] },
    fecha_nacimiento: { bsonType: 'date' },
    telefono_casa: { bsonType: ['string', 'null'] },
    carrera: REF_CARRERA,
    turno: REF_TURNO,
    cuatrimestre_actual: CUATRIMESTRE,
    // El cuatrimestre en que entro: con el se arma su matricula y nunca cambia.
    id_periodo_ingreso: { bsonType: 'objectId' },
    fecha_ingreso: { bsonType: 'date' },
    estatus: { enum: ['activo', 'baja_temporal', 'baja_definitiva', 'egresado'] },
    domicilio: {
      bsonType: 'object',
      additionalProperties: false,
      properties: {
        calle: { bsonType: ['string', 'null'] },
        numero_exterior: { bsonType: ['string', 'null'] },
        colonia: { bsonType: ['string', 'null'] },
        codigo_postal: { bsonType: ['string', 'null'], pattern: '^([0-9]{5})?$' },
        municipio: { bsonType: ['string', 'null'] },
        estado: { bsonType: ['string', 'null'] },
      },
    },
    secundaria: {
      bsonType: 'object',
      additionalProperties: false,
      properties: {
        escuela_procedencia: { bsonType: ['string', 'null'] },
        promedio: { bsonType: ['number', 'null'], minimum: 0, maximum: 10 },
      },
    },
    tutor: {
      bsonType: 'object',
      additionalProperties: false,
      properties: {
        nombre: { bsonType: ['string', 'null'] },
        parentesco: { bsonType: ['string', 'null'] },
        telefono: { bsonType: ['string', 'null'] },
      },
    },
    foto: {
      bsonType: ['object', 'null'],
      additionalProperties: false,
      properties: {
        ruta: { bsonType: 'string' },
        actualizada: { bsonType: 'date' },
      },
    },
    // El expediente: seis tipos exactos, uno por tipo. Nace completo en
    // pendiente al dar de alta al alumno, asi que el disparador que lo
    // abria desaparece, y la unicidad por tipo la impone el arreglo.
    expediente: {
      bsonType: 'array',
      minItems: 6,
      maxItems: 6,
      items: {
        bsonType: 'object',
        required: ['tipo', 'estatus'],
        additionalProperties: false,
        properties: {
          tipo: { enum: TIPOS_DOCUMENTO },
          estatus: { enum: ['pendiente', 'recibido', 'validado', 'rechazado'] },
          fecha_recepcion: { bsonType: ['date', 'null'] },
          observaciones: { bsonType: ['string', 'null'] },
          recibido_por: { bsonType: ['objectId', 'null'] },
        },
      },
    },
  },
};

const perfil_docente = {
  bsonType: 'object',
  required: ['numero_empleado', 'activo'],
  additionalProperties: false,
  properties: {
    numero_empleado: { bsonType: 'string', pattern: '^[0-9]{8}$' },
    curp: { bsonType: ['string', 'null'], minLength: 18, maxLength: 18 },
    rfc: { bsonType: ['string', 'null'] },
    grado_academico: { bsonType: ['string', 'null'] },
    especialidad: { bsonType: ['string', 'null'] },
    cedula_profesional: { bsonType: ['string', 'null'] },
    tipo_contrato: { bsonType: ['string', 'null'] },
    fecha_ingreso: { bsonType: ['date', 'null'] },
    activo: { bsonType: 'bool' },
  },
};

const usuarios = {
  $and: [
    {
      $jsonSchema: {
        bsonType: 'object',
        required: ['rol', 'nombre', 'apellido_paterno', 'correo', 'activo', 'fecha_creacion'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'objectId' },
          rol: { enum: ROLES },
          nombre: { bsonType: 'string', minLength: 1 },
          apellido_paterno: { bsonType: 'string', minLength: 1 },
          apellido_materno: { bsonType: ['string', 'null'] },
          correo: { bsonType: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
          telefono: { bsonType: ['string', 'null'] },
          // Solo el coordinador tiene carrera asignada, y siempre la tiene.
          id_carrera: { bsonType: ['objectId', 'null'] },
          activo: { bsonType: 'bool' },
          ultimo_acceso: { bsonType: ['date', 'null'] },
          fecha_creacion: { bsonType: 'date' },
          // El numero de coordinador, que en el relacional vive en la tabla
          // de acceso por rol.
          numero_coordinador: { bsonType: ['string', 'null'], pattern: '^([0-9]{8})?$' },
          perfil_alumno,
          perfil_docente,
        },
      },
    },
    // usuarios_carrera_solo_coordinador: (rol = coordinador) = (tiene carrera)
    {
      $expr: {
        $eq: [
          { $eq: ['$rol', 'coordinador'] },
          { $ne: [{ $ifNull: ['$id_carrera', null] }, null] },
        ],
      },
    },
    // El perfil corresponde al rol: el alumno trae perfil_alumno, el docente
    // perfil_docente, y administracion y coordinacion no traen ninguno.
    {
      $expr: {
        $eq: [
          { $eq: ['$rol', 'alumno'] },
          { $ne: [{ $ifNull: ['$perfil_alumno', null] }, null] },
        ],
      },
    },
    {
      $expr: {
        $eq: [
          { $eq: ['$rol', 'docente'] },
          { $ne: [{ $ifNull: ['$perfil_docente', null] }, null] },
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------------
// Oferta del cuatrimestre
//
// grupos se lleva dentro sus materias y el horario de cada una: es la
// unidad de lectura de coordinacion y del horario del alumno, esta
// acotado, y crear un grupo con sus materias u horario completo deja de
// necesitar transaccion porque es la escritura de un solo documento.
// ---------------------------------------------------------------------

const grupos = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['clave', 'carrera', 'turno', 'id_periodo', 'cuatrimestre', 'cupo', 'activo'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      clave: { bsonType: 'string', minLength: 1 },
      carrera: REF_CARRERA,
      turno: REF_TURNO,
      id_periodo: { bsonType: 'objectId' },
      cuatrimestre: CUATRIMESTRE,
      cupo: { bsonType: 'int', minimum: 1 },
      activo: { bsonType: 'bool' },
      asignaciones: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['_id', 'materia', 'estatus_captura', 'captura_manual'],
          additionalProperties: false,
          properties: {
            _id: { bsonType: 'objectId' },
            materia: REF_MATERIA,
            id_docente: { bsonType: ['objectId', 'null'] },
            estatus_captura: { enum: ['abierta', 'cerrada'] },
            // Verdadero cuando administracion abrio o cerro la captura a
            // mano; la tarea que sigue al calendario ya no la mueve.
            captura_manual: { bsonType: 'bool' },
            horarios: {
              bsonType: 'array',
              items: {
                bsonType: 'object',
                required: ['_id', 'id_aula', 'dia_semana', 'hora_inicio', 'hora_fin'],
                additionalProperties: false,
                properties: {
                  _id: { bsonType: 'objectId' },
                  id_aula: { bsonType: 'objectId' },
                  // 1 = lunes ... 6 = sabado
                  dia_semana: { bsonType: 'int', minimum: 1, maximum: 6 },
                  hora_inicio: HORA,
                  hora_fin: HORA,
                },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------
// Trayectoria
//
// Un documento es un alumno en un cuatrimestre, con las materias que
// cursa y las calificaciones de cada una. Es la decision que mas logica
// elimina: promediar los parciales, mover el estatus de la materia y dar
// de baja la carga al cancelar quedan dentro de un solo documento.
// ---------------------------------------------------------------------

const inscripciones = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'id_alumno',
      'id_periodo',
      'id_grupo',
      'cuatrimestre',
      'tipo',
      'estatus',
      'fecha_solicitud',
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      id_alumno: { bsonType: 'objectId' },
      id_periodo: { bsonType: 'objectId' },
      id_grupo: { bsonType: 'objectId' },
      cuatrimestre: CUATRIMESTRE,
      tipo: { enum: ['nuevo_ingreso', 'reinscripcion'] },
      estatus: { enum: ['solicitada', 'aprobada', 'rechazada', 'cancelada', 'baja'] },
      fecha_solicitud: { bsonType: 'date' },
      fecha_inscripcion: { bsonType: ['date', 'null'] },
      atendida_por: { bsonType: ['objectId', 'null'] },
      observaciones: { bsonType: ['string', 'null'] },
      carga: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['_id', 'id_asignacion', 'materia', 'tipo_curso', 'estatus'],
          additionalProperties: false,
          properties: {
            _id: { bsonType: 'objectId' },
            id_asignacion: { bsonType: 'objectId' },
            materia: REF_MATERIA,
            tipo_curso: { enum: ['normal', 'recursamiento'] },
            estatus: { enum: ['cursando', 'aprobada', 'reprobada', 'baja'] },
            // Hasta cinco: tres parciales, final y extraordinario. La
            // unicidad por tipo la impone el arreglo, ya no un indice.
            calificaciones: {
              bsonType: 'array',
              maxItems: 5,
              items: {
                bsonType: 'object',
                required: ['tipo', 'calificacion', 'fecha_captura'],
                additionalProperties: false,
                properties: {
                  tipo: { enum: TIPOS_CALIFICACION },
                  calificacion: CALIFICACION,
                  fecha_captura: { bsonType: 'date' },
                  capturada_por: { bsonType: ['objectId', 'null'] },
                },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------
// Tramites, avisos y bitacora
//
// Los tres se quedan sueltos porque crecen sin limite y se consultan por
// su cuenta, no por persona: la cola de administracion filtra tramites
// por estatus entre todos los alumnos.
// ---------------------------------------------------------------------

const tramites = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['id_alumno', 'tipo', 'estatus', 'fecha_solicitud'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      id_alumno: { bsonType: 'objectId' },
      tipo: { enum: TIPOS_TRAMITE },
      motivo: { bsonType: ['string', 'null'] },
      estatus: { enum: ['solicitado', 'en_proceso', 'listo', 'entregado', 'rechazado'] },
      observaciones: { bsonType: ['string', 'null'] },
      fecha_solicitud: { bsonType: 'date' },
      fecha_resolucion: { bsonType: ['date', 'null'] },
      atendido_por: { bsonType: ['objectId', 'null'] },
    },
  },
};

const avisos = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['titulo', 'contenido', 'publicado_por', 'fecha_publicacion', 'activo'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      titulo: { bsonType: 'string', minLength: 1 },
      contenido: { bsonType: 'string', minLength: 1 },
      // Sin rol destino, el aviso es para todos.
      rol_destino: { bsonType: ['string', 'null'], enum: [...ROLES, null] },
      id_grupo: { bsonType: ['objectId', 'null'] },
      publicado_por: { bsonType: 'objectId' },
      fecha_publicacion: { bsonType: 'date' },
      fecha_expiracion: { bsonType: ['date', 'null'] },
      activo: { bsonType: 'bool' },
    },
  },
};

const bitacora = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['accion', 'coleccion', 'fecha_hora'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      id_usuario: { bsonType: ['objectId', 'null'] },
      accion: { enum: ['INSERT', 'UPDATE', 'DELETE'] },
      coleccion: { bsonType: 'string' },
      id_documento: { bsonType: ['objectId', 'null'] },
      datos_anteriores: { bsonType: ['object', 'null'] },
      datos_nuevos: { bsonType: ['object', 'null'] },
      fecha_hora: { bsonType: 'date' },
    },
  },
};

// Los consecutivos de la matricula, del numero de docente y de
// coordinador y de la clave del grupo. MongoDB no tiene secuencias, asi
// que la capa de datos los saca de aqui con findOneAndUpdate y $inc,
// que es atomico.
const contadores = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'valor'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'string' },
      valor: { bsonType: 'int', minimum: 0 },
    },
  },
};

const COLECCIONES = {
  carreras,
  turnos,
  periodos,
  aulas,
  materias,
  planes_estudio,
  usuarios,
  grupos,
  inscripciones,
  tramites,
  avisos,
  bitacora,
  contadores,
};

module.exports = {
  descripcion: 'Las doce colecciones del modelo, mas contadores, con sus validadores de esquema',

  async aplicar(db) {
    const existentes = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

    for (const [nombre, validator] of Object.entries(COLECCIONES)) {
      const opciones = {
        validator,
        validationLevel: 'strict',
        validationAction: 'error',
      };

      if (existentes.has(nombre)) {
        // La coleccion ya existe: solo se le cambia el validador.
        await db.command({ collMod: nombre, ...opciones });
      } else {
        await db.createCollection(nombre, opciones);
      }
    }
  },
};
