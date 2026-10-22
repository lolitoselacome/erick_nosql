# Los roles de la base de datos

Quién puede hacer qué dentro de MongoDB, colección por colección y acción por acción.

Los roles están definidos en [`../mongodb/roles/roles.py`](../mongodb/roles/roles.py), que es la
única verdad: de ahí salen los que se crean en el MongoDB local y los que se crean en Atlas, y
este documento explica de dónde vienen y hasta dónde llegan.

## Una corrección al rediseño

El documento del modelo, en [`modelo-de-documentos.md`](modelo-de-documentos.md), decía que los
cuatro roles de PostgreSQL no se reproducían en MongoDB, porque el control de accesos de MongoDB
es por colección y por acción, y no sabe decir "este alumno lee su propio expediente". Eso sigue
siendo cierto, pero la conclusión que se sacaba de ahí estaba mal.

El argumento era que crear roles de base de datos daría una falsa sensación de que la base cuida
algo que en realidad cuida el código. El problema de ese argumento es que trata la seguridad como
si fuera una sola capa: o la impone la base, o la impone Node. Y no es una sola capa. Que MongoDB
no pueda decidir **cuáles documentos** ve el alumno no quita que sí pueda decidir **cuáles
colecciones** toca y **con qué acciones**, y eso es un techo real que el código no puede levantar
por encima de sí mismo.

La diferencia se ve mejor con un ejemplo. Supongamos que mañana un error en la capa de datos deja
pasar una escritura de un alumno sobre `grupos`:

- Sin roles, la escritura entra. La única barrera era el código que falló.
- Con roles, MongoDB la rechaza, porque la conexión con la que entró ese alumno no tiene permiso
  de escribir `grupos`. El error sigue siendo un error, pero no se convierte en un destrozo.

Por eso ahora sí hay roles. **No sustituyen al filtro por identidad de la capa de datos: le ponen
un techo.** Todo lo que el documento del modelo dice sobre el filtro por identidad y sobre los
campos que cada rol puede escribir sigue en pie, palabra por palabra, y sigue siendo trabajo de
Node.

## Hasta dónde llega un rol y dónde empieza el código

| Pregunta | Quién la contesta |
|---|---|
| ¿Puede el alumno escribir en `grupos`? | El rol de MongoDB |
| ¿Puede el docente borrar `inscripciones`? | El rol de MongoDB |
| ¿Cuál inscripción puede leer este alumno? | La capa de datos, con el filtro por identidad |
| ¿Puede el alumno cambiar su CURP además de su domicilio? | La capa de datos, con la lista de campos por rol |
| ¿Puede el coordinador abrir la captura de calificaciones? | La capa de datos: es un campo dentro de `grupos` |

La regla de reparto es la misma del rediseño: **cada regla vive en la capa más baja que todavía
pueda imponerla sin excepción**. Los roles bajaron un escalón lo que se podía bajar; lo que no
cabe en "colección más acción" se queda arriba.

## De dónde salen estos permisos

No se inventaron. Salen del cuadro de permisos del proyecto relacional, que está en
`proyecto_erick/docs/permisos_por_rol.md` y refleja los `GRANT` de sus migraciones. Lo único que
se hizo fue traducirlos de tablas a colecciones.

La traducción no es uno a uno, porque veinte tablas quedaron en doce colecciones. Cuando varias
tablas con permisos distintos cayeron en la misma colección, **el permiso de la colección es el
más amplio de las tablas que la forman**, y la diferencia baja a la capa de datos. Son tres casos
y conviene tenerlos a la vista, porque son exactamente los lugares donde el techo quedó más alto
de lo que estaba:

| Lo que pasó | Qué se perdió | Quién lo impone ahora |
|---|---|---|
| `documentos` entró en `usuarios` | El docente no tenía ningún permiso sobre `documentos`, y ahora el expediente viaja dentro del alumno | La capa de datos no devuelve el expediente cuando quien pregunta es un docente |
| `asignaciones` entró en `grupos` | Coordinación no podía tocar la columna `estatus_captura`, y ahora es un campo del grupo que sí puede escribir | La capa de datos: abrir y cerrar la captura es de administración y de la tarea programada |
| `calificaciones` entró en `inscripciones` | El docente escribía calificaciones sin tocar la inscripción, y ahora necesita `update` sobre toda la inscripción | La capa de datos: del documento sólo le deja tocar las calificaciones de su materia |

