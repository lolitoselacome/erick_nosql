// =====================================================================
// CETIA - Conexion a MongoDB
//
// Una sola conexion para todo el proceso. El driver de MongoDB ya trae
// su propio grupo de conexiones, asi que abrir una por peticion seria
// peor, no mejor.
// =====================================================================

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(AQUI, "..", "..", ".env") });

let cliente = null;
let base = null;

export async function conectar() {
  if (base) return base;

  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes("CONTRASENA_DE_ATLAS")) {
    throw new Error(
      "Falta MONGODB_URI en .env, o todavia tiene el texto de ejemplo. " +
        "Se saca del cluster en Atlas, en Connect, Drivers."
    );
  }

  cliente = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await cliente.connect();
  base = cliente.db(process.env.MONGODB_BASE || "cetia");
  return base;
}

export function cliente_mongo() {
  if (!cliente) throw new Error("Todavia no se ha llamado a conectar()");
  return cliente;
}

export async function cerrar() {
  if (cliente) {
    await cliente.close();
    cliente = null;
    base = null;
  }
}

// Varias reglas de este modelo tienen que leer el conjunto con el que
// podrian chocar y escribir en la misma transaccion, para que dos
// personas trabajando a la vez no metan un dato invalido entre la
// revision y la escritura.
//
// Las transacciones necesitan conjunto de replicas. Atlas lo trae desde
// el nivel gratuito; un mongod suelto no, y ahi esto falla.
export async function en_transaccion(trabajo) {
  const sesion = cliente_mongo().startSession();
  try {
    let resultado;
    await sesion.withTransaction(async () => {
      resultado = await trabajo(sesion);
    });
    return resultado;
  } finally {
    await sesion.endSession();
  }
}
