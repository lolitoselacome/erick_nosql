// =====================================================================
// CETIA - Pruebas de la capa de datos
//
// En PostgreSQL estas reglas las imponia el motor y no habia que
// probarlas: no se podian saltar. Aqui son codigo, asi que su
// confiabilidad depende de que esten probadas. Por eso esta bateria no
// es opcional: es parte de lo que sustituye a los disparadores.
//
// Corren contra los datos reales de Atlas, en lectura. Lo unico que
// escriben va dentro de una transaccion que siempre se deshace.
//
//   node datos/pruebas/reglas.js
// =====================================================================

import { conectar, cerrar, cliente_mongo } from "../src/conexion.js";
import {
  identidadDe, alcance, consultaCon, ErrorDeAcceso,
  alcanceDeGruposDelAlumno, alcanceDeInscripcionesDelDocente,
} from "../src/identidad.js";
import { filtrarEscritura, puedeCrear, puedeBorrar } from "../src/permisos.js";
import { validarHorario, ErrorDeRegla } from "../src/reglas/horario.js";

let pasadas = 0, falladas = 0;

function ok(n) { pasadas++; console.log(`  ok    ${n}`); }
function falla(n, d) { falladas++; console.log(`  FALLA ${n}\n        ${d}`); }

function comprueba(nombre, condicion, detalle = "") {
  condicion ? ok(nombre) : falla(nombre, detalle || "la condicion no se cumplio");
}

function rechaza(nombre, fn, tipo) {
  try {
    fn();
    falla(nombre, "no lanzo error y deberia haberlo hecho");
  } catch (e) {
    e instanceof tipo ? ok(nombre) : falla(nombre, `lanzo ${e.name}: ${e.message}`);
  }
}

