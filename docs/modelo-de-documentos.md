# Rediseño del modelo: de tablas a documentos

Este documento explica cómo pasa el sistema de control escolar CETIA de veinte tablas en
PostgreSQL a doce colecciones en MongoDB, qué se embebe y qué se referencia en cada caso, y
a dónde se va toda la lógica que hoy vive dentro de la base de datos relacional.

No es una migración. Es el mismo sistema escolar rediseñado: las mismas reglas, las mismas
pantallas y los mismos cuatro roles, pensados para documentos en lugar de renglones. El
proyecto relacional se lee como referencia y no se toca.

Mientras no se apruebe este documento no se escribe código.

## De dónde partimos

Veinte tablas, agrupadas por lo que hacen:

| Grupo | Tablas |
|---|---|
| Catálogos | `carreras`, `turnos`, `periodos`, `aulas`, `materias`, `materia_carrera`, `calendario_escolar` |
| Personas | `usuarios`, `alumnos`, `docentes`, `documentos` |
| Oferta del cuatrimestre | `grupos`, `asignaciones`, `horarios` |
| Trayectoria | `inscripciones`, `carga_academica`, `calificaciones` |
| Lo demás | `avisos`, `bitacora`, `tramites` |

Pero el modelo no es lo más pesado del sistema. Dentro de PostgreSQL hay además:

- Disparadores que generan la matrícula, el número de docente y la clave del grupo; abren el
  expediente en blanco; sellan quién recibió un documento y quién atendió una inscripción;
  promedian los parciales; mueven el estatus de la carga; detectan el egreso; validan empalmes
  de aula, docente y grupo; protegen catálogos en uso; y llenan la bitácora de las veinte tablas.
- Seguridad por filas (RLS) en las veinte tablas: el alumno sólo ve lo suyo, el docente sólo
  sus grupos, el coordinador sólo su carrera.
- Cuatro roles de PostgreSQL (`alumnado`, `docencia`, `coordinacion`, `administracion`) con
  permisos por columna.
- Cuatro operaciones que son todo o nada: crear un grupo con sus materias, programar un horario
  completo, aprobar una reinscripción y capturar las calificaciones de un grupo.

MongoDB no tiene nada de eso. La segunda mitad de este documento dice a dónde se va cada cosa.

## Con qué criterio se decidió

Una tabla y una colección no son lo mismo, así que el reparto no se hizo tabla por tabla sino
preguntando cuatro cosas de cada relación:

1. **¿Se leen siempre juntos?** Si una pantalla nunca pide uno sin el otro, van en el mismo
   documento. Eso convierte una junta en una lectura.
2. **¿Está acotado?** Se embebe sólo lo que tiene un techo conocido: seis documentos del
   expediente, cinco calificaciones por materia, las materias de un grupo. Lo que crece sin
   límite con el tiempo no se embebe nunca.
3. **¿Se escriben juntos?** Lo que hoy obliga a una transacción porque se guarda completo o no se
   guarda, si cabe en un documento deja de necesitarla: un documento se escribe de forma atómica
   por sí solo.
4. **¿Alguien lo consulta por su cuenta?** Si administración necesita buscar trámites de todos
   los alumnos filtrando por estatus, los trámites no pueden vivir escondidos dentro del alumno.

Cuando el criterio 1 y el criterio 4 se contradicen, gana el 4: es peor volver imposible una
consulta que pagar una lectura extra.

## Las doce colecciones

| Colección | Qué trae | Viene de |
|---|---|---|
| `carreras` | Las dos carreras con su clave | `carreras` |
| `turnos` | Los dos turnos con su horario | `turnos` |
| `periodos` | Los cuatrimestres, con su calendario escolar dentro | `periodos` + `calendario_escolar` |
| `aulas` | Aulas, laboratorios y talleres con su capacidad | `aulas` |
| `materias` | El catálogo de materias con clave, créditos y horas | `materias` |
| `planes_estudio` | Un documento por carrera con sus materias por cuatrimestre y sus requisitos | `materia_carrera` |
| `usuarios` | La cuenta, el rol y el perfil de la persona; el expediente del alumno dentro | `usuarios` + `alumnos` + `docentes` + `documentos` |
| `grupos` | El grupo con sus materias, su docente y su horario dentro | `grupos` + `asignaciones` + `horarios` |
| `inscripciones` | El cuatrimestre de un alumno con sus materias y sus calificaciones dentro | `inscripciones` + `carga_academica` + `calificaciones` |
| `tramites` | Las solicitudes de documentos del alumno | `tramites` |
| `avisos` | El tablero de avisos | `avisos` |
| `bitacora` | La auditoría de todo lo que cambia | `bitacora` |