Es el mismo precio que ya pagaba el rediseño al embeber: lo que antes separaba una tabla, ahora lo
separa el código.

## Los cuatro roles del sistema escolar

Símbolos: `S` consultar, `I` insertar, `U` actualizar, `D` borrar, `todo` las cuatro, `-` nada.

| Colección | `cetia_alumno` | `cetia_docente` | `cetia_coordinador` | `cetia_administrador` |
|---|---|---|---|---|
| `carreras` | S | S | S | todo |
| `turnos` | S | S | S | todo |
| `periodos` | S | S | S | todo |
| `aulas` | S | S | S | todo |
| `materias` | S | S | S | todo |
| `planes_estudio` | S | S | S | todo |
| `usuarios` | S, U | S, U | S, U | todo |
| `grupos` | S | S | todo | todo |
| `inscripciones` | S, I | S, U | S | todo |
| `tramites` | S, I | - | S | todo |
| `avisos` | S | todo | todo | todo |
| `contadores` | - | - | S, U | S, I, U |
| `bitacora` | I | I | I | S, I |

Lo que cada permiso significa en la pantalla del sistema:

- **El alumno** consulta los catálogos, su cuenta con su expediente, el horario de su grupo y los
  avisos; cambia sus datos de contacto; solicita su reinscripción y sus constancias. No escribe
  nada más, y de lo que escribe no decide el estatus: una reinscripción nace solicitada y la
  resuelve administración.
- **El docente** consulta a sus alumnos y sus grupos, captura calificaciones y publica avisos para
  sus grupos. Sobre trámites no tiene nada, igual que en el modelo relacional.
- **El coordinador** arma los grupos, les asigna docente y les programa el horario, que en el
  modelo de documentos son las tres cosas que viven dentro de `grupos`. Consulta inscripciones y
  trámites, pero no los resuelve.
- **El administrador** puede todo, con una sola excepción: la bitácora se lee y se escribe, pero
  no se corrige ni se borra.

### Por qué todos escriben en la bitácora

Llama la atención que los cuatro roles tengan `I` sobre `bitacora` cuando en PostgreSQL ninguno
tenía permiso de escritura. Es una consecuencia directa del rediseño.

En PostgreSQL la bitácora la llenaban disparadores que corrían como dueños de la tabla, así que el
permiso del rol no hacía falta. En MongoDB no hay disparadores dentro de la transacción: la
bitácora la escribe la capa de datos, con la misma conexión y en la misma transacción que el
cambio que está auditando, porque escribirla con otra conexión la sacaría de la transacción y
dejaría de ser atómica.

Lo que se conserva es lo que importaba: **se puede escribir, no se puede corregir, y sólo
administración la lee.** Ningún rol tiene `U` ni `D` sobre `bitacora`.

## Los cuatro roles de servicio

No son personas. Son piezas del sistema que necesitan entrar a la base con un permiso acotado.

| Rol | Para qué | Qué alcanza |
|---|---|---|
| `cetia_acceso` | Buscar la cuenta cuando alguien inicia sesión | `usuarios` S, U; `bitacora` I |
| `cetia_tareas` | La tarea programada que corre cada hora | `periodos` S; `grupos` S, U; `avisos` S, U; `bitacora` I |
| `cetia_migraciones` | Aplicar las migraciones | Toda la base: consultar, insertar, actualizar, crear colecciones, cambiar validadores y crear índices |
| `cetia_auditoria` | Reportes y revisión | Toda la base, sólo lectura |

Tres cosas que valen la pena de este cuadro:

**`cetia_acceso` existe porque al iniciar sesión todavía no se sabe quién es la persona.** La
búsqueda de la cuenta por matrícula, por número de docente o por correo no se puede hacer con
ninguno de los cuatro roles escolares, porque el rol es justamente lo que esa consulta está
averiguando. Así que se hace con una conexión que no alcanza nada más que `usuarios`.

