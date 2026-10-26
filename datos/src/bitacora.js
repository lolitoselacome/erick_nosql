// =====================================================================
// CETIA - La bitacora: un solo punto de paso
//
// Hereda los veinte disparadores *_bitacora del proyecto relacional.
// Alla la bitacora se escribia dentro de la misma transaccion que el
// cambio: si el registro fallaba, el cambio se deshacia, y ningun camino
// podia evitarlo porque lo imponia el motor.
//
// Aqui eso solo se conserva si toda escritura pasa por esta funcion y
// lleva la sesion de la transaccion. Por eso no hay forma de escribir en
// las colecciones del sistema sin pasar por aqui: el servidor no expone
// el driver, expone estas operaciones.
//
// El Atlas Trigger que tambien escribe bitacora no sustituye a esto:
// corre despues del hecho y sirve para atrapar lo que se escriba por
// fuera de esta capa, por ejemplo una correccion a mano en la consola.
// Se distinguen por el campo origen.
// =====================================================================

import { randomUUID } from "node:crypto";

export async function registrar(bd, sesion, movimiento) {
  const { identidad, accion, coleccion, idDocumento, antes, despues } = movimiento;

  await bd.collection("bitacora").insertOne(
    {
      _id: randomUUID(),
      id_usuario: identidad?.id || null,
      accion,
      tabla_afectada: coleccion,
      id_registro: idDocumento ? String(idDocumento) : null,
      datos_anteriores: antes || null,
      datos_nuevos: despues || null,
      fecha_hora: new Date(),
      origen: "capa_datos",
    },
    { session: sesion }
  );
}