Veinte tablas quedan en doce colecciones. Las ocho que desaparecen no se pierden: se vuelven
arreglos dentro del documento al que pertenecen.

## Qué se embebe y por qué

### El calendario escolar entra en el cuatrimestre

`calendario_escolar` pasa a ser un arreglo dentro de cada documento de `periodos`.

Son seis tipos de evento por cuatrimestre, nunca se consultan sin su cuatrimestre, y hoy ya se
borran con él (`on delete cascade`). La ganancia concreta está en la regla que abre y cierra la
captura de calificaciones: hoy necesita una junta entre `periodos` y `calendario_escolar` para
saber si hay una ventana abierta en este momento, y con el calendario dentro del cuatrimestre eso
es leer un solo documento, el que tiene `actual: true`.

### El plan de estudios se vuelve un documento por carrera

`materia_carrera` desaparece como colección. En su lugar hay `planes_estudio`, con un documento
por carrera que trae la lista de sus materias, en qué cuatrimestre va cada una y cuál es su
materia requisito.

La tabla intermedia existe en el modelo relacional porque es la única forma de representar una
relación N:M. Pero el plan de estudios nunca se consulta de a una materia: se consulta completo
y por carrera, que es exactamente la pantalla que ven coordinación y administración. Además está
acotado, porque la restricción `materia_carrera_unica (id_materia, id_carrera)` garantiza que una
materia aparece una sola vez por carrera.

Lo importante es lo que esto le hace a la revisión del egreso. Hoy, cada vez que una materia se
aprueba, hay que contar cuántas materias del plan de la carrera le faltan al alumno con una
junta de tres tablas y un `not exists`. Con el plan en un documento, es leer ese documento y
compararlo contra las materias aprobadas del alumno.

`materias` sigue siendo su propia colección, porque una materia es un catálogo con clave,
créditos y horas a la semana, puede estar en las dos carreras y la referencian los grupos.

### Alumnos y docentes entran en la cuenta

`usuarios`, `alumnos` y `docentes` quedan en una sola colección `usuarios`. Los campos propios
del rol van en un subdocumento: `perfil_alumno` o `perfil_docente`.

La relación es uno a uno por definición: tanto `alumnos` como `docentes` tienen `id_usuario`
único. En el modelo relacional están separadas porque una tabla con las columnas de los cuatro
roles tendría la mitad de sus columnas vacías en cada renglón; en documentos eso no es un problema,
porque un documento sólo guarda los campos que tiene.

Y la ganancia está en el camino más caliente del sistema: cada petición necesita saber quién es
la persona y qué rol tiene, y el acceso del alumno es por matrícula, que hoy vive en otra tabla.
Juntarlas quita una junta de absolutamente todas las peticiones.

El costo es que los documentos de la colección no son iguales entre sí, así que el validador de
esquema tiene que ramificar según el rol. Es un costo real pero contenido: son cuatro formas
posibles y dos de ellas no tienen perfil.

### El expediente entra en el alumno

`documentos` pasa a ser un arreglo dentro de `perfil_alumno`.

Son exactamente seis tipos, uno por tipo (`unique (id_alumno, tipo_documento)`), siempre se leen
como expediente completo y nacen juntos: hoy un disparador crea los seis en estado pendiente
cuando se da de alta al alumno. Embebidos, ese disparador desaparece, porque los seis se escriben
en el mismo insert que crea al alumno.

La unicidad por tipo deja de necesitar un índice: la impone la forma del arreglo.

### El grupo se lleva sus materias y su horario

`grupos`, `asignaciones` y `horarios` quedan en una sola colección `grupos`. Cada grupo trae sus
materias, y cada materia su docente, su estatus de captura y sus bloques de horario.

Es la decisión con más consecuencias, y se sostiene por las cuatro preguntas a la vez:

- **Se leen juntos.** La pantalla de coordinación es "grupos con sus materias, docentes y
  horarios", el árbol completo. El horario del alumno es el horario de su grupo.
- **Está acotado.** Un grupo lleva del orden de seis a ocho materias, y cada materia unos pocos
  bloques de horario a la semana. Son decenas de subdocumentos, no miles.