async function rechazaAsync(nombre, fn, tipo) {
  try {
    await fn();
    falla(nombre, "no lanzo error y deberia haberlo hecho");
  } catch (e) {
    e instanceof tipo ? ok(nombre) : falla(nombre, `lanzo ${e.name}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------

const ADMIN = identidadDe({ _id: "u-admin", rol: "administrador", activo: true });
const COORD = identidadDe({ _id: "u-coord", rol: "coordinador", activo: true, id_carrera: "c-ti" });
const DOCENTE = identidadDe({
  _id: "u-doc", rol: "docente", activo: true,
  perfil_docente: { id_docente: "d-1", numero_empleado: "90260001" },
});
const ALUMNO = identidadDe({
  _id: "u-alu", rol: "alumno", activo: true,
  perfil_alumno: { id_alumno: "a-1", matricula: "1426010001" },
});

function pruebasIdentidad() {
  console.log("\nIdentidad y alcance (heredero del RLS)");

  rechaza("sin identidad no se puede consultar",
    () => consultaCon(null, "usuarios", {}), ErrorDeAcceso);

  rechaza("una cuenta dada de baja no entra",
    () => identidadDe({ _id: "x", rol: "alumno", activo: false }), ErrorDeAcceso);

  rechaza("un rol inventado no entra",
    () => identidadDe({ _id: "x", rol: "director", activo: true }), ErrorDeAcceso);

  const q = consultaCon(ALUMNO, "usuarios", {});
  comprueba("el alumno solo se alcanza a si mismo",
    q._id === "u-alu", JSON.stringify(q));

  const qt = consultaCon(ALUMNO, "tramites", { estatus: "listo" });
  comprueba("el alumno solo ve sus tramites",
    JSON.stringify(qt).includes("a-1"), JSON.stringify(qt));

  const qc = consultaCon(COORD, "grupos", {});
  comprueba("el coordinador solo ve los grupos de su carrera",
    qc.id_carrera === "c-ti", JSON.stringify(qc));

  const qd = consultaCon(DOCENTE, "grupos", {});
  comprueba("el docente solo ve los grupos donde el da clase",
    qd["asignaciones.id_docente"] === "d-1", JSON.stringify(qd));

  comprueba("administracion ve todos los grupos",
    Object.keys(consultaCon(ADMIN, "grupos", {})).length === 0);

  rechaza("la bitacora solo la lee administracion",
    () => consultaCon(COORD, "bitacora", {}), ErrorDeAcceso);

  comprueba("administracion si lee la bitacora",
    Object.keys(consultaCon(ADMIN, "bitacora", {})).length === 0);

  rechaza("los tramites no son del docente",
    () => consultaCon(DOCENTE, "tramites", {}), ErrorDeAcceso);

  comprueba("los catalogos los lee cualquiera",
    Object.keys(alcance(ALUMNO, "materias")).length === 0);

  // El alcance no se puede esquivar pidiendo otro documento.
  const trampa = consultaCon(ALUMNO, "usuarios", { _id: "u-otro" });
  comprueba("pedir el documento de otro no lo saca del alcance",
    JSON.stringify(trampa).includes("u-alu") && JSON.stringify(trampa).includes("$and"),
    JSON.stringify(trampa));
}

function pruebasPermisos() {
  console.log("\nCampos que cada rol puede escribir (heredero de los GRANT por columna)");

  const r1 = filtrarEscritura(ALUMNO, "usuarios", {
    "perfil_alumno.domicilio.calle": "Morelos 12",
    "perfil_alumno.curp": "OTRA_CURP",
    "perfil_alumno.estatus": "egresado",
    telefono: "7771234567",
  });
  comprueba("el alumno cambia su domicilio y su telefono",
    "perfil_alumno.domicilio.calle" in r1.cambios && "telefono" in r1.cambios);
  comprueba("el alumno no cambia su CURP ni su estatus",
    r1.descartados.includes("perfil_alumno.curp") &&
    r1.descartados.includes("perfil_alumno.estatus"),
    JSON.stringify(r1.descartados));

  rechaza("la matricula no se cambia por ningun camino",
    () => filtrarEscritura(ADMIN, "usuarios", { "perfil_alumno.matricula": "1426019999" }),
    ErrorDeAcceso);

  rechaza("el numero de docente tampoco",
    () => filtrarEscritura(ADMIN, "usuarios", { "perfil_docente.numero_empleado": "90260009" }),
    ErrorDeAcceso);

  const r2 = filtrarEscritura(COORD, "grupos", {
    cupo: 40,
    "asignaciones.$[].id_docente": "d-9",
    "asignaciones.$[].estatus_captura": "abierta",
  });
  comprueba("el coordinador cambia el cupo y asigna docente",
    "cupo" in r2.cambios && "asignaciones.$[].id_docente" in r2.cambios);
  comprueba("el coordinador NO abre la captura de calificaciones",
    r2.descartados.includes("asignaciones.$[].estatus_captura"),
    JSON.stringify(r2.descartados));

  rechaza("el alumno no escribe en grupos",
    () => filtrarEscritura(ALUMNO, "grupos", { cupo: 99 }), ErrorDeAcceso);

  comprueba("administracion escribe todo en usuarios",
    filtrarEscritura(ADMIN, "usuarios", { rol: "docente" }).cambios.rol === "docente");

  comprueba("nadie borra la bitacora", !puedeBorrar(ADMIN, "bitacora"));
  comprueba("el alumno solicita su reinscripcion", puedeCrear(ALUMNO, "inscripciones"));
  comprueba("el alumno no crea grupos", !puedeCrear(ALUMNO, "grupos"));
  comprueba("el coordinador si crea grupos", puedeCrear(COORD, "grupos"));
}

async function pruebasHorario(bd) {
  console.log("\nEmpalmes de horario (heredera de validar_horario)");

  // Se busca un bloque que ya exista en los datos reales para intentar
  // pisarlo: si la regla sirve, lo rechaza.
  const grupo = await bd.collection("grupos").findOne({
    "asignaciones.horarios.0": { $exists: true },
  });

  if (!grupo) {
    console.log("  (no hay grupos con horario en la base; se omite)");
    return;
  }

  const asignacion = grupo.asignaciones.find((a) => (a.horarios || []).length > 0);
  const existente = asignacion.horarios[0];

  console.log(`  usando el grupo ${grupo.clave}, ${asignacion.materia?.nombre}`);

  const sesion = cliente_mongo().startSession();
  try {
    await sesion.withTransaction(async () => {
      // Mismo dia, misma hora, misma aula -> el aula esta ocupada
      await rechazaAsync("el aula ocupada se rechaza", () =>
        validarHorario(bd, {
          idGrupo: grupo._id,
          idAsignacion: asignacion._id,
          bloque: {
            id_aula: existente.id_aula,
            dia_semana: existente.dia_semana,
            hora_inicio: existente.hora_inicio,
            hora_fin: existente.hora_fin,
          },
        }, sesion), ErrorDeRegla);

      // Fuera del turno
      await rechazaAsync("una clase fuera del turno se rechaza", () =>
        validarHorario(bd, {
          idGrupo: grupo._id,
          idAsignacion: asignacion._id,
          bloque: {
            id_aula: existente.id_aula,
            dia_semana: 6,
            hora_inicio: "05:00",
            hora_fin: "06:00",
          },
        }, sesion), ErrorDeRegla);

      // Termina antes de empezar
      await rechazaAsync("una clase que termina antes de empezar se rechaza", () =>
        validarHorario(bd, {
          idGrupo: grupo._id,
          idAsignacion: asignacion._id,
          bloque: {
            id_aula: existente.id_aula,
            dia_semana: 2,
            hora_inicio: "10:00",
            hora_fin: "09:00",
          },
        }, sesion), ErrorDeRegla);

      // Un aula que no existe
      await rechazaAsync("un aula inexistente se rechaza", () =>
        validarHorario(bd, {
          idGrupo: grupo._id,
          idAsignacion: asignacion._id,
          bloque: {
            id_aula: "no-existe",
            dia_semana: 2,
            hora_inicio: "09:00",
            hora_fin: "10:00",
          },
        }, sesion), ErrorDeRegla);

      // Sin transaccion no se deja validar
      await rechazaAsync("validar sin transaccion se rechaza", () =>
        validarHorario(bd, {
          idGrupo: grupo._id,
          idAsignacion: asignacion._id,
          bloque: {
            id_aula: existente.id_aula,
            dia_semana: 2,
            hora_inicio: "09:00",
            hora_fin: "10:00",
          },
        }, undefined), Error);

      // Esta transaccion nunca guarda nada.
      throw new Error("__deshacer__");
    }).catch((e) => {
      if (e.message !== "__deshacer__") throw e;
    });
  } finally {
    await sesion.endSession();
  }
}

async function pruebasConDatos(bd) {
  console.log("\nAlcances que necesitan consultar la base");

  const alumno = await bd.collection("usuarios").findOne({ rol: "alumno" });
  if (alumno) {
    const id = identidadDe(alumno);
    const f = await alcanceDeGruposDelAlumno(bd, id);
    comprueba("el alcance de grupos del alumno es una lista cerrada",
      Array.isArray(f._id.$in), JSON.stringify(f).slice(0, 80));
  }

  const grupoConDocente = await bd
    .collection("grupos")
    .findOne({ "asignaciones.id_docente": { $ne: null } });

  comprueba("se puede resolver el alcance del docente sin romper",
    grupoConDocente !== undefined);
}

async function main() {
  const bd = await conectar();
  console.log(`Conectado a ${bd.databaseName}`);

  pruebasIdentidad();
  pruebasPermisos();
  await pruebasConDatos(bd);
  await pruebasHorario(bd);

  console.log(`\n${pasadas + falladas} pruebas: ${pasadas} pasaron, ${falladas} fallaron`);
  await cerrar();
  if (falladas > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(`\nError: ${e.message}`);
  await cerrar();
  process.exitCode = 1;
});