**`cetia_migraciones` no puede borrar.** Ni documentos, ni colecciones, ni la base. Es la misma
regla de trabajo del proyecto relacional puesta en el permiso: una migración que ya se aplicó no se
edita, y un error se corrige con otra migración, nunca tirando lo que hay.

**`cetia_tareas` es el heredero de `pg_cron`.** Abre y cierra la captura de calificaciones según el
calendario del cuatrimestre y apaga los avisos vencidos, y no necesita nada más que eso.

## Los usuarios que usan los roles

Un rol no sirve solo: alguien tiene que entrar con él. La capa de datos en Node abre **una conexión
por rol** y elige cuál usar según el rol que trae el token de la persona. Por eso son varios
usuarios de MongoDB y no uno.

| Usuario | Rol | Quién lo usa |
|---|---|---|
| `cetia_app_alumno` | `cetia_alumno` | La capa de datos, cuando atiende a un alumno |
| `cetia_app_docente` | `cetia_docente` | La capa de datos, cuando atiende a un docente |
| `cetia_app_coordinador` | `cetia_coordinador` | La capa de datos, cuando atiende a un coordinador |
| `cetia_app_administrador` | `cetia_administrador` | La capa de datos, cuando atiende a administración |
| `cetia_app_acceso` | `cetia_acceso` | La capa de datos, al iniciar sesión |
| `cetia_app_tareas` | `cetia_tareas` | La tarea programada |
| `cetia_migrador` | `cetia_migraciones` | El aplicador de migraciones |
| `cetia_lector` | `cetia_auditoria` | Reportes y revisión |

Esto es lo que le da sentido a todo lo anterior: si la capa de datos entrara siempre con el mismo
usuario todopoderoso, los roles serían decorativos. Entrando con el usuario del rol de la persona,
el techo es de verdad.

Django sigue sin credenciales de MongoDB, como dice el rediseño: no toca la base, le pide todo a la
capa de datos pasando quién es la persona.

Las contraseñas se crean en Atlas, en Database Access, y van al `.env` de la capa de datos. **Nunca
al repositorio.**

## Cómo se aplican

Los roles no se crean igual en los dos lados, y por eso el aplicador habla los dos idiomas leyendo
la misma definición. Eso es justamente lo que evita que el MongoDB local y Atlas se vayan separando
sin que nadie se dé cuenta.

Para ver qué se va a crear, sin tocar nada:

```bash
python mongodb/roles/aplicar_roles.py --ver
```

En el MongoDB local de Docker, donde se crean con el comando `createRole` del propio motor:

```bash
python mongodb/roles/aplicar_roles.py --local
```

En Atlas, donde **el driver no puede administrar roles**, ni siquiera con un usuario `atlasAdmin`:
ahí los roles se crean por la consola o por la API de administración, y el aplicador usa la API.

```bash
python mongodb/roles/aplicar_roles.py --atlas
```

Para lo de Atlas hacen falta `ATLAS_PUBLIC_KEY`, `ATLAS_PRIVATE_KEY` y `ATLAS_GROUP_ID` en el
`.env`. La llave se saca en la organización, en Access Manager, API Keys, y necesita el permiso
Project Owner sobre el proyecto.

Correr el aplicador dos veces no hace daño: si el rol ya existe, le deja los permisos que dice el
archivo. Así es como se publica un cambio de permisos.

## Lo que los roles no cubren

Para que quede escrito y no se descubra tarde, esto **no** lo cuida MongoDB y lo tiene que cuidar
la capa de datos, con una prueba por regla:

- Cuáles documentos alcanza cada persona: su propio expediente, sus grupos, su carrera.
- Cuáles campos puede escribir cada rol dentro de un documento que sí puede escribir.
- Que el expediente del alumno no se le devuelva a un docente.
- Que coordinación no mueva `estatus_captura` al escribir un grupo.
- Que el alumno no se ponga a sí mismo el estatus de una inscripción.
- La frontera entre el portal público y el panel administrativo, que es de Django.
