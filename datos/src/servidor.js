// =====================================================================
// CETIA - El servicio de la capa de datos
//
// Es la unica puerta a MongoDB. Django le habla por HTTP y siempre le
// dice quien pregunta; esta capa decide que alcanza esa persona, que
// campos puede escribir y si la escritura rompe alguna regla.
//
// Lo que NO hace este servicio
// ----------------------------
// No expone el driver ni acepta consultas armadas por quien llama. Si
// lo hiciera, el filtro por identidad se podria esquivar mandando otra
// consulta, y entonces no serviria de nada. Por eso solo hay cinco
// operaciones y todas arrastran la identidad.
//
//   node datos/src/servidor.js
// =====================================================================

import express from "express";
import { randomUUID } from "node:crypto";

import { conectar, cerrar, en_transaccion } from "./conexion.js";
import { consultaCon, identidadDe, ErrorDeAcceso } from "./identidad.js";
import { filtrarEscritura, puedeBorrar, puedeCrear } from "./permisos.js";
import { registrar } from "./bitacora.js";
import { ErrorDeRegla } from "./reglas/horario.js";

const PUERTO = Number(process.env.PUERTO_CAPA_DATOS || 4000);
const SECRETO = process.env.SECRETO_CAPA_DATOS || "";

// Las colecciones que se pueden pedir por nombre. Una lista cerrada, no
// lo que venga en la direccion: asi nadie alcanza colecciones internas
// escribiendo su nombre a mano.
const COLECCIONES = new Set([
  "carreras", "turnos", "periodos", "aulas", "materias", "planes_estudio",
  "usuarios", "grupos", "inscripciones", "tramites", "avisos", "bitacora",
]);

// Campos que nunca salen de aqui, por ninguna consulta.
const OCULTOS = { contrasena: 0 };

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------
// Antes de cada peticion
// ---------------------------------------------------------------------

/** Solo atiende a quien comparte el secreto con el backend. */
function soloElBackend(pet, res, siguiente) {
  if (SECRETO && pet.headers["x-secreto"] !== SECRETO) {
    return res.status(403).json({ error: "No autorizado" });
  }
  siguiente();
}