- **Se escriben juntos.** Crear un grupo con sus materias es hoy una transacción, y programar el
  horario completo de una materia es otra. Las dos se vuelven una sola escritura de un documento,
  que es atómica por sí misma. Dos de las cuatro operaciones transaccionales desaparecen.
- **Nadie los consulta suelto.** Una asignación o un bloque de horario no significan nada fuera
  de su grupo.

Hay dos consultas que sí cruzan el documento y hay que resolverlas con índices sobre campos
anidados: los grupos de un docente (`asignaciones.id_docente`) y la ocupación de un aula
(`asignaciones.horarios.id_aula`). MongoDB las atiende con índices multiclave, así que funcionan,
pero conviene dejarlo escrito porque son dos pantallas del sistema.

### El cuatrimestre del alumno se lleva sus materias y sus calificaciones

`inscripciones`, `carga_academica` y `calificaciones` quedan en una sola colección
`inscripciones`. Un documento es un alumno en un cuatrimestre, con las materias que cursa y las
calificaciones de cada una.

Es la decisión que más lógica elimina:

- Promediar los parciales deja de ser un disparador. Hoy, al capturar el tercer parcial hay que
  consultar los otros dos y escribir un renglón nuevo con el promedio. Con las cinco
  calificaciones en el mismo elemento del arreglo, los tres parciales y la final se leen y se
  escriben en la misma actualización de un solo documento.
- Mover el estatus de la materia según su calificación final queda en esa misma actualización.
- Dar de baja las materias cuando se cancela la inscripción era un disparador sobre otra tabla;
  ahora es tocar el mismo documento.
- Aprobar una reinscripción, que hoy es una transacción porque crea la inscripción y sus materias,
  se vuelve una sola escritura.
- La unicidad de una calificación por tipo la impone la forma del arreglo, no un índice.

Y sigue acotado: una inscripción lleva las materias de un cuatrimestre, cada una con cinco
calificaciones como máximo.

Lo que no se simplifica es la captura del docente, que es por materia y de todo el grupo a la
vez: toca una inscripción por alumno, así que ahí sí queda una operación de varios documentos y
sigue necesitando transacción. De las cuatro operaciones transaccionales, dos desaparecen, una
se reduce y ésta se queda.

## Qué no se embebe y por qué

| Tabla | Por qué sigue suelta |
|---|---|
| `materias` | Es un catálogo compartido por las dos carreras y lo referencian los grupos. Embebido se duplicaría y habría que corregirlo en varios lados. |
| `aulas` | Igual: catálogo compartido, y administración consulta su ocupación por aula, no por grupo. |
| `carreras` y `turnos` | Son dos renglones cada uno, pero los referencian alumnos, grupos y planes. Se quedan como colección y además se guarda una copia de su clave y su nombre donde se muestran, para no ir a buscarlas en cada lectura. |
| `periodos` | El cuatrimestre lo comparte todo el sistema y hay uno marcado como actual. |
| `tramites` | Crecen sin límite a lo largo de la vida del alumno, y administración los consulta de todos los alumnos filtrando por estatus. Embebidos en el alumno, esa cola de trabajo obligaría a recorrer toda la colección de usuarios. |
| `avisos` | Crecen sin límite y se consultan por rol destino y por grupo, no por persona. |
| `bitacora` | Crece sin límite, se escribe en cada cambio y sólo la lee administración. Nunca debe cargarse junto con el dato que audita. |

Sobre la copia de la clave y el nombre de la carrera o el turno: es una copia de lectura, no la
verdad. La verdad sigue en su colección. Se puede permitir porque son dos renglones que no cambian
de nombre; si algún día cambiaran, hay que actualizarlos donde estén copiados, y eso debe quedar
como una tarea explícita del rediseño y no como una sorpresa.

## Cómo se ven los documentos

Un alumno, con su perfil y su expediente dentro:

```json
{
  "_id": "...",
  "rol": "alumno",
  "nombre": "...",
  "apellido_paterno": "...",
  "apellido_materno": "...",
  "correo": "...",
  "telefono": "...",
  "activo": true,
  "ultimo_acceso": "...",
  "fecha_creacion": "...",
  "perfil_alumno": {
    "matricula": "1426010001",
    "curp": "...",
    "sexo": "H",
    "fecha_nacimiento": "...",
    "carrera": { "_id": "...", "clave": "14", "nombre": "Tecnologias de la Informacion" },
    "turno": { "_id": "...", "nombre": "matutino" },
    "cuatrimestre_actual": 1,
    "fecha_ingreso": "...",
    "estatus": "activo",
    "domicilio": { "calle": "...", "numero_exterior": "...", "colonia": "...",
                   "codigo_postal": "...", "municipio": "...", "estado": "..." },
    "secundaria": { "escuela_procedencia": "...", "promedio": 9.1 },
    "tutor": { "nombre": "...", "parentesco": "...", "telefono": "..." },
    "foto": { "ruta": "...", "actualizada": "..." },
    "expediente": [
      { "tipo": "acta_nacimiento", "estatus": "validado",
        "fecha_recepcion": "...", "recibido_por": "...", "observaciones": null },
      { "tipo": "curp", "estatus": "pendiente",
        "fecha_recepcion": null, "recibido_por": null, "observaciones": null }
    ]
  }
}
```

Un grupo, con sus materias y su horario dentro:

```json
{
  "_id": "...",
  "clave": "TI-1A",
  "carrera": { "_id": "...", "clave": "14", "nombre": "Tecnologias de la Informacion" },
  "turno": { "_id": "...", "nombre": "matutino", "hora_inicio": "07:00", "hora_fin": "13:00" },
  "id_periodo": "...",
  "cuatrimestre": 1,
  "cupo": 35,
  "activo": true,
  "asignaciones": [
    {
      "_id": "...",
      "materia": { "_id": "...", "clave": "...", "nombre": "...", "horas_semana": 4 },
      "id_docente": "...",
      "estatus_captura": "abierta",
      "captura_manual": false,
      "horarios": [
        { "_id": "...", "id_aula": "...", "dia_semana": 1,
          "hora_inicio": "07:00", "hora_fin": "09:00" },
        { "_id": "...", "id_aula": "...", "dia_semana": 3,
          "hora_inicio": "07:00", "hora_fin": "09:00" }
      ]
    }
  ]
}
```

Un cuatrimestre de un alumno, con sus materias y sus calificaciones dentro:

```json
{
  "_id": "...",
  "id_alumno": "...",
  "id_periodo": "...",
  "id_grupo": "...",
  "cuatrimestre": 1,
  "tipo": "reinscripcion",
  "estatus": "aprobada",
  "fecha_solicitud": "...",
  "fecha_inscripcion": "...",
  "atendida_por": "...",
  "observaciones": null,
  "carga": [
    {
      "_id": "...",
      "id_asignacion": "...",
      "materia": { "_id": "...", "clave": "...", "nombre": "..." },
      "tipo_curso": "normal",
      "estatus": "aprobada",
      "calificaciones": [
        { "tipo": "parcial_1", "calificacion": 8.0, "fecha_captura": "...", "capturada_por": "..." },
        { "tipo": "parcial_2", "calificacion": 9.0, "fecha_captura": "...", "capturada_por": "..." },
        { "tipo": "parcial_3", "calificacion": 10.0, "fecha_captura": "...", "capturada_por": "..." },
        { "tipo": "final", "calificacion": 9.0, "fecha_captura": "...", "capturada_por": "..." }
      ]
    }
  ]
}
```

La materia aparece copiada con su clave y su nombre dentro de la carga para que el historial y la
boleta se lean sin ir a buscar la materia; la verdad sigue en `materias`.

## Índices y unicidad

Lo que hoy son restricciones `unique` se reparte en tres destinos:

| Hoy | Mañana |
|---|---|
| `alumnos.matricula`, `alumnos.curp`, `docentes.numero_empleado`, `docentes.curp`, `docentes.rfc`, `usuarios.correo` | Índices únicos parciales sobre los campos anidados del perfil, parciales porque sólo existen en los documentos del rol que los tiene |
| `grupos (clave, id_periodo)`, `inscripciones (id_alumno, id_periodo)` | Índices únicos compuestos, equivalentes |
| `periodos.actual` único cuando es verdadero | Índice único parcial con filtro sobre `actual: true`, equivalente directo |
| `documentos (id_alumno, tipo_documento)`, `calificaciones (id_carga, tipo)` | Ya no son índices: los garantiza la forma del arreglo |
| `asignaciones (id_grupo, id_materia)`, `carga (id_inscripcion, id_asignacion)` | Tampoco: son unicidad dentro de un arreglo del mismo documento |

Y los índices de consulta que hay que crear por las pantallas del sistema:

| Índice | Para qué |
|---|---|
| `grupos (id_periodo, carrera._id, turno._id, cuatrimestre)` | La oferta del cuatrimestre |
| `grupos (asignaciones.id_docente)` | Los grupos del docente |
| `grupos (asignaciones.horarios.id_aula, asignaciones.horarios.dia_semana)` | La ocupación del aula y los empalmes |
| `inscripciones (id_alumno, id_periodo)` | El historial y la boleta del alumno |
| `inscripciones (carga.id_asignacion)` | La lista de captura del docente |
| `tramites (estatus)` y `tramites (id_alumno)` | La cola de administración y los trámites del alumno |
| `bitacora (id_usuario, fecha_hora)` descendente | La consulta de la bitácora |

## A dónde se va la lógica que hoy vive en PostgreSQL

Ésta es la decisión de fondo del rediseño. La respuesta es repartida, pero no repartida al gusto:
con una regla.

**Cada regla vive en la capa más baja que todavía pueda imponerla sin excepción.**

Baja es mejor porque significa que nadie puede saltársela: ni un servicio con un error, ni un
script, ni una persona entrando con Compass. Lo que no se puede imponer abajo, sube, pero con la
conciencia de que a partir de ahí depende de la disciplina del código y no del motor.

### El reparto

| Lo que hoy hace PostgreSQL | A dónde se va |
|---|---|
| Tipos, campos obligatorios, listas de valores, rangos, CURP de 18, CP de cinco dígitos, calificación de 0 a 10, cuatrimestre de 1 a 12 | Validadores `$jsonSchema` de MongoDB |
| Restricciones `unique` | Índices únicos, parciales donde hace falta |
| Matrícula, número de docente y de coordinador, clave de grupo | Capa de datos en Node, con una colección de contadores |
| Empalmes de aula, docente y grupo; plan de estudios; cupo; seriación; ventanas del calendario; límites del turno; capacidad del aula; horas de la materia | Capa de datos en Node, dentro de una transacción |
| Promediar parciales, mover el estatus de la carga, detectar el egreso, cerrar la cuenta del alumno dado de baja | Capa de datos en Node, en la misma operación que la escritura que los dispara |
| Abrir y cerrar la captura según el calendario, depurar avisos vencidos | Tarea programada en Node |
| Seguridad por filas (RLS) | Capa de datos en Node, como filtro obligatorio derivado de la identidad |
| Permisos por columna | Capa de datos en Node, como lista explícita de campos permitidos por rol |
| Los cuatro roles de PostgreSQL | Roles personalizados de MongoDB, como techo de lo que la capa de datos puede hacer; ver abajo |
| Bitácora de las veinte tablas | Capa de datos en Node, en un solo punto de paso |
| Autenticación, rol en el token, frontera entre portal y panel | Django |
| Las cuatro operaciones todo o nada | Dos desaparecen, una se reduce y una queda como transacción de MongoDB |

### Lo que sí se queda en la base

**Validadores de esquema.** Van con `validationLevel: strict` y `validationAction: error`, que es
lo más cerca que MongoDB llega de un `check`. Es la única capa que nada puede esquivar, así que
ahí va todo lo que se pueda expresar como forma del dato. El costo es que su mensaje de error no
sirve para mostrárselo a una persona, así que la capa de Node tiene que validar antes para dar un
mensaje entendible. El validador no es la pantalla de errores: es la red por si algo pasa de largo.

**Índices únicos.** Equivalente directo. Y conviene notar que cuatro de las restricciones `unique`
de hoy desaparecen porque lo que protegían quedó dentro de un mismo documento, que es una ganancia
real: ya no son una regla que se pueda violar, son una imposibilidad.

### Lo que se va a la capa de datos en Node

Casi todo lo demás, y vale la pena ser explícito sobre por qué a Node y no a Django.

Porque **la capa de datos tiene que ser la única puerta a MongoDB**. El valor de un disparador y
de RLS no era lo que hacían, era que no se podían olvidar. La única forma de conservar algo de esa
propiedad es que sea estructuralmente imposible escribir o consultar sin pasar por el lugar donde
están las reglas. Si las reglas estuvieran en Django, cualquier otro cliente de la capa de datos
las saltaría; estando en Node, pegadas a la escritura, no hay camino alrededor.

Esto se reparte en cinco cosas:

**Los identificadores que se generan.** MongoDB no tiene secuencias. Se resuelve con una colección
`contadores` y `findOneAndUpdate` con `$inc`, que es atómico, para sacar el consecutivo y armar la
matrícula, el número de docente o de coordinador y la clave del grupo. Cuesta una ida más a la base
por cada alta, lo cual es irrelevante en un sistema escolar.

**Las reglas que cruzan documentos.** Son las que no se pueden expresar de forma declarativa en
MongoDB: que el aula, el docente y el grupo no se empalmen en el horario del cuatrimestre, que la
materia esté en el plan de la carrera, que el grupo tenga cupo, que la materia requisito esté
aprobada, que la ventana del calendario esté abierta. Se hacen leyendo el conjunto con el que se
podría chocar y escribiendo en la misma transacción.

Varias se abarataron con el rediseño: el cupo del grupo y que sea de la misma carrera y turno se
leen del propio documento del grupo; la seriación y la decisión de si la materia va como
recursamiento se resuelven con el documento del plan más las inscripciones del propio alumno.

La de los empalmes es la que sigue siendo cara y hay que decirlo claro: hoy es una consulta de
SQL; mañana es recorrer los grupos del cuatrimestre buscando bloques que se crucen en día y hora.
Son decenas de documentos, no miles, así que el costo está bien, pero la escritura y la revisión
tienen que ir en la misma transacción para que dos coordinadores programando a la vez no metan un
empalme.

**Los valores derivados.** Lo que hoy son disparadores posteriores. El promedio de los parciales se
volvió trivial porque todo está en el mismo documento. El egreso y el cierre de la cuenta del
alumno cruzan documentos, así que viajan dentro de la transacción de la escritura que los provoca.

**El filtro por identidad, que es el heredero de RLS.** Aquí está el punto más delicado del
rediseño, así que conviene decirlo con precisión: la capa de datos no recibe una consulta, recibe
una identidad y una consulta, y no sabe construir una consulta sin identidad. El alcance lo deriva
ella: el alumno sólo alcanza sus propios documentos, el docente sólo los grupos donde él es el
docente, el coordinador sólo su carrera, administración todo menos modificar la bitácora. No es una
convención que se recuerda, es la forma de la función: sin identidad no compila.

**Los campos que cada rol puede escribir.** El heredero de los permisos por columna. Una lista
explícita por rol y por colección, que se aplica filtrando la actualización antes de que llegue a
MongoDB. Así el alumno puede cambiar su domicilio pero no su CURP ni su matrícula, y coordinación
asigna docentes pero no abre la captura de calificaciones.

**La bitácora, en un solo punto de paso.** Toda escritura pasa por una función que registra el
antes y el después en `bitacora`, dentro de la misma transacción.

Vale la pena explicar por qué no con Atlas Triggers, que a primera vista parecería el equivalente
natural de un disparador: funcionan sobre change streams, es decir, después de que la escritura ya
ocurrió. Si el registro de auditoría falla, la escritura ya pasó y no hay forma de deshacerla. Hoy
la bitácora es parte de la transacción, y para conservar esa propiedad tiene que escribirse con el
dato, no después. Además ataría el sistema a Atlas.

### Lo que se queda en Django

Django es la API: atiende al frontend, autentica, guarda la sesión, pone el rol en el token y
sostiene la frontera entre las dos aplicaciones, rechazando al alumno o al docente que intente
entrar por el panel administrativo y a administración o coordinación que intente entrar por el
portal. Esa frontera es de la capa que tiene la sesión, y es como ya funciona en el proyecto
relacional.

Django no habla con MongoDB. No tiene credenciales de la base. Todo lo que necesita lo pide a la
capa de datos, pasando quién es la persona.

### Los cuatro roles de PostgreSQL sí bajan a MongoDB, pero sólo hasta la colección

El control de accesos de MongoDB es por colección y por acción, no por documento ni por campo.
Puede decir "este usuario lee `grupos`", no puede decir "este alumno lee su propio expediente" ni
"el alumno puede cambiar su domicilio pero no su CURP", que es justamente lo que hacían RLS y los
permisos por columna.

De eso no se sigue que los roles no sirvan. Se sigue que no alcanzan solos, que es otra cosa. Lo
que sí pueden hacer es ponerle un techo a la capa de datos: si el alumno entra con una conexión
que no tiene permiso de escribir `grupos`, un error en Node no puede regalarle ese permiso. La
regla de reparto de este rediseño dice que cada regla vive en la capa más baja que todavía pueda
imponerla sin excepción, y el techo por colección es una de esas reglas.

