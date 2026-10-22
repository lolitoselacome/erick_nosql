// =====================================================================
// CETIA - Bitacora (Atlas Function)
//
// Hereda los veinte disparadores *_bitacora del proyecto relacional.
// Se cuelga de un Atlas Trigger por coleccion, en insert, update y
// replace/delete, y guarda el antes y el despues del documento.
//
// Diferencia honesta con PostgreSQL
// ---------------------------------
// Alla la bitacora se escribia dentro de la misma transaccion: si el
// registro fallaba, el cambio se deshacia. Aqui el trigger corre sobre
// el change stream, o sea DESPUES de que la escritura ya ocurrio, asi
// que si este registro falla el cambio ya quedo hecho.
//
// Por eso la bitacora que sirve de auditoria formal la escribe tambien
// la capa de datos dentro de la transaccion. Este trigger es la red de
// seguridad que atrapa lo que se escriba por fuera de la capa de datos
// (una correccion a mano desde la consola, por ejemplo), que es
// justamente lo que en PostgreSQL ningun camino podia evitar.
//
// El trigger debe tener activado "Full Document" y, para los update,
// "Document Preimage", para poder guardar el antes.
// =====================================================================

exports = async function (evento) {
  const cetia = context.services.get("cetia").db("cetia");
  const bitacora = cetia.collection("bitacora");

  // De que coleccion vino el cambio
  const coleccion = evento.ns.coll;

  // La propia bitacora no se audita a si misma: seria un ciclo.
  if (coleccion === "bitacora") return;

  const ACCIONES = {
    insert: "INSERT",
    update: "UPDATE",
    replace: "UPDATE",
    delete: "DELETE",
  };

  const accion = ACCIONES[evento.operationType];
  if (!accion) return;

  const antes = evento.fullDocumentBeforeChange || null;
  const despues = evento.fullDocument || null;

  await bitacora.insertOne({
    _id: new BSON.ObjectId().toString(),
    // Quien lo hizo no viaja en el change stream: la capa de datos lo
    // escribe en su propio registro. Aqui queda nulo, que es la senal
    // de que el cambio no paso por la capa de datos.
    id_usuario: null,
    accion,
    tabla_afectada: coleccion,
    id_registro: evento.documentKey ? String(evento.documentKey._id) : null,
    datos_anteriores: antes,
    datos_nuevos: despues,
    fecha_hora: new Date(),
    origen: "atlas_trigger",
  });
};