/** Arma la identidad a partir de las cabeceras que manda Django. */
function conIdentidad(pet, res, siguiente) {
  try {
    const id = pet.headers["x-identidad-id"];
    const rol = pet.headers["x-identidad-rol"];
    if (!id || !rol) {
      return res.status(403).json({ error: "Falta la identidad de quien pregunta" });
    }

    pet.identidad = identidadDe({
      _id: id,
      rol,
      activo: true,
      id_carrera: pet.headers["x-identidad-carrera"] || null,
      perfil_alumno: pet.headers["x-identidad-alumno"]
        ? { id_alumno: pet.headers["x-identidad-alumno"] }
        : undefined,
      perfil_docente: pet.headers["x-identidad-docente"]
        ? { id_docente: pet.headers["x-identidad-docente"] }
        : undefined,
    });
    siguiente();
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
}

function coleccionValida(pet, res, siguiente) {
  if (!COLECCIONES.has(pet.params.coleccion)) {
    return res.status(404).json({ error: "Coleccion desconocida" });
  }
  siguiente();
}

function responderError(error, res) {
  if (error instanceof ErrorDeAcceso) return res.status(403).json({ error: error.message });
  if (error instanceof ErrorDeRegla) return res.status(409).json({ error: error.message });
  console.error(error);
  return res.status(500).json({ error: "Error en la capa de datos" });
}

// ---------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------

app.get("/salud", (_pet, res) => res.json({ estado: "bien", servicio: "capa de datos" }));

/**
 * Buscar la cuenta al iniciar sesion.
 *
 * Es la unica ruta sin identidad, porque todavia no hay: es la que la
 * averigua. Por eso busca por un campo de una lista cerrada y devuelve
 * solo esa cuenta, nunca una lista.
 */
app.post("/acceso/buscar", soloElBackend, async (pet, res) => {
  const CAMPOS = {
    matricula: "perfil_alumno.matricula",
    numero_empleado: "perfil_docente.numero_empleado",
    numero_coordinador: "numero_coordinador",
    correo: "correo",
  };

  const { campo, valor } = pet.body?.acceso || {};
  const ruta = CAMPOS[campo];
  if (!ruta || typeof valor !== "string") {
    return res.status(400).json({ error: "Acceso invalido" });
  }

  try {
    const bd = await conectar();
    // Aqui si sale la contrasena cifrada: es lo unico que la necesita,
    // para compararla. No sale por ninguna otra ruta.
    const cuenta = await bd.collection("usuarios").findOne({ [ruta]: valor });
    if (!cuenta) return res.status(404).json({ error: "No encontrada" });
    res.json(cuenta);
  } catch (error) {
    responderError(error, res);
  }
});

app.get("/:coleccion", soloElBackend, conIdentidad, coleccionValida, async (pet, res) => {
  try {
    const bd = await conectar();
    const { coleccion } = pet.params;
    const porPagina = Math.min(Number(pet.query.por_pagina) || 25, 100);
    const pagina = Math.max(Number(pet.query.pagina) || 1, 1);

    const consulta = consultaCon(pet.identidad, coleccion, {});
    const documentos = await bd
      .collection(coleccion)
      .find(consulta, { projection: OCULTOS })
      .skip((pagina - 1) * porPagina)
      .limit(porPagina)
      .toArray();

    res.json({
      documentos,
      pagina,
      por_pagina: porPagina,
      total: await bd.collection(coleccion).countDocuments(consulta),
    });
  } catch (error) {
    responderError(error, res);
  }
});

app.get("/:coleccion/:id", soloElBackend, conIdentidad, coleccionValida, async (pet, res) => {
  try {
    const bd = await conectar();
    const { coleccion, id } = pet.params;
    // El alcance va unido a la busqueda por id: pedir el documento de
    // otra persona no lo saca del alcance, simplemente no lo encuentra.
    const consulta = consultaCon(pet.identidad, coleccion, { _id: id });
    const documento = await bd.collection(coleccion).findOne(consulta, { projection: OCULTOS });
    if (!documento) return res.status(404).json({ error: "No encontrado" });
    res.json(documento);
  } catch (error) {
    responderError(error, res);
  }
});

app.post("/:coleccion", soloElBackend, conIdentidad, coleccionValida, async (pet, res) => {
  try {
    const bd = await conectar();
    const { coleccion } = pet.params;

    if (!puedeCrear(pet.identidad, coleccion)) {
      return res.status(403).json({ error: `No puedes crear en ${coleccion}` });
    }

    const { cambios } = filtrarEscritura(pet.identidad, coleccion, pet.body || {});
    const documento = { _id: randomUUID(), ...cambios };

    const creado = await en_transaccion(async (sesion) => {
      await bd.collection(coleccion).insertOne(documento, { session: sesion });
      await registrar(bd, sesion, {
        identidad: pet.identidad,
        accion: "INSERT",
        coleccion,
        idDocumento: documento._id,
        despues: documento,
      });
      return documento;
    });

    res.status(201).json(creado);
  } catch (error) {
    responderError(error, res);
  }
});

app.patch("/:coleccion/:id", soloElBackend, conIdentidad, coleccionValida, async (pet, res) => {
  try {
    const bd = await conectar();
    const { coleccion, id } = pet.params;

    const { cambios, descartados } = filtrarEscritura(
      pet.identidad, coleccion, pet.body || {}
    );

    if (Object.keys(cambios).length === 0) {
      return res.status(403).json({
        error: "Ninguno de esos campos lo puedes cambiar",
        descartados,
      });
    }

    const consulta = consultaCon(pet.identidad, coleccion, { _id: id });

    const resultado = await en_transaccion(async (sesion) => {
      const antes = await bd.collection(coleccion).findOne(consulta, { session: sesion });
      if (!antes) return null;

      await bd.collection(coleccion).updateOne(
        { _id: id }, { $set: cambios }, { session: sesion }
      );
      const despues = await bd.collection(coleccion).findOne(
        { _id: id }, { session: sesion }
      );

      await registrar(bd, sesion, {
        identidad: pet.identidad,
        accion: "UPDATE",
        coleccion,
        idDocumento: id,
        antes,
        despues,
      });
      return despues;
    });

    if (!resultado) return res.status(404).json({ error: "No encontrado" });

    delete resultado.contrasena;
    res.json({ documento: resultado, descartados });
  } catch (error) {
    responderError(error, res);
  }
});

app.delete("/:coleccion/:id", soloElBackend, conIdentidad, coleccionValida, async (pet, res) => {
  try {
    const bd = await conectar();
    const { coleccion, id } = pet.params;

    if (!puedeBorrar(pet.identidad, coleccion)) {
      return res.status(403).json({ error: `No puedes borrar de ${coleccion}` });
    }

    const consulta = consultaCon(pet.identidad, coleccion, { _id: id });

    const borrado = await en_transaccion(async (sesion) => {
      const antes = await bd.collection(coleccion).findOne(consulta, { session: sesion });
      if (!antes) return false;

      await bd.collection(coleccion).deleteOne({ _id: id }, { session: sesion });
      await registrar(bd, sesion, {
        identidad: pet.identidad,
        accion: "DELETE",
        coleccion,
        idDocumento: id,
        antes,
      });
      return true;
    });

    if (!borrado) return res.status(404).json({ error: "No encontrado" });
    res.status(204).end();
  } catch (error) {
    responderError(error, res);
  }
});

// ---------------------------------------------------------------------

const servidor = app.listen(PUERTO, () => {
  console.log(`Capa de datos escuchando en http://localhost:${PUERTO}`);
  if (!SECRETO) {
    console.log(
      "Aviso: SECRETO_CAPA_DATOS esta vacio, asi que cualquiera que alcance " +
        "este puerto puede pedirle datos. Ponlo antes de usarlo en serio."
    );
  }
});

for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    servidor.close(async () => {
      await cerrar();
      process.exit(0);
    });
  });
}
