# CLAUDE.md

Guia para trabajar en este repositorio: version NoSQL del sistema de control escolar CETIA
del Centro de Estudios Tecnologicos e Innovacion Aplicada.

## Que es este proyecto

Es el **proyecto hermano** del sistema relacional, no una migracion de el. El mismo sistema
escolar, rediseñado de tablas a documentos.

| | Relacional (ya hecho) | Este proyecto |
|---|---|---|
| Carpeta | `proyecto_erick` | `proyecto_erick_nosql` |
| Repositorio | `lolitoselacome/proyecto_erick` | `lolitoselacome/erick_nosql` |
| Base | Supabase (PostgreSQL), 20 tablas | MongoDB Atlas, colecciones |
| Backend | Python con FastAPI | Python con Django (API) |
| Conexion a la base | API de Supabase | Node.js habla con Mongo |
| Lenguaje del frontend | JavaScript (JSX) | TypeScript (TSX) |

El proyecto relacional **no se toca**. Solo se lee como referencia: su `README.md`, su
carpeta `docs/` y sus migraciones en `supabase/migrations/` describen el modelo del que
parte el rediseño.

## El sistema

- Preparatoria tecnica: cuatrimestres, un solo plan de estudios, dos carreras
  (Administracion y Tecnologias de la Informacion) y dos turnos.
- Roles: alumno y docente entran por el **portal publico**; administrador y coordinador
  entran por el **panel administrativo**, que es otra aplicacion y nunca se enlaza desde
  el portal.
- Acceso: alumno con matricula (10 digitos), docente con numero `90AANNNN`, coordinador
  con numero `91AANNNN`, administrador con correo.

## Tecnologias

| Parte | Tecnologia |
|---|---|
| Base de datos | MongoDB Atlas |
| Capa de datos | Node.js |
| Backend | Python con Django |
| Frontend | React con **TypeScript** (TSX), Bootstrap, HTML y CSS |
| Entorno local | Docker Desktop con Docker Compose |

El diseño de la interfaz es el mismo del proyecto relacional: colores del logo azul
`#123B7A`, verde `#2F9E5B`, gris `#475569`; tipografias Lexend (titulos) y Source Sans 3
(texto); login al estilo del portal "mitec" del Tec de Monterrey.

Para decisiones de diseño se usa la skill **ui-ux-pro-max** (`.claude/skills/ui-ux-pro-max`).

## Reglas de trabajo

- **Sin emojis** en codigo, commits, README ni interfaz. En ningun lado.
- **Commits:** en español, titulo corto que diga que hace el cambio y un cuerpo que explique
  que cambio y por que. **Solo a nombre del usuario del repositorio (`lolitoselacome`)**:
  sin lineas de coautoria, sin pies de herramientas, sin menciones de Claude ni de ninguna
  otra herramienta. Lo mismo en las descripciones de los Pull Request.
- **README y documentacion:** en español, bien explicados, con el mismo cuidado y el mismo
  formato que el README del proyecto relacional.
- **Ramas:** cada cambio en `feature/<tema>` o `fix/<tema>` que sale de `develop`; entra a
  `develop` por Pull Request y de `develop` pasa a `main`.
- **Base de datos:** los cambios al modelo se prueban primero fuera de produccion, igual que
  en el proyecto relacional; nunca se edita algo ya aplicado.
- **Textos de la interfaz:** no inventar textos, secciones ni enlaces que no se pidieron.
- **No tocar `proyecto_erick`** ni su base en Supabase desde aqui.