Entonces hay ocho roles personalizados: los cuatro del sistema escolar, traducidos colección por
colección desde los `GRANT` del proyecto relacional, y cuatro de servicio (el acceso, la tarea
programada, las migraciones y la lectura de auditoría). La capa de datos abre una conexión por rol
y usa la que corresponde al rol del token, de modo que el techo sea real y no decorativo.

Lo que no cambia:

- El filtro por identidad y la lista de campos por rol siguen enteros en la capa de datos. Son los
  herederos de RLS y de los permisos por columna, y los roles no los sustituyen.
- Django sigue sin credenciales de MongoDB, porque no la toca.
- Hay un usuario de sólo lectura aparte para auditoría y reportes.

El cuadro completo, con lo que la traducción de tablas a colecciones hizo perder y quién lo impone
ahora, está en [`roles-y-permisos.md`](roles-y-permisos.md).

### Las transacciones

De las cuatro operaciones todo o nada, dos desaparecen porque su resultado quedó dentro de un
documento: crear un grupo con sus materias y programar el horario completo de una materia. Aprobar
una reinscripción se reduce a escribir un documento, aunque sigue en transacción porque además
mueve el cuatrimestre del alumno. Capturar las calificaciones de un grupo se queda como transacción
de varios documentos, porque toca la inscripción de cada alumno.

A esas se suman las transacciones nuevas que trae el rediseño: las validaciones que cruzan
documentos tienen que leer y escribir en la misma transacción para no abrir una ventana entre la
revisión y la escritura.

## Lo que se pierde y cómo se compensa

Conviene dejarlo escrito, porque es el precio del rediseño y no se debe descubrir tarde.

En PostgreSQL las reglas las imponía el motor y no se podían saltar. En MongoDB sólo conservan esa
propiedad la forma de los campos y la unicidad. Todo lo demás pasa a ser código, y su confiabilidad
deja de depender del motor para depender de dos cosas:

1. Que la capa de datos sea de verdad la única puerta a la base.
2. Que cada regla tenga una prueba que demuestre que se cumple.

El proyecto relacional tenía lo primero gratis y para lo segundo le bastaban las pruebas que corre
dentro de la base. Aquí hay que construir las dos cosas a propósito. En la práctica eso significa
que el proyecto necesita una batería de pruebas por regla, equivalente a las que hoy corren en
PostgreSQL, y que ésa no es una tarea opcional del final: es parte de lo que sustituye a los
disparadores.

El segundo costo es que la integridad referencial desaparece. No hay `on delete restrict` que
impida borrar una materia que algún grupo está usando, ni `on delete cascade` que limpie detrás.
Lo que hoy protege el disparador de catálogos en uso pasa a ser una revisión explícita antes de
borrar o dar de baja, y en varios casos el rediseño lo volvió innecesario porque lo que se
borraba en cascada ahora vive dentro del documento que se borra.

## Consecuencias para el entorno

Las transacciones de MongoDB necesitan un conjunto de réplicas. Atlas lo da desde el nivel gratuito,
así que en la nube no hay nada que hacer. Pero el MongoDB local de Docker Compose tiene que
levantarse con `--replSet` e iniciarse, porque un servidor solo no acepta transacciones y la mitad
de las reglas de este diseño dependen de ellas. Es el equivalente de la rama local de la base que
tiene el proyecto relacional, y se arma igual: desde cero, con todo aplicado, fuera de producción.

## Lo que falta decidir

Son decisiones que no bloquean el modelo pero sí el código que venga después:

1. **Dónde se guardan las fotos de los alumnos.** Hoy es un espacio privado de Supabase Storage,
   con la foto redibujada para que pierda sus metadatos y enlaces que caducan. MongoDB no tiene un
   equivalente directo: hay que decidir entre GridFS, un servicio de almacenamiento aparte, o el
   sistema de archivos del contenedor.
2. **Dónde se guardan las contraseñas.** Hoy las cifra Supabase Auth y nunca tocan las tablas del
   sistema. Con Django la opción natural es su propio sistema de autenticación, pero hay que
   decidirlo explícitamente porque cambia qué guarda `usuarios`.
3. **Cómo corre la tarea periódica** que abre y cierra la captura y depura avisos vencidos: hoy es
   `pg_cron`.
4. **El nombre del cluster y de la base** en MongoDB Atlas, que todavía no existen.
