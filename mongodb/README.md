# La base de datos: MongoDB

Aquí vive el modelo de documentos de CETIA: las colecciones, sus validadores de esquema, sus
índices y los datos base del plantel. Es el equivalente de la carpeta `supabase/` del proyecto
relacional, y se trabaja con las mismas reglas: cada cambio es un archivo nuevo, las migraciones
se aplican en orden, y **una migración que ya se aplicó nunca se edita**; si algo está mal, se
corrige con otra.

El por qué de cada decisión del modelo está en [`../docs/modelo-de-documentos.md`](../docs/modelo-de-documentos.md).

## Qué hay en esta carpeta

```
aplicar.js              Aplica las migraciones que faltan y deja constancia de cada una
package.json            Solo una dependencia: el driver oficial de MongoDB
migrations/             Los cambios al modelo, en orden
roles/                  Los roles personalizados y el aplicador que los crea
pruebas/validadores.js  Comprueba que la base de verdad rechaza lo que debe rechazar
```

## Las migraciones

| Archivo | Qué hace |
|---|---|
| `20261005000100_colecciones_y_validadores.js` | Las doce colecciones del modelo, más `contadores`, con sus validadores de esquema |
| `20261005000200_indices.js` | Los índices únicos (herederos de las restricciones `unique`) y los de consulta |
| `20261005000300_datos_base.js` | Las dos carreras y los dos turnos |
| `20261005000400_plan_de_estudios.js` | Las materias, el plan de las dos carreras, las aulas y los cuatrimestres con su calendario |

El aplicador guarda en la colección `_migraciones` cuál ya corrió, con su fecha y cuánto tardó,
así que correrlo dos veces no repite nada.

## Las doce colecciones

Las veinte tablas del modelo relacional quedan en doce colecciones. Las ocho que desaparecen se
vuelven arreglos dentro del documento al que pertenecen:

| Colección | Se lleva dentro |
|---|---|
| `carreras` | |
| `turnos` | |
| `periodos` | el calendario escolar |
| `aulas` | |
| `materias` | |
| `planes_estudio` | un documento por carrera, con sus materias y sus requisitos |
| `usuarios` | el perfil del alumno o del docente, y el expediente del alumno |
| `grupos` | sus materias, y el horario de cada una |
| `inscripciones` | las materias que cursa el alumno, y las calificaciones de cada una |
| `tramites` | |
| `avisos` | |
| `bitacora` | |

Más `contadores`, que no es una entidad del sistema: guarda los consecutivos con los que la capa
de datos arma la matrícula, el número de docente y de coordinador y la clave del grupo, porque
MongoDB no tiene secuencias.

## Los roles

En `roles/` están los ocho roles personalizados de la base: los cuatro del sistema escolar
(`cetia_alumno`, `cetia_docente`, `cetia_coordinador`, `cetia_administrador`) y cuatro de servicio
(`cetia_acceso`, `cetia_tareas`, `cetia_migraciones`, `cetia_auditoria`).

Los permisos de los cuatro primeros no se inventaron: son los `GRANT` del proyecto relacional
traducidos de tablas a colecciones. El porqué de cada uno, y lo que la traducción hizo perder, está
en [`../docs/roles-y-permisos.md`](../docs/roles-y-permisos.md).

```
roles/roles.py          La definicion, que es la unica verdad
roles/aplicar_roles.py  Los crea en el Mongo local o en Atlas
```

Para verlos sin tocar nada:

```bash
python mongodb/roles/aplicar_roles.py --ver
```

Los roles van aparte de las migraciones por una razón concreta: no se crean igual en los dos
lados. En el MongoDB local se crean con el comando `createRole` del motor, pero **en Atlas el
driver no puede administrar roles**, ni siquiera con un usuario `atlasAdmin`; ahí se crean por la
consola o por la API de administración. El aplicador habla los dos idiomas leyendo la misma
definición, que es lo que evita que local y Atlas se vayan separando.

```bash
python mongodb/roles/aplicar_roles.py --local
python mongodb/roles/aplicar_roles.py --atlas
```

Lo de Atlas necesita `ATLAS_PUBLIC_KEY`, `ATLAS_PRIVATE_KEY` y `ATLAS_GROUP_ID` en `.env`.

## Cómo se prueba y cómo se aplica

Los cambios al modelo se prueban primero fuera de producción, igual que en el proyecto relacional.
El MongoDB local de Docker es esa copia: se arma desde cero con todas las migraciones.

Requisito: Docker Desktop abierto.

### 1. Levantar el MongoDB local

```bash
docker compose up -d mongo
```

Queda en `localhost:27017`. Va como conjunto de réplicas de un solo miembro, no como servidor
solo, porque **las transacciones de MongoDB no funcionan sin conjunto de réplicas** y buena parte
de las reglas de este modelo dependen de ellas. El conjunto se inicia por sí mismo.

Para conectarse desde la computadora (por ejemplo con Compass), hay que agregar
`directConnection=true`, porque el nombre del miembro del conjunto es `mongo` y ese nombre solo
existe dentro de la red de Docker:

```
mongodb://localhost:27017/?directConnection=true
```

### 2. Aplicar las migraciones

```bash
docker compose --profile migraciones run --rm migraciones
```

Para ver qué falta sin aplicar nada:

```bash
docker compose --profile migraciones run --rm migraciones node aplicar.js --estado
```

### 3. Correr las pruebas

```bash
docker compose --profile pruebas run --rm pruebas
```

Arman el modelo completo en una base aparte, comprueban que los validadores y los índices únicos
rechazan lo que deben rechazar, y borran esa base al terminar. No tocan los datos de nadie.

### 4. Cuando pasa, aplicar en Atlas

Hasta que las migraciones aplican bien en local y las pruebas pasan, el cambio se sube a Atlas.

Primero hay que poner la cadena de conexión en `.env`, a partir de `.env.example`. Se saca del
cluster en Atlas, en Connect, Drivers. Lleva usuario y contraseña, así que **nunca se sube a
GitHub**.

```bash
docker compose --profile atlas run --rm atlas
```

Va en su propio perfil y sin depender del Mongo local, para que apuntar a Atlas sea una decisión
explícita y no un descuido.

## Para empezar de cero

Si el MongoDB local quedó en mal estado y se quiere volver a armar:

```bash
docker compose down -v
docker compose up -d mongo
docker compose --profile migraciones run --rm migraciones
```

`down -v` borra el volumen con los datos. En local no importa, porque se arma otra vez con las
migraciones. **En Atlas no se hace nunca.**

## Lo que todavía no está aquí

Este modelo es la base de datos. La lógica que en PostgreSQL vive en disparadores y en seguridad
por filas no está en estas migraciones, y no por olvido: MongoDB no tiene dónde ponerla. El reparto
decidido está explicado en [`../docs/modelo-de-documentos.md`](../docs/modelo-de-documentos.md), y
lo que corresponde a la capa de datos se construye en Node, que es la única puerta a la base.

De lo que sí queda impuesto por la base, aquí está todo: la forma de cada campo, sus listas de
valores, sus rangos y su unicidad en las migraciones, y el techo de lo que cada rol puede tocar en
`roles/`. Lo que ninguna de las dos cosas alcanza es el documento y el campo, que es donde empieza
el trabajo de la capa de datos.
